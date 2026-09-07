/**
 * Marks whether this BrowserWindow is the key window so CSS can paint
 * AppKit-style inactive controls (graphite default buttons, gray toggles).
 *
 * Chromium has no `:window-inactive`; blur/focus + `document.hasFocus()` is
 * the reliable signal on every window kind (main, session, Settings, popups).
 */

let installed = false

export function installWindowFocusTracking(): () => void {
  if (installed) return () => undefined
  installed = true

  const root = document.documentElement
  const sync = (): void => {
    root.dataset.windowFocused = document.hasFocus() ? 'true' : 'false'
  }
  sync()
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  return () => {
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
    delete root.dataset.windowFocused
    installed = false
  }
}
