import type { BrowserWindow } from 'electron'

/**
 * Lock the native frame so the user cannot drag it smaller than `width`×`height`.
 * Electron grows the window when the current size is already below the floor.
 */
export function applyWindowMinSize(win: BrowserWindow, width: number, height: number): void {
  if (win.isDestroyed()) return
  const nextWidth = Math.max(1, Math.round(width))
  const nextHeight = Math.max(1, Math.round(height))
  win.setMinimumSize(nextWidth, nextHeight)
  if (win.isMaximized() || win.isFullScreen()) return
  const [currentWidth, currentHeight] = win.getSize()
  if (currentWidth < nextWidth || currentHeight < nextHeight) {
    win.setSize(Math.max(currentWidth, nextWidth), Math.max(currentHeight, nextHeight))
  }
}
