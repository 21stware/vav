/**
 * First-paint window fill and macOS vibrancy. Color math is pure so tests
 * do not need Electron; BrowserWindow calls stay best-effort.
 */
import type { BrowserWindow } from 'electron'

export const WINDOW_BG_DARK = '#121213'
export const WINDOW_BG_LIGHT = '#ececee'

export function windowBackgroundColor(dark: boolean, alpha = ''): string {
  return (dark ? WINDOW_BG_DARK : WINDOW_BG_LIGHT) + alpha
}

export function windowThemeNameFromDark(dark: boolean): 'dark' | 'light' {
  return dark ? 'dark' : 'light'
}

/** Matches renderer `--toolbar-height` (sidebar / agent / file-preview chrome). */
export const TOOLBAR_HEIGHT = 42

export function trafficLightOrigin(barHeight = TOOLBAR_HEIGHT): { x: number; y: number } {
  return { x: 12, y: Math.round((barHeight - 12) / 2) }
}

/** `barHeight` matches the renderer's own title bar, so the two rows line up. */
export function overlayColors(
  dark: boolean,
  barHeight = TOOLBAR_HEIGHT
): { color: string; symbolColor: string; height: number } {
  return {
    color: dark ? WINDOW_BG_DARK : WINDOW_BG_LIGHT,
    symbolColor: dark ? '#efeff1' : '#141416',
    height: barHeight
  }
}

export type WindowChromeOptions = {
  titleBarStyle: 'hiddenInset' | 'hidden'
  trafficLightPosition?: { x: number; y: number }
  acceptFirstMouse: true
  transparent?: true
  backgroundColor: string
  vibrancy?: 'under-window'
  visualEffectState?: 'active'
  titleBarOverlay?: { color: string; symbolColor: string; height: number }
  autoHideMenuBar?: false
}

/** Frameless chrome: macOS hiddenInset + optional glass, Windows titleBarOverlay. */
export function chromeOptions(input: {
  isMac: boolean
  barHeight: number
  vibrancyShell?: boolean
  vibrancyEnabled: boolean
  background: string
  backgroundVibrancy: string
  overlay: { color: string; symbolColor: string; height: number }
}): WindowChromeOptions {
  if (input.isMac) {
    if (input.vibrancyShell) {
      return {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: trafficLightOrigin(input.barHeight),
        acceptFirstMouse: true,
        transparent: true,
        backgroundColor: input.backgroundVibrancy,
        ...(input.vibrancyEnabled
          ? {
              vibrancy: 'under-window' as const,
              visualEffectState: 'active' as const
            }
          : {})
      }
    }
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: trafficLightOrigin(input.barHeight),
      acceptFirstMouse: true,
      backgroundColor: input.background
    }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: input.overlay,
    backgroundColor: input.background,
    acceptFirstMouse: true,
    autoHideMenuBar: false
  }
}

export function primeRendererShell(
  win: BrowserWindow,
  options: { clear?: boolean; dark: boolean }
): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  const bg = options.clear ? 'transparent' : windowBackgroundColor(options.dark)
  const scheme = windowThemeNameFromDark(options.dark)
  const css = `html,body,#root{background:${bg}!important;margin:0;height:100%;color-scheme:${scheme}}`
  const inject = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    void win.webContents.insertCSS(css).catch(() => undefined)
  }
  inject()
  win.webContents.once('dom-ready', inject)
}

export function applyWindowVibrancy(win: BrowserWindow, dark: boolean): void {
  if (process.platform !== 'darwin' || win.isDestroyed()) return
  try {
    win.setBackgroundColor(windowBackgroundColor(dark, '01'))
    win.setVibrancy('under-window', { animationDuration: 0 })
  } catch {
    try {
      win.setVibrancy('under-window')
    } catch {
      // Older Electron / non-mac
    }
  }
}

export function clearWindowVibrancy(win: BrowserWindow, dark: boolean): void {
  if (process.platform !== 'darwin' || win.isDestroyed()) return
  try {
    win.setVibrancy(null)
    win.setBackgroundColor(windowBackgroundColor(dark))
  } catch {
    // ignore
  }
}
