import type { UpdatePhase } from './changeSet.ts'

/**
 * How VAV looks for (and applies) app updates.
 *
 * `notify` is the product default: check in the background, prompt when a
 * newer build exists. Manual “Check for Updates” in About always works.
 *
 * There are only three policies now. The retired `auto` policy silently
 * installed on the next quit and restarted the app out from under the user —
 * a landmine for a tray-resident app. VAV never restarts to install without an
 * explicit Restart click; the strongest policy (`download`) fetches in the
 * background and then waits for that click.
 */
export const AUTO_UPDATE_POLICIES = ['off', 'notify', 'download'] as const
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
 * Prefer the explicit policy. Legacy `auto` (silent install-on-quit) is retired
 * and maps to `download`. Legacy `autoCheckUpdates: false` maps to `off`; any
 * other leftover boolean (or a missing field) becomes `notify`.
 */
export function resolveAutoUpdatePolicy(raw: {
  autoUpdatePolicy?: unknown
  autoCheckUpdates?: unknown
}): AutoUpdatePolicy {
  if (raw.autoUpdatePolicy === 'auto') return 'download'
  if (isAutoUpdatePolicy(raw.autoUpdatePolicy)) return raw.autoUpdatePolicy
  if (raw.autoCheckUpdates === false) return 'off'
  return DEFAULT_AUTO_UPDATE_POLICY
}

export function shouldAutoCheck(policy: AutoUpdatePolicy): boolean {
  return policy !== 'off'
}

export function shouldAutoDownload(policy: AutoUpdatePolicy): boolean {
  return policy === 'download'
}

export type UpdateCheckReason = 'launch' | 'heartbeat' | 'focus' | 'policy'

export function isUpdateBusyPhase(phase: UpdatePhase): boolean {
  return phase === 'checking' || phase === 'downloading' || phase === 'preparing'
}

/** Skip a new check once a package is staged — Restart owns it. */
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

/**
 * Automatic follow-up after a check. Only `download` ever auto-fetches, and it
 * stops at `ready` — installing is always an explicit user gesture.
 */
export type UpdateFollowUp = 'none' | 'download'

export function nextUpdateFollowUp(
  policy: AutoUpdatePolicy,
  phase: UpdatePhase
): UpdateFollowUp {
  if (phase === 'available' && shouldAutoDownload(policy)) return 'download'
  return 'none'
}

/** True when electron-updater (or our token) aborted an in-flight download. */
export function isUpdateCancellationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? String(err.name) : ''
  const message = 'message' in err ? String(err.message) : ''
  return name === 'CancellationError' || /cancell?ed/i.test(message)
}

/** Only the byte transfer is abortable; staging happens during Restart. */
export function canCancelUpdateDownload(phase: UpdatePhase): boolean {
  return phase === 'downloading'
}

/** After a failed check/download, retry the package if we still know the target. */
export function canRetryUpdateDownload(
  phase: UpdatePhase,
  latestVersion: string | null
): boolean {
  return phase === 'error' && Boolean(latestVersion)
}

/**
 * User cancelled this version's download. Auto-download must not immediately
 * re-fetch it; the user has to click Download. Session-only — a relaunch
 * forgets the skip, so a stuck suppression can never outlive the process.
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
