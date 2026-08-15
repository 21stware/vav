/**
 * Sibling BrowserWindows (isolated session, warm-pool refill) can drop this
 * window's compositor textures. Kick a paint so idle transcripts / xterm
 * canvases do not sit on a stale frame until the next content write.
 */
import { refreshAllTerminals } from './terminalRegistryHandle'

function kickCompositor(): void {
  const root = document.documentElement
  const prev = root.style.opacity
  root.style.opacity = '0.999'
  void root.offsetHeight
  requestAnimationFrame(() => {
    root.style.opacity = prev
  })
}

export function installSiblingRepaint(): () => void {
  const onRepaint = window.vav?.window?.onRepaint
  const offIpc = typeof onRepaint === 'function' ? onRepaint(paint) : undefined

  const onBlur = (): void => {
    // Another window in this app just came forward — same GPU-surface race.
    paint()
  }
  window.addEventListener('blur', onBlur)

  return () => {
    offIpc?.()
    window.removeEventListener('blur', onBlur)
  }
}

function paint(): void {
  kickCompositor()
  refreshAllTerminals()
}
