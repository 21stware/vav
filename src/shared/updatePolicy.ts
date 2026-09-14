import type { UpdatePhase } from './changeSet.ts'

/**
 * How VAV looks for (and applies) app updates.
 *
 * `notify` is the product default: check in the background, prompt when a
 * newer build exists. Manual “Check for Updates” in About always works.
 */
export const AUTO_UPDATE_POLICIES = ['off', 'notify', 'download', 'auto'] as const
export type AutoUpdatePolicy = (typeof AUTO_UPDATE_POLICIES)[number]
export const DEFAULT_AUTO_UPDATE_POLICY: AutoUpdatePolicy = 'notify'

/** Periodic GitHub / electron-updater poll while the app is running. */
export const UPDATE_HEARTBEAT_MS = 4 * 60 * 60 * 1000
/** Re-check at most this often when a window becomes focused. */
export const UPDATE_FOCUS_COOLDOWN_MS = 30 * 60 * 1000
/** Let first paint finish before the launch check. */
export const UPDATE_LAUNCH_DELAY_MS = 2_400

export function isAutoUpdatePolicy(value: unknown): value is AutoUpdatePolicy {
  return typeof value === 'string' && (AUTO_UPDATE_POLICIES as readonly string[]).includes(value)
}

/**
 * Prefer the explicit policy. Legacy `autoCheckUpdates: false` maps to `off`;
 * any other leftover boolean (or a missing field) becomes `notify`.
 */
export function resolveAutoUpdatePolicy(raw: {
  autoUpdatePolicy?: unknown
  autoCheckUpdates?: unknown
}): AutoUpdatePolicy {
  if (isAutoUpdatePolicy(raw.autoUpdatePolicy)) return raw.autoUpdatePolicy
  if (raw.autoCheckUpdates === false) return 'off'
  return DEFAULT_AUTO_UPDATE_POLICY
}

export function shouldAutoCheck(policy: AutoUpdatePolicy): boolean {
  return policy !== 'off'
}

export function shouldAutoDownload(policy: AutoUpdatePolicy): boolean {
  return policy === 'download' || policy === 'auto'
}

export function shouldAutoInstall(policy: AutoUpdatePolicy): boolean {
  return policy === 'auto'
}

/**
 * electron-updater only starts Squirrel.Mac during `downloadUpdate()` when
 * `autoInstallOnAppQuit` is on (`auto` policy). notify / download must kick
 * the native fetch ourselves after the ZIP is local, or `update-downloaded`
 * never fires and the UI sits on “Unpacking update”.
 */
export function shouldStartNativeMacStaging(opts: {
  nativeReady: boolean
  autoInstallOnAppQuit: boolean
}): boolean {
  return !opts.nativeReady && !opts.autoInstallOnAppQuit
}

export type UpdateCheckReason = 'launch' | 'heartbeat' | 'focus' | 'policy'

export function isUpdateBusyPhase(phase: UpdatePhase): boolean {
  return phase === 'checking' || phase === 'downloading' || phase === 'preparing'
}

/** Skip a new check once a package is staged — Restart / auto-install owns it. */
export function isUpdateSettledPhase(phase: UpdatePhase): boolean {
  return phase === 'ready'
}

export function shouldRunAutomaticCheck(opts: {
  policy: AutoUpdatePolicy
  reason: UpdateCheckReason
  now: number
  lastCheckAt: number
  busy: boolean
}): boolean {
  if (!shouldAutoCheck(opts.policy) || opts.busy) return false
  if (opts.reason === 'policy') return true
  // Launch is the fallback when no window has focused yet.
  if (opts.reason === 'launch') return opts.lastCheckAt === 0
  const elapsed = opts.now - opts.lastCheckAt
  if (opts.reason === 'focus') return elapsed >= UPDATE_FOCUS_COOLDOWN_MS
  return elapsed >= UPDATE_HEARTBEAT_MS
}

export type UpdateFollowUp = 'none' | 'download' | 'install'

export function nextUpdateFollowUp(
  policy: AutoUpdatePolicy,
  phase: UpdatePhase
): UpdateFollowUp {
  if (phase === 'available' && shouldAutoDownload(policy)) return 'download'
  if (phase === 'ready' && shouldAutoInstall(policy)) return 'install'
  return 'none'
}

/** True when electron-updater (or our token) aborted an in-flight download. */
export function isUpdateCancellationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? String(err.name) : ''
  const message = 'message' in err ? String(err.message) : ''
  return name === 'CancellationError' || /cancell?ed/i.test(message)
}

/** Download bytes or macOS Squirrel staging — both must be abortable. */
export function canCancelUpdateDownload(phase: UpdatePhase): boolean {
  return phase === 'downloading' || phase === 'preparing'
}

/** After a failed check/download/staging, retry the package if we still know the target. */
export function canRetryUpdateDownload(
  phase: UpdatePhase,
  latestVersion: string | null
): boolean {
  return phase === 'error' && Boolean(latestVersion)
}

/**
 * User cancelled, or macOS staging failed for this version. Auto-download
 * must not immediately re-enter `preparing` after a relaunch.
 */
export function shouldSkipAutoFollowUp(opts: {
  sessionSkip: boolean
  skippedVersion: string | null
  latestVersion: string | null
}): boolean {
  if (opts.sessionSkip) return true
  return (
    opts.skippedVersion != null &&
    opts.latestVersion != null &&
    opts.skippedVersion === opts.latestVersion
  )
}

export function parseSkippedUpdateVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const version = (raw as { skippedVersion?: unknown }).skippedVersion
  return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null
}

/** How long to wait for Squirrel.Mac after the ZIP is local. Real unzips can take minutes. */
export const UPDATE_STAGING_TIMEOUT_MS = 10 * 60 * 1000

export type NativeStagingWait = 'ready' | 'wait' | 'timeout'

/**
 * Native `update-downloaded` is the only safe “Restart” signal.
 * Squirrel.Mac verifies and unzips in-process — ShipIt is not running yet —
 * so a missing ShipIt process is not a failed unpack.
 */
export function nativeStagingWaitDecision(opts: {
  nativeReady: boolean
  elapsedMs: number
  timeoutMs?: number
}): NativeStagingWait {
  if (opts.nativeReady) return 'ready'
  const timeoutMs = opts.timeoutMs ?? UPDATE_STAGING_TIMEOUT_MS
  if (opts.elapsedMs >= timeoutMs) return 'timeout'
  return 'wait'
}
