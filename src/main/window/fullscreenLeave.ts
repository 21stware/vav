/** Duck-typed BrowserWindow surface so unit tests never import Electron. */
export type FullscreenLeaveWindow = {
  isDestroyed: () => boolean
  isFullScreen: () => boolean
  once: (event: 'leave-full-screen', listener: () => void) => unknown
  setFullScreen: (value: boolean) => unknown
}

/**
 * macOS leaves a blank black Space if a window is hidden/destroyed while still
 * in native fullscreen. Always exit fullscreen first, then run the action.
 */
export function afterLeavingFullscreen(win: FullscreenLeaveWindow, next: () => void): void {
  if (win.isDestroyed()) return
  if (!win.isFullScreen()) {
    next()
    return
  }
  win.once('leave-full-screen', () => {
    if (!win.isDestroyed()) next()
  })
  win.setFullScreen(false)
}

export function hideLeavingFullscreen(
  win: FullscreenLeaveWindow & { hide: () => void }
): void {
  afterLeavingFullscreen(win, () => {
    if (!win.isDestroyed()) win.hide()
  })
}

/** Exit fullscreen, mark the one-shot close allow, then destroy. */
export function destroyLeavingFullscreen(
  win: FullscreenLeaveWindow & { destroy: () => void },
  markAllowed: () => void
): void {
  afterLeavingFullscreen(win, () => {
    if (win.isDestroyed()) return
    markAllowed()
    win.destroy()
  })
}

export type CloseLeavingFullscreenDisposition = 'allow' | 'allow-once' | 'leave-then-reclose'

/**
 * On `close`, if still fullscreen, cancel and exit FS first, then re-close.
 * Pair with real destroy (preview, non-Mac main, etc.) — not hide-on-close.
 */
export function closeLeavingFullscreenDisposition(opts: {
  quitting: boolean
  destroyed: boolean
  alreadyAllowed: boolean
  isFullScreen: boolean
}): CloseLeavingFullscreenDisposition {
  if (opts.quitting || opts.destroyed) return 'allow'
  if (opts.alreadyAllowed) return 'allow-once'
  if (opts.isFullScreen) return 'leave-then-reclose'
  return 'allow'
}
