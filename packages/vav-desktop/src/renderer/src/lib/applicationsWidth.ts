import { AGENT_MIN_WIDTH, APPLICATIONS_WIDTH_MIN } from '@shared/shellMinSize'
import type { ApplicationsMode } from '../state/sessionTypes'

export { APPLICATIONS_WIDTH_MIN }
export const APPLICATIONS_WIDTH_DEFAULT = 380

/** App column wide enough for list + detail side by side (tablet regular). */
export const APP_SPLIT_MIN_WIDTH = 560

export type AppSplitLayout = 'split' | 'stack'

export function appSplitLayout(width: number): AppSplitLayout {
  return width >= APP_SPLIT_MIN_WIDTH ? 'split' : 'stack'
}

export const APPLICATIONS_WIDTH_CHANGED = 'vav:applications-width'

const STORAGE_KEY = 'vav.applications-width'

/**
 * Widest the app column may be dragged while the agent still has its floor.
 * `available` is the split minus the docked sidebar (agent + app together).
 * Live fitting is CSS on `.body-split`: this budget is only the drag ceiling.
 * The preferred width stays put when the shell shrinks; flex gives the space back.
 */
export function applicationsWidthBudget(
  availableForAgentAndApp: number,
  agentMin = AGENT_MIN_WIDTH
): number {
  if (!Number.isFinite(availableForAgentAndApp)) return APPLICATIONS_WIDTH_MIN
  return Math.max(
    APPLICATIONS_WIDTH_MIN,
    Math.round(availableForAgentAndApp - agentMin)
  )
}

export function clampApplicationsWidth(value: number, max = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value)) return APPLICATIONS_WIDTH_DEFAULT
  const hi = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY
  return Math.round(Math.min(hi, Math.max(APPLICATIONS_WIDTH_MIN, value)))
}

export function loadApplicationsWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return APPLICATIONS_WIDTH_DEFAULT
    return clampApplicationsWidth(Number(raw))
  } catch {
    return APPLICATIONS_WIDTH_DEFAULT
  }
}

export function persistApplicationsWidth(value: number): void {
  const next = clampApplicationsWidth(value)
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(APPLICATIONS_WIDTH_CHANGED, { detail: next }))
}

export function applicationsModeForConversation(row: {
  fileId?: string | null
  sessionKind?: string | null
  timerRunId?: string | null
}): ApplicationsMode | null {
  if (row.sessionKind === 'timer') return row.timerRunId ? null : 'scheduled'
  if (row.fileId || row.sessionKind === 'file') return 'storage'
  if (row.sessionKind === 'db') return 'data'
  if (row.sessionKind === 'knowledge') return 'knowledge'
  return null
}
