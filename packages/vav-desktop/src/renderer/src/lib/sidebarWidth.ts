/**
 * Docked sidebar width: user-resizable within [MIN, MAX], persisted per app.
 * The floating (narrow-window) sidebar keeps the default CSS width.
 */

import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN
} from '@shared/shellMinSize'

export { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN }

export const SIDEBAR_WIDTH_CHANGED = 'vav:sidebar-width'

const STORAGE_KEY = 'vav.sidebar-width'

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, value)))
}

export function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return SIDEBAR_WIDTH_DEFAULT
    return clampSidebarWidth(Number(raw))
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

export function persistSidebarWidth(value: number): void {
  const next = clampSidebarWidth(value)
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(SIDEBAR_WIDTH_CHANGED, { detail: next }))
}
