import { PREVIEW_MIN_WIDTH } from '@shared/shellMinSize'
import type { ApplicationsMode } from '../state/sessionTypes'

export const APPLICATIONS_WIDTH_MIN = PREVIEW_MIN_WIDTH
export const APPLICATIONS_WIDTH_MAX = 720
export const APPLICATIONS_WIDTH_DEFAULT = 380

/** App column wide enough for list + detail side by side (tablet regular). */
export const APP_SPLIT_MIN_WIDTH = 560

export type AppSplitLayout = 'split' | 'stack'

export function appSplitLayout(width: number): AppSplitLayout {
  return width >= APP_SPLIT_MIN_WIDTH ? 'split' : 'stack'
}

export const APPLICATIONS_WIDTH_CHANGED = 'vav:applications-width'

const STORAGE_KEY = 'vav.applications-width'

export function clampApplicationsWidth(value: number): number {
  if (!Number.isFinite(value)) return APPLICATIONS_WIDTH_DEFAULT
  return Math.round(Math.min(APPLICATIONS_WIDTH_MAX, Math.max(APPLICATIONS_WIDTH_MIN, value)))
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
}): ApplicationsMode | null {
  if (row.sessionKind === 'timer') return 'scheduled'
  if (row.fileId || row.sessionKind === 'file') return 'storage'
  if (row.sessionKind === 'db') return 'data'
  if (row.sessionKind === 'knowledge') return 'knowledge'
  return null
}
