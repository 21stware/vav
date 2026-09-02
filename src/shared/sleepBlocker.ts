/**
 * Decide when VAV should hold an OS idle-sleep assertion, and (on macOS)
 * whether to flip `pmset disablesleep` so lid-close does not sleep the machine.
 *
 * A turn waiting on the user (`paused`) is not work — the machine may sleep.
 * An idle CLI pane sitting at a prompt is not work either. Only an actively
 * running VAV/CLI turn, or a CLI agent PTY that is producing output / has
 * children, counts.
 */

export type TurnActivity = 'running' | 'paused'
export type PtyActivity = 'running' | 'idle' | 'exited'

export const KEEP_AWAKE_BATTERY_FLOOR_MIN = 5
export const KEEP_AWAKE_BATTERY_FLOOR_MAX = 50
export const KEEP_AWAKE_BATTERY_FLOOR_DEFAULT = 15

export const PMSET_DISABLESLEEP_0 = '/usr/bin/pmset -a disablesleep 0'
export const PMSET_DISABLESLEEP_1 = '/usr/bin/pmset -a disablesleep 1'
export const SUDOERS_KEEP_AWAKE_FILE = 'vav-disablesleep'

const SAFE_USERNAME = /^[A-Za-z0-9._-]+$/

export function hasActiveAgentWork(input: {
  turns?: Iterable<TurnActivity>
  cliAgentStatuses?: Iterable<PtyActivity>
}): boolean {
  if (input.turns) {
    for (const phase of input.turns) {
      if (phase === 'running') return true
    }
  }
  if (input.cliAgentStatuses) {
    for (const status of input.cliAgentStatuses) {
      if (status === 'running') return true
    }
  }
  return false
}

/** Caffeine-style idle assertion. Safety holds (low battery / LPM) drop it. */
export function shouldBlockIdleSleep(
  enabled: boolean,
  hasWork: boolean,
  safety: KeepAwakeSafetyHold = null
): boolean {
  return enabled === true && hasWork && safety == null
}

/**
 * Lid-close / Apple-menu Sleep. Needs the scoped sudoers grant; same safety
 * holds as the idle assertion.
 */
export function shouldBlockLidSleep(
  enabled: boolean,
  hasWork: boolean,
  granted: boolean,
  safety: KeepAwakeSafetyHold = null
): boolean {
  return enabled === true && hasWork && granted && safety == null
}

export type KeepAwakeSafetyHold = 'battery' | 'low-power' | null

export function clampKeepAwakeBatteryFloor(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return KEEP_AWAKE_BATTERY_FLOOR_DEFAULT
  return Math.min(
    KEEP_AWAKE_BATTERY_FLOOR_MAX,
    Math.max(KEEP_AWAKE_BATTERY_FLOOR_MIN, Math.round(n))
  )
}

export function keepAwakeSafetyHold(input: {
  onBattery: boolean
  discharging: boolean
  percent: number
  lowPowerMode: boolean
  floorPercent: number
}): KeepAwakeSafetyHold {
  if (!input.onBattery || !input.discharging) return null
  if (input.percent <= input.floorPercent) return 'battery'
  if (input.lowPowerMode) return 'low-power'
  return null
}

export function sudoersGrantLine(username: string): string | null {
  if (!SAFE_USERNAME.test(username)) return null
  return `${username} ALL=(root) NOPASSWD: ${PMSET_DISABLESLEEP_0}, ${PMSET_DISABLESLEEP_1}`
}

export function grantListedInSudoL(output: string): boolean {
  const compact = output.replace(/\s+/g, ' ')
  return (
    compact.includes(PMSET_DISABLESLEEP_0) && compact.includes('disablesleep 1')
  )
}

export function parseSleepDisabled(pmsetG: string): boolean {
  for (const line of pmsetG.split('\n')) {
    if (!/SleepDisabled/i.test(line)) continue
    const toks = line.trim().split(/\s+/)
    return toks[toks.length - 1] === '1'
  }
  return false
}

export function parseLowPowerMode(pmsetG: string): boolean {
  for (const line of pmsetG.split('\n')) {
    if (!/lowpowermode/i.test(line)) continue
    const toks = line.trim().split(/\s+/)
    return toks[toks.length - 1] === '1'
  }
  return false
}

export function parseBatteryStatus(pmsetBatt: string): {
  onBattery: boolean
  discharging: boolean
  percent: number
} {
  const onBattery = /Battery Power/i.test(pmsetBatt)
  const discharging = /discharging/i.test(pmsetBatt)
  let percent = 100
  const match = pmsetBatt.match(/(\d+)\s*%/)
  if (match) percent = Number(match[1])
  return { onBattery, discharging, percent }
}

export type KeepAwakeStatus = {
  /** macOS only — Windows/Linux stay on the idle assertion. */
  lidSupported: boolean
  granted: boolean
  idleBlocked: boolean
  lidSleepBlocked: boolean
  onBattery: boolean
  batteryPercent: number
  lowPowerMode: boolean
  safetyHold: KeepAwakeSafetyHold
  hasWork: boolean
}

export type KeepAwakeGrantResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string }
