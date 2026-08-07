import { app, autoUpdater as electronAutoUpdater, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/changeSet'

const REPO = '21stware/vav'

/**
 * App updates via electron-updater (packaged builds) with a GitHub Releases
 * fallback for unpackaged / dev runs.
 *
 * Packaged: check → download in-app → quitAndInstall (Squirrel.Mac / NSIS).
 * Dev: same UI phases, but "download" opens the release asset in the browser.
 *
 * macOS note: electron-updater marks the ZIP downloaded before Squirrel.Mac
 * finishes staging (verify + ditto unzip). Showing "Restart" too early makes
 * quitAndInstall appear to no-op. We wait for Electron's native
 * `update-downloaded` before flipping to `ready`.
 */
export class UpdateService {
  private state: UpdateState = {
    phase: 'idle',
    currentVersion: app.getVersion(),
    latestVersion: null,
    releaseUrl: null,
    downloadUrl: null,
    progress: 0,
    bytesPerSecond: null,
    message: null
  }
  private listeners = new Set<(state: UpdateState) => void>()
  private willInstall: (() => void) | null = null
  private downloading = false
  /** Squirrel.Mac has finished staging (native update-downloaded). */
  private nativeUpdateReady = false
  private nativeReadyWaiters: Array<() => void> = []

  constructor() {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    // Public GitHub Releases — no token required for check/download.
    autoUpdater.on('download-progress', (p) => {
      this.patch({
        phase: 'downloading',
        progress: Math.max(0, Math.min(100, Math.round(p.percent))),
        bytesPerSecond: Number.isFinite(p.bytesPerSecond) ? p.bytesPerSecond : null
      })
    })
    autoUpdater.on('error', (err) => {
      if (
        this.state.phase === 'checking' ||
        this.state.phase === 'downloading' ||
        this.state.phase === 'preparing' ||
        this.state.phase === 'ready'
      ) {
        this.patch({
          phase: 'error',
          message: err.message,
          progress: 0,
          bytesPerSecond: null
        })
      }
      console.error('[updates]', err)
    })

    if (process.platform === 'darwin') {
      // Fires only after Squirrel.Mac has verified + unzipped — later than
      // electron-updater's own update-downloaded.
      electronAutoUpdater.on('update-downloaded', () => {
        this.nativeUpdateReady = true
        const waiters = this.nativeReadyWaiters.splice(0)
        for (const resolve of waiters) resolve()
      })
    }
  }

  /** Called just before quitAndInstall so hide-on-close does not swallow quit. */
  setWillInstallHandler(handler: () => void): void {
    this.willInstall = handler
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async check(): Promise<UpdateState> {
    this.patch({ phase: 'checking', message: null, progress: 0, bytesPerSecond: null })
    if (!app.isPackaged) {
      return this.checkViaGithub()
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.updateInfo) {
        return this.patch({
          phase: 'latest',
          latestVersion: app.getVersion(),
          message: null,
          bytesPerSecond: null
        })
      }
      const latest = result.updateInfo.version
      const current = app.getVersion()
      if (compareSemver(latest, current) > 0) {
        return this.patch({
          phase: 'available',
          latestVersion: latest,
          releaseUrl: `https://github.com/${REPO}/releases/tag/v${latest}`,
          downloadUrl: null,
          message: null,
          bytesPerSecond: null
        })
      }
      return this.patch({
        phase: 'latest',
        latestVersion: latest,
        releaseUrl: `https://github.com/${REPO}/releases/tag/v${latest}`,
        downloadUrl: null,
        message: null,
        bytesPerSecond: null
      })
    } catch (err) {
      // Network / feed missing (e.g. release without latest-mac.yml) — try API.
      console.warn('[updates] electron-updater check failed, falling back to GitHub API', err)
      return this.checkViaGithub()
    }
  }

  /**
   * Packaged: download the update package in-process.
   * Dev / fallback: open the asset URL in the browser.
   */
  async openDownload(): Promise<UpdateState> {
    if (this.state.phase === 'ready' || this.state.phase === 'preparing') return this.getState()
    if (this.downloading) return this.getState()

    // Unpackaged builds, or packaged builds that fell back to the GitHub API
    // (no latest*.yml on the release): open the asset in the browser.
    if (!app.isPackaged || this.state.downloadUrl) {
      const url = this.state.downloadUrl ?? this.state.releaseUrl
      if (!url) return this.getState()
      await shell.openExternal(url)
      return this.patch({
        phase: 'available',
        progress: 0,
        bytesPerSecond: null,
        message: null
      })
    }

    this.downloading = true
    this.nativeUpdateReady = false
    this.patch({ phase: 'downloading', progress: 0, bytesPerSecond: 0, message: null })
    try {
      await autoUpdater.downloadUpdate()
      // macOS: ZIP is local, but Squirrel may still be verifying/unzipping.
      // Surface an explicit "preparing" phase — Restart must wait for this.
      if (process.platform === 'darwin' && !this.nativeUpdateReady) {
        this.patch({
          phase: 'preparing',
          progress: 100,
          bytesPerSecond: null,
          message: null
        })
        await this.waitForNativeUpdateReady()
      }
      return this.patch({
        phase: 'ready',
        progress: 100,
        bytesPerSecond: null,
        message: null
      })
    } catch (err) {
      return this.patch({
        phase: 'error',
        message: (err as Error).message,
        progress: 0,
        bytesPerSecond: null
      })
    } finally {
      this.downloading = false
    }
  }

  /** Apply a downloaded update (restarts the app). */
  install(): void {
    if (!app.isPackaged) {
      // Dev fallback: plain relaunch — nothing was staged by electron-updater.
      app.relaunch()
      app.exit(0)
      return
    }
    if (this.state.phase !== 'ready') return
    try {
      // Tear down hide-on-close / tray keep-alive before Squirrel/NSIS quits.
      this.willInstall?.()
      // Defer so IPC / click handlers finish; required on macOS for quitAndInstall.
      setImmediate(() => {
        try {
          // isSilent=false shows installer UI when needed; isForceRunAfter=true
          // relaunches VAV after the swap (Windows; macOS ignores these flags).
          autoUpdater.quitAndInstall(false, true)
        } catch (err) {
          this.patch({ phase: 'error', message: (err as Error).message })
        }
      })
    } catch (err) {
      this.patch({ phase: 'error', message: (err as Error).message })
    }
  }

  private waitForNativeUpdateReady(timeoutMs = 180_000): Promise<void> {
    if (this.nativeUpdateReady) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const idx = this.nativeReadyWaiters.indexOf(done)
        if (idx >= 0) this.nativeReadyWaiters.splice(idx, 1)
        console.warn(
          '[updates] timed out waiting for Squirrel.Mac update-downloaded; enabling Restart anyway'
        )
        resolve()
      }, timeoutMs)
      this.nativeReadyWaiters.push(done)
    })
  }

  private async checkViaGithub(): Promise<UpdateState> {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vav' }
      })
      if (!res.ok) throw new Error(`GitHub ${res.status}`)
      const body = (await res.json()) as {
        tag_name?: string
        html_url?: string
        assets?: { name: string; browser_download_url: string }[]
      }
      const latest = (body.tag_name ?? '').replace(/^v/, '')
      const current = app.getVersion()
      if (!latest) throw new Error('No release tag')

      const newer = compareSemver(latest, current) > 0
      if (!newer) {
        return this.patch({
          phase: 'latest',
          latestVersion: latest,
          releaseUrl: body.html_url ?? null,
          downloadUrl: null,
          message: null,
          bytesPerSecond: null
        })
      }

      const downloadUrl = pickAsset(body.assets ?? []) ?? body.html_url ?? null
      return this.patch({
        phase: 'available',
        latestVersion: latest,
        releaseUrl: body.html_url ?? null,
        downloadUrl,
        message: null,
        bytesPerSecond: null
      })
    } catch (err) {
      return this.patch({
        phase: 'error',
        message: (err as Error).message,
        bytesPerSecond: null
      })
    }
  }

  private patch(partial: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...partial, currentVersion: app.getVersion() }
    for (const listener of this.listeners) listener(this.getState())
    return this.getState()
  }
}

function pickAsset(assets: { name: string; browser_download_url: string }[]): string | null {
  const prefer =
    process.platform === 'darwin'
      ? assets.find((a) => /macos|darwin|arm64.*\.dmg|\.dmg$/i.test(a.name))
      : assets.find((a) => /windows|win.*\.exe|\.exe$/i.test(a.name))
  return prefer?.browser_download_url ?? assets[0]?.browser_download_url ?? null
}

/** Positive when a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
