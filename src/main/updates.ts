import { app, autoUpdater as electronAutoUpdater, shell } from 'electron'
import { CancellationToken } from 'builder-util-runtime'
import { autoUpdater } from 'electron-updater'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import type { UpdateState } from '@shared/changeSet'
import {
  DEFAULT_AUTO_UPDATE_POLICY,
  UPDATE_HEARTBEAT_MS,
  UPDATE_LAUNCH_DELAY_MS,
  UPDATE_STAGING_TIMEOUT_MS,
  canCancelUpdateDownload,
  nativeStagingWaitDecision,
  isUpdateBusyPhase,
  isUpdateCancellationError,
  isUpdateSettledPhase,
  nextUpdateFollowUp,
  parseSkippedUpdateVersion,
  shouldAutoInstall,
  shouldRunAutomaticCheck,
  shouldStartNativeMacStaging,
  shouldSkipAutoFollowUp,
  type AutoUpdatePolicy,
  type UpdateCheckReason
} from '@shared/updatePolicy'
import {
  GITHUB_UPDATE_REPO,
  githubLatestReleaseApiUrl,
  githubProxyGenericFeedUrl,
  viaGithubProxy
} from '@shared/githubProxy'

const REPO = GITHUB_UPDATE_REPO

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
 * `update-downloaded` before flipping to `ready`. For notify / download,
 * electron-updater will not start that native fetch (`autoInstallOnAppQuit`
 * is off), so we call `checkForUpdates()` ourselves after the ZIP is local.
 * The `preparing` wait is cancellable — hide-on-close would otherwise leave
 * "Unpacking update" on screen with no escape.
 *
 * Also: a failed Squirrel.Mac install can leave launchd job `com.vav.app.ShipIt`
 * restarting every ~2s without ShipItState.plist. That loop re-triggers app
 * opens and surfaces as a repeated Gatekeeper “damaged” dialog until the user
 * trashes the app. A *successful* install used to leave the same job in Login
 * Items (“Allow in the Background”). Clear it on startup
 * (see {@link clearOrphanedMacShipIt}).
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
  private downloadInFlight: Promise<UpdateState> | null = null
  private cancelToken: CancellationToken | null = null
  /** User stopped an in-flight download — do not auto-restart until they retry. */
  private skipAutoDownload = false
  /** Version whose in-app staging/download the user abandoned (survives relaunch). */
  private skippedVersion: string | null = null
  private readonly userDataDir: string | null
  private cancelRequested = false
  /** Squirrel.Mac has finished staging (native update-downloaded). */
  private nativeUpdateReady = false
  private nativeReadyWaiters: Array<(ready: boolean) => void> = []
  private policy: AutoUpdatePolicy = DEFAULT_AUTO_UPDATE_POLICY
  private lastCheckAt = 0
  private checkInFlight: Promise<UpdateState> | null = null
  private followUpInFlight: Promise<void> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private launchTimer: ReturnType<typeof setTimeout> | null = null
  /** Packaged feed: GitHub first, gh-proxy after a China-side failure. */
  private usingProxyFeed = false

  constructor(userDataDir?: string) {
    this.userDataDir = userDataDir ?? tryUserDataDir()
    this.skippedVersion = this.readSkippedVersion()
    if (!app.isPackaged) return
    clearOrphanedMacShipIt()
    autoUpdater.autoDownload = false
    // Install-on-quit belongs to `auto` only. Forcing it on breaks `download`'s
    // contract ("Restart to install when you are ready"): a staged package would
    // otherwise be applied by Squirrel.Mac / NSIS on the *next* quit, killing the
    // app mid-turn. Kept in sync with the live policy in {@link applyPolicy}.
    autoUpdater.autoInstallOnAppQuit = shouldAutoInstall(this.policy)
    autoUpdater.allowDowngrade = false
    // Public GitHub Releases — no token required for check/download.
    autoUpdater.on('download-progress', (p) => {
      if (this.cancelRequested || this.state.phase !== 'downloading') return
      this.patch({
        phase: 'downloading',
        progress: Math.max(0, Math.min(100, Math.round(p.percent))),
        bytesPerSecond: Number.isFinite(p.bytesPerSecond) ? p.bytesPerSecond : null
      })
    })
    autoUpdater.on('error', (err) => {
      if (this.cancelRequested || isUpdateCancellationError(err)) return
      if (
        this.state.phase === 'checking' ||
        this.state.phase === 'downloading' ||
        this.state.phase === 'preparing' ||
        this.state.phase === 'ready'
      ) {
        if (this.state.phase === 'preparing') {
          this.rememberSkippedVersion(this.state.latestVersion)
          this.finishNativeReadyWait(false)
          clearOrphanedMacShipIt()
        }
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
        this.finishNativeReadyWait(true)
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

  /**
   * Start the background scheduler. Launch check is delayed so first paint
   * is not competing with GitHub; later polls use the heartbeat + focus.
   */
  start(policy: AutoUpdatePolicy): void {
    void this.applyPolicy(policy, 'start')
  }

  /** Settings change — take effect immediately (check / download / install). */
  setPolicy(policy: AutoUpdatePolicy): void {
    void this.applyPolicy(policy, 'change')
  }

  /** A VAV window became focused (not screenshot overlays). */
  notifyWindowActive(): void {
    void this.runAutomatic('focus')
  }

  private async applyPolicy(
    policy: AutoUpdatePolicy,
    source: 'start' | 'change'
  ): Promise<void> {
    this.policy = policy
    if (app.isPackaged) autoUpdater.autoInstallOnAppQuit = shouldAutoInstall(policy)
    this.syncHeartbeat()
    if (source === 'start') {
      this.clearLaunchTimer()
      if (!shouldRunAutomaticCheck({
        policy: this.policy,
        reason: 'launch',
        now: Date.now(),
        lastCheckAt: this.lastCheckAt,
        busy: this.isBusy()
      })) {
        return
      }
      this.launchTimer = setTimeout(() => {
        this.launchTimer = null
        void this.runAutomatic('launch')
      }, UPDATE_LAUNCH_DELAY_MS)
      this.launchTimer.unref?.()
      return
    }
    this.clearLaunchTimer()
    await this.applyFollowUp()
    await this.runAutomatic('policy')
  }

  private syncHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
    if (this.policy === 'off') return
    this.heartbeat = setInterval(() => {
      void this.runAutomatic('heartbeat')
    }, UPDATE_HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  private clearLaunchTimer(): void {
    if (!this.launchTimer) return
    clearTimeout(this.launchTimer)
    this.launchTimer = null
  }

  private isBusy(): boolean {
    return (
      this.checkInFlight != null ||
      this.downloading ||
      isUpdateBusyPhase(this.state.phase) ||
      isUpdateSettledPhase(this.state.phase)
    )
  }

  private async runAutomatic(reason: UpdateCheckReason): Promise<void> {
    if (
      !shouldRunAutomaticCheck({
        policy: this.policy,
        reason,
        now: Date.now(),
        lastCheckAt: this.lastCheckAt,
        busy: this.isBusy()
      })
    ) {
      return
    }
    await this.check()
  }

  private async applyFollowUp(): Promise<void> {
    if (this.followUpInFlight) return this.followUpInFlight
    const action = nextUpdateFollowUp(this.policy, this.state.phase)
    if (action === 'none') return
    this.followUpInFlight = (async () => {
      try {
        // Unpackaged: no staged package — keep download / install manual
        // (opening the GitHub asset is the About-page Download button).
        if (!app.isPackaged) return
        if (action === 'download') {
          if (
            shouldSkipAutoFollowUp({
              sessionSkip: this.skipAutoDownload,
              skippedVersion: this.skippedVersion,
              latestVersion: this.state.latestVersion
            })
          ) {
            return
          }
          await this.openDownload()
          if (nextUpdateFollowUp(this.policy, this.state.phase) === 'install') {
            this.install()
          }
          return
        }
        this.install()
      } finally {
        this.followUpInFlight = null
      }
    })()
    return this.followUpInFlight
  }

  async check(): Promise<UpdateState> {
    if (this.checkInFlight) return this.checkInFlight
    if (this.downloading || isUpdateSettledPhase(this.state.phase)) {
      return this.getState()
    }
    this.lastCheckAt = Date.now()
    this.checkInFlight = this.performCheck().finally(() => {
      this.checkInFlight = null
      void this.applyFollowUp()
    })
    return this.checkInFlight
  }

  private async performCheck(): Promise<UpdateState> {
    this.patch({ phase: 'checking', message: null, progress: 0, bytesPerSecond: null })
    if (!app.isPackaged) {
      return this.checkViaGithub()
    }
    try {
      return await this.readElectronUpdater()
    } catch (err) {
      console.warn('[updates] GitHub feed failed, retrying via gh-proxy', err)
      try {
        this.applyProxyFeed()
        return await this.readElectronUpdater()
      } catch (proxyErr) {
        console.warn('[updates] gh-proxy feed failed, falling back to GitHub API', proxyErr)
        return this.checkViaGithub()
      }
    }
  }

  private applyProxyFeed(): void {
    if (this.usingProxyFeed) return
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: githubProxyGenericFeedUrl()
    })
    this.usingProxyFeed = true
  }

  private async readElectronUpdater(): Promise<UpdateState> {
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
  }

  /**
   * Packaged: download the update package in-process.
   * Dev / fallback: open the asset URL in the browser.
   */
  async openDownload(): Promise<UpdateState> {
    if (this.state.phase === 'ready' || this.state.phase === 'preparing') return this.getState()
    if (this.downloadInFlight) {
      if (this.cancelRequested) await this.downloadInFlight.catch(() => undefined)
      else return this.downloadInFlight
    }
    // Explicit Download / Retry — allow auto-follow-up again for this version.
    this.clearSkippedVersion()
    this.downloadInFlight = this.performDownload().finally(() => {
      this.downloadInFlight = null
    })
    return this.downloadInFlight
  }

  /**
   * Abort an in-flight download or macOS unpack and return to Available so
   * the user can retry. Auto-download stays paused for this version until
   * they click Download (persisted across relaunch).
   */
  cancelDownload(): UpdateState {
    if (!canCancelUpdateDownload(this.state.phase)) return this.getState()
    this.cancelRequested = true
    this.rememberSkippedVersion(this.state.latestVersion)
    this.cancelToken?.cancel()
    if (this.state.phase === 'preparing') {
      this.finishNativeReadyWait(false)
      clearOrphanedMacShipIt()
    }
    return this.cancelledDownloadState()
  }

  private async performDownload(): Promise<UpdateState> {
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

    this.clearSkippedVersion()
    this.cancelRequested = false
    this.downloading = true
    this.nativeUpdateReady = false
    this.cancelToken = new CancellationToken()
    this.patch({ phase: 'downloading', progress: 0, bytesPerSecond: 0, message: null })
    try {
      try {
        await autoUpdater.downloadUpdate(this.cancelToken)
      } catch (err) {
        if (this.cancelRequested || isUpdateCancellationError(err)) throw err
        if (this.usingProxyFeed) throw err
        console.warn('[updates] GitHub download failed, retrying via gh-proxy', err)
        this.applyProxyFeed()
        await autoUpdater.checkForUpdates()
        if (this.cancelRequested) return this.cancelledDownloadState()
        await autoUpdater.downloadUpdate(this.cancelToken)
      }
      if (this.cancelRequested) return this.cancelledDownloadState()
      // macOS: ZIP is local, but Squirrel may still be verifying/unzipping.
      // Surface an explicit "preparing" phase — Restart must wait for this.
      if (process.platform === 'darwin' && !this.nativeUpdateReady) {
        this.patch({
          phase: 'preparing',
          progress: 100,
          bytesPerSecond: null,
          message: null
        })
        // electron-updater serves the ZIP locally, but only starts Squirrel
        // when autoInstallOnAppQuit is true. notify / download must kick it.
        if (
          shouldStartNativeMacStaging({
            nativeReady: this.nativeUpdateReady,
            autoInstallOnAppQuit: shouldAutoInstall(this.policy)
          })
        ) {
          try {
            console.info('[updates] starting Squirrel.Mac staging')
            electronAutoUpdater.checkForUpdates()
          } catch (err) {
            console.warn('[updates] Squirrel.Mac checkForUpdates failed', err)
          }
        }
        const staged = await this.waitForNativeUpdateReady()
        if (this.cancelRequested) return this.cancelledDownloadState()
        if (!staged || !this.nativeUpdateReady) {
          this.rememberSkippedVersion(this.state.latestVersion)
          clearOrphanedMacShipIt()
          return this.patch({
            phase: 'error',
            progress: 0,
            bytesPerSecond: null,
            message:
              'Update download finished but macOS unpacking stalled. Cancelled leftovers were cleared — retry, or install from the GitHub release DMG.'
          })
        }
      }
      return this.patch({
        phase: 'ready',
        progress: 100,
        bytesPerSecond: null,
        message: null
      })
    } catch (err) {
      if (this.cancelRequested || isUpdateCancellationError(err)) {
        return this.cancelledDownloadState()
      }
      return this.patch({
        phase: 'error',
        message: (err as Error).message,
        progress: 0,
        bytesPerSecond: null
      })
    } finally {
      this.downloading = false
      this.cancelToken = null
      this.cancelRequested = false
    }
  }

  private cancelledDownloadState(): UpdateState {
    return this.patch({
      phase: 'available',
      progress: 0,
      bytesPerSecond: null,
      message: null
    })
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
    // macOS: never hand off to ShipIt until native staging finished; otherwise
    // launchd keeps restarting ShipIt without ShipItState.plist.
    if (process.platform === 'darwin' && !this.nativeUpdateReady) {
      this.patch({
        phase: 'error',
        message: 'Update is still preparing. Wait for Restart to enable, then try again.'
      })
      return
    }
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

  /** @returns true when Squirrel.Mac emitted native update-downloaded. */
  private waitForNativeUpdateReady(
    timeoutMs = UPDATE_STAGING_TIMEOUT_MS
  ): Promise<boolean> {
    if (this.nativeUpdateReady) return Promise.resolve(true)
    return new Promise((resolve) => {
      const startedAt = Date.now()
      let settled = false
      const finish = (ready: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearInterval(poll)
        const idx = this.nativeReadyWaiters.indexOf(finish)
        if (idx >= 0) this.nativeReadyWaiters.splice(idx, 1)
        resolve(ready)
      }
      const tick = (): void => {
        const decision = nativeStagingWaitDecision({
          nativeReady: this.nativeUpdateReady,
          elapsedMs: Date.now() - startedAt,
          timeoutMs
        })
        if (decision === 'ready') {
          finish(true)
          return
        }
        if (decision === 'wait') return
        console.warn(
          `[updates] Squirrel.Mac staging ${decision}; not enabling Restart`
        )
        finish(false)
      }
      const timer = setTimeout(tick, timeoutMs)
      const poll = setInterval(tick, 2_000)
      poll.unref?.()
      timer.unref?.()
      this.nativeReadyWaiters.push(finish)
    })
  }

  private finishNativeReadyWait(ready: boolean): void {
    const waiters = this.nativeReadyWaiters.splice(0)
    for (const resolve of waiters) resolve(ready)
  }

  private skipFile(): string | null {
    return this.userDataDir ? join(this.userDataDir, 'update-skip.json') : null
  }

  private readSkippedVersion(): string | null {
    const file = this.skipFile()
    if (!file || !existsSync(file)) return null
    try {
      return parseSkippedUpdateVersion(JSON.parse(readFileSync(file, 'utf8')) as unknown)
    } catch {
      return null
    }
  }

  private rememberSkippedVersion(version: string | null): void {
    this.skipAutoDownload = true
    this.skippedVersion = version
    const file = this.skipFile()
    if (!file || !version) return
    try {
      writeFileSync(file, JSON.stringify({ skippedVersion: version }))
    } catch {
      // ignore
    }
  }

  private clearSkippedVersion(): void {
    this.skipAutoDownload = false
    this.skippedVersion = null
    const file = this.skipFile()
    if (!file || !existsSync(file)) return
    try {
      rmSync(file)
    } catch {
      // ignore
    }
  }

  private async checkViaGithub(): Promise<UpdateState> {
    try {
      try {
        return await this.readGithubLatest(false)
      } catch (directErr) {
        console.warn('[updates] GitHub API failed, retrying via gh-proxy', directErr)
        return await this.readGithubLatest(true)
      }
    } catch (err) {
      return this.patch({
        phase: 'error',
        message: (err as Error).message,
        bytesPerSecond: null
      })
    }
  }

  private async readGithubLatest(proxy: boolean): Promise<UpdateState> {
    const res = await fetch(githubLatestReleaseApiUrl(proxy), {
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

    const asset = pickAsset(body.assets ?? [])
    const downloadUrl = asset ? (proxy ? viaGithubProxy(asset) : asset) : (body.html_url ?? null)
    return this.patch({
      phase: 'available',
      latestVersion: latest,
      releaseUrl: body.html_url ?? null,
      downloadUrl,
      message: null,
      bytesPerSecond: null
    })
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

/**
 * Squirrel.Mac registers a launchd job that restarts every ~2s on failure.
 * If quitAndInstall was interrupted before writing ShipItState.plist, the job
 * spins forever and can re-surface Gatekeeper prompts for the install target.
 */
export function clearOrphanedMacShipIt(): void {
  if (process.platform !== 'darwin') return
  const cacheDir = join(homedir(), 'Library/Caches/com.vav.app.ShipIt')

  // Always unload the job on a normal launch so a finished update does not
  // linger in Login Items. Also drop the cache: a leftover ShipItState.plist
  // from a previous install poisons the next unzip — native update-downloaded
  // never fires and the UI sticks on “Unpacking update”.
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/com.vav.app.ShipIt`], {
      stdio: 'ignore'
    })
  } catch {
    // Job may not be loaded — fine.
  }
  try {
    rmSync(cacheDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function tryUserDataDir(): string | null {
  try {
    return app.getPath('userData')
  } catch {
    return null
  }
}
