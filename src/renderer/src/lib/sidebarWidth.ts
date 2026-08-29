/**
 * Docked sidebar width: user-resizable within [MIN, MAX], persisted per app.
 * The floating (narrow-window) sidebar keeps the default CSS width.
 */

export const SIDEBAR_WIDTH_MIN = 190
export const SIDEBAR_WIDTH_MAX = 420
/** Matches --sidebar-width in index.css. */
export const SIDEBAR_WIDTH_DEFAULT = 232

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
  try {
    localStorage.setItem(STORAGE_KEY, String(clampSidebarWidth(value)))
  } catch {
    // ignore
  }
}
