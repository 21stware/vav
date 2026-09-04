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
