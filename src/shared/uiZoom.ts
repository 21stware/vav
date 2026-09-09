/**
 * Whole-UI zoom. `1` is 100%. Shared by Appearance and the View menu.
 *
 * Applied as Chromium `webContents.setZoomFactor` so layout px, xterm, and
 * canvases all scale together. Screenshot overlays and measured popups
 * (`token-usage`, `provider-account`) stay at 1.
 */

export const UI_ZOOM_MIN = 0.75
export const UI_ZOOM_MAX = 1.5
export const UI_ZOOM_STEP = 0.05
export const UI_ZOOM_DEFAULT = 1

export const UI_ZOOM_MIN_PERCENT = 75
export const UI_ZOOM_MAX_PERCENT = 150
export const UI_ZOOM_STEP_PERCENT = 5

const SKIP_VIEWS = new Set(['token-usage', 'provider-account'])

export function clampUiZoom(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return UI_ZOOM_DEFAULT
  const snapped = Math.round(n / UI_ZOOM_STEP) * UI_ZOOM_STEP
  const rounded = Math.round(snapped * 100) / 100
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, rounded))
}

export function uiZoomPercent(value: unknown): number {
  return Math.round(clampUiZoom(value) * 100)
}

export function uiZoomFromPercent(percent: unknown): number {
  return clampUiZoom(Number(percent) / 100)
}

export function stepUiZoom(current: unknown, direction: 1 | -1): number {
  return clampUiZoom(clampUiZoom(current) + direction * UI_ZOOM_STEP)
}

/** False for overlay / measured-popup renderers that must stay at 100%. */
export function uiZoomAppliesToUrl(url: string): boolean {
  if (!url) return true
  const lower = url.toLowerCase()
  if (lower.includes('screenshot.html')) return false
  let view: string | null = null
  try {
    view = new URL(url).searchParams.get('view')
  } catch {
    const match = /[?&]view=([^&]*)/.exec(url)
    view = match?.[1] ? decodeURIComponent(match[1]) : null
  }
  return !view || !SKIP_VIEWS.has(view)
}
