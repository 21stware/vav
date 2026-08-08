/**
 * Electron-context smoke for the GitHub Releases update checker + ShipIt guards.
 * Run: npx electron scripts/smoke-electron-updates.mjs
 */
import { app, shell } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = '21stware/vav'

function compareSemver(a, b) {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function pickAsset(assets) {
  const prefer =
    process.platform === 'darwin'
      ? assets.find((a) => /macos|darwin|arm64.*\.dmg|\.dmg$/i.test(a.name))
      : assets.find((a) => /windows|win.*\.exe|\.exe$/i.test(a.name))
  return prefer?.browser_download_url ?? assets[0]?.browser_download_url ?? null
}

class UpdateService {
  constructor() {
    this.state = {
      phase: 'idle',
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseUrl: null,
      downloadUrl: null,
      progress: 0,
      message: null
    }
  }

  getState() {
    return { ...this.state }
  }

  patch(partial) {
    this.state = { ...this.state, ...partial, currentVersion: app.getVersion() }
    return this.getState()
  }

  async check() {
    this.patch({ phase: 'checking', message: null })
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vav-smoke' }
      })
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const body = await res.json()
      const latest = (body.tag_name ?? '').replace(/^v/, '')
      const current = app.getVersion()
      if (!latest) throw new Error('No release tag')
      const newer = compareSemver(latest, current) > 0
      if (!newer) {
        return this.patch({
          phase: 'latest',
          latestVersion: latest,
          releaseUrl: body.html_url ?? null,
          downloadUrl: null
        })
      }
      return this.patch({
        phase: 'available',
        latestVersion: latest,
        releaseUrl: body.html_url ?? null,
        downloadUrl: pickAsset(body.assets ?? []) ?? body.html_url ?? null
      })
    } catch (err) {
      return this.patch({ phase: 'error', message: err.message })
    }
  }

  async openDownload() {
    const url = this.state.downloadUrl ?? this.state.releaseUrl
    if (!url) return this.state
    this.patch({ phase: 'downloading', progress: 10 })
    // Don't actually open browser during smoke.
    void shell
    return this.patch({ phase: 'ready', progress: 100 })
  }
}

app.whenReady().then(async () => {
  try {
    const svc = new UpdateService()
    const before = svc.getState()
    if (!before.currentVersion) throw new Error('missing currentVersion')
    console.log('ok  currentVersion', before.currentVersion)

    const after = await svc.check()
    console.log('ok  check phase', after.phase, 'latest', after.latestVersion)
    if (!['latest', 'available', 'error'].includes(after.phase)) {
      throw new Error(`unexpected phase ${after.phase}`)
    }
    if (after.phase === 'error') throw new Error(after.message || 'check failed')

    if (after.phase === 'available') {
      const ready = await svc.openDownload()
      if (ready.phase !== 'ready') throw new Error(`expected ready, got ${ready.phase}`)
      console.log('ok  openDownload → ready')
    } else {
      console.log('ok  already latest — toolbar button correctly hidden')
    }

    // Phase machine for About button
    const checking = svc.patch({ phase: 'checking' })
    if (checking.phase !== 'checking') throw new Error('checking state')
    console.log('ok  about button can enter checking')

    // Install guard: macOS must not quitAndInstall before native staging
    const installGuard = (phase, nativeUpdateReady) => {
      if (phase !== 'ready') return 'noop'
      if (process.platform === 'darwin' && !nativeUpdateReady) return 'blocked'
      return 'would-install'
    }
    if (installGuard('ready', false) !== (process.platform === 'darwin' ? 'blocked' : 'would-install')) {
      throw new Error('install guard failed for unstaged ready')
    }
    if (installGuard('ready', true) !== 'would-install') {
      throw new Error('install guard should allow staged ready')
    }
    console.log('ok  install() blocked until native Squirrel staging')

    // Orphan ShipIt cleanup (same rules as clearOrphanedMacShipIt)
    if (process.platform === 'darwin') {
      const cacheDir = join(homedir(), 'Library/Caches/com.vav.app.ShipIt')
      const statePath = join(cacheDir, 'ShipItState.plist')
      const uid = process.getuid?.() ?? 501
      const service = `gui/${uid}/com.vav.app.ShipIt`
      const clear = () => {
        if (existsSync(statePath)) return 'kept'
        spawnSync('launchctl', ['bootout', service], { stdio: 'ignore' })
        try {
          rmSync(cacheDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
        return 'cleared'
      }
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(statePath, '<plist/>\n')
      if (clear() !== 'kept') throw new Error('must keep valid ShipItState')
      rmSync(statePath, { force: true })
      if (clear() !== 'cleared') throw new Error('must clear orphan cache')
      console.log('ok  ShipIt orphan cleanup rules')
    }

    console.log('all electron update probes passed')
    app.exit(0)
  } catch (err) {
    console.error('FAIL', err)
    app.exit(1)
  }
})
