/**
 * Marks live window resize so CSS / terminals can drop expensive work until
 * the pointer settles. Chromium trails the native frame by a frame or two;
 * cheaper paints are what keeps that lag from feeling sticky.
 */

const IDLE_MS = 100
let installed = false
let idleTimer: ReturnType<typeof setTimeout> | null = null

export function installLiveResizeTracking(): () => void {
  if (installed) return () => undefined
  installed = true

  const onResize = (): void => {
    document.documentElement.dataset.resizing = 'true'
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleTimer = null
      delete document.documentElement.dataset.resizing
      window.dispatchEvent(new Event('vav:resize-end'))
    }, IDLE_MS)
  }

  window.addEventListener('resize', onResize, { passive: true })
  return () => {
    window.removeEventListener('resize', onResize)
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    delete document.documentElement.dataset.resizing
    installed = false
  }
}
