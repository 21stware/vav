import { app, shell } from 'electron'
import type { UpdateState } from '@shared/changeSet'

const REPO = '21stware/vav'

/**
 * Unsigned GitHub Releases checker — the Electron stand-in for the Sparkle
 * flow in settings-about / main-chat-empty. Downloads are opened via the
 * browser / Finder rather than silently swapped (no code signing yet).
 */
export class UpdateService {
  private state: UpdateState = {
    phase: 'idle',
    currentVersion: app.getVersion(),
    latestVersion: null,
    releaseUrl: null,
    downloadUrl: null,
    progress: 0,
    message: null
  }
  private listeners = new Set<(state: UpdateState) => void>()

  getState(): UpdateState {
    return { ...this.state }
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async check(): Promise<UpdateState> {
    this.patch({ phase: 'checking', message: null })
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
          message: null
        })
      }

      const downloadUrl = pickAsset(body.assets ?? []) ?? body.html_url ?? null
      return this.patch({
        phase: 'available',
        latestVersion: latest,
        releaseUrl: body.html_url ?? null,
        downloadUrl,
        message: null
      })
    } catch (err) {
      return this.patch({
        phase: 'error',
        message: (err as Error).message
      })
    }
  }

  async openDownload(): Promise<UpdateState> {
    const url = this.state.downloadUrl ?? this.state.releaseUrl
    if (!url) return this.state
    this.patch({ phase: 'downloading', progress: 10, message: null })
    await shell.openExternal(url)
    return this.patch({ phase: 'ready', progress: 100 })
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
