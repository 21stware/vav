import {
  app,
  BrowserWindow,
  desktopCapturer,
  screen,
  systemPreferences,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { applyDockIcon } from '../brand'
import { writeClip, writeClipBytes } from '../fs/clipStore'
import { currentLocale } from '../i18n'
import { IPC, type ScreenshotInitPayload } from '@shared/ipc'
import type { AppLocale } from '@shared/types'
import { captureMacDisplays, setMacCursor, tuneMacOverlay } from './macNative'

export type ScreenshotResult =
  | { ok: true; path: string }
  | { ok: false; cancelled?: boolean; error?: 'denied' | 'failed' | 'busy' }

export type ScreenshotHost = {
  loadScreenshotRenderer: (window: BrowserWindow) => void
}

type OverlayWin = BrowserWindow & {
  __screenshotInit?: ScreenshotInitPayload
  __displayBounds?: Electron.Rectangle
}

const PARK_ORIGIN = { x: -24000, y: -24000 }

function parkedRect(display?: Electron.Rectangle): Electron.Rectangle {
  return {
    x: PARK_ORIGIN.x,
    y: PARK_ORIGIN.y,
    width: Math.max(8, display?.width ?? 8),
    height: Math.max(8, display?.height ?? 8)
  }
}

type Pending = {
  resolve: (result: ScreenshotResult) => void
  overlays: OverlayWin[]
  locale: AppLocale
  dismissed: boolean
  revealed: boolean
  requester: BrowserWindow | null
  allowOverlayKey: boolean
  detachEscape?: () => void
}

/** skipTaskbar panels steal activation and hide the Dock tile. */
function keepDockVisible(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  try {
    if (app.dock.isVisible()) return
  } catch {
    // ignore
  }
  try {
    app.setActivationPolicy('regular')
  } catch {
    // ignore
  }
  try {
    app.dock.show()
  } catch {
    // ignore
  }
  applyDockIcon()
}

const OVERLAY_READY_MS = 15000

function matchSource(
  display: Electron.Display,
  sources: Electron.DesktopCapturerSource[],
  displayCount: number
): Electron.DesktopCapturerSource | undefined {
  const id = String(display.id)
  const byId = sources.find((source) => source.display_id === id)
  if (byId) return byId
  if (displayCount === 1 && sources.length === 1) return sources[0]
  const w = Math.round(display.size.width * display.scaleFactor)
  const h = Math.round(display.size.height * display.scaleFactor)
  return sources.find((source) => {
    const size = source.thumbnail.getSize()
    return Math.abs(size.width - w) < 8 && Math.abs(size.height - h) < 8
  })
}

function isMostlyEmpty(image: Electron.NativeImage): boolean {
  const size = image.getSize()
  if (size.width < 8 || size.height < 8) return true
  return image.toPNG().length < 200
}

function matchDisplay(
  displays: Electron.Display[],
  displayId: number,
  width: number,
  height: number
): Electron.Display | undefined {
  const byId = displays.find((d) => d.id === displayId)
  if (byId) return byId
  return displays.find(
    (d) =>
      Math.abs(d.bounds.width - width) < 2 && Math.abs(d.bounds.height - height) < 2
  )
}

function importPng(path: string, filename: string): string | null {
  try {
    const written = writeClipBytes({ filename, bytes: readFileSync(path) })
    return written.ok ? written.path : null
  } catch {
    return null
  }
}

async function captureFallback(
  displays: Electron.Display[]
): Promise<{ display: Electron.Display; path: string }[]> {
  const maxW = Math.max(
    ...displays.map((d) => Math.round(d.size.width * d.scaleFactor)),
    1920
  )
  const maxH = Math.max(
    ...displays.map((d) => Math.round(d.size.height * d.scaleFactor)),
    1080
  )
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxW, height: maxH },
    fetchWindowIcons: false
  })
  const captures: { display: Electron.Display; path: string }[] = []
  for (const display of displays) {
    const source = matchSource(display, sources, displays.length)
    if (!source || isMostlyEmpty(source.thumbnail)) continue
    const written = writeClip({
      filename: `screen-${display.id}.png`,
      base64: source.thumbnail.toPNG().toString('base64')
    })
    if (written.ok) captures.push({ display, path: written.path })
  }
  return captures
}

function captureDisplays(
  displays: Electron.Display[]
): { display: Electron.Display; path: string }[] | null {
  if (process.platform !== 'darwin') return null
  const outDir = mkdtempSync(join(tmpdir(), 'vav-screen-'))
  const shots = captureMacDisplays(0, outDir)
  if (!shots?.length) return null
  const captures: { display: Electron.Display; path: string }[] = []
  for (const shot of shots) {
    const display = matchDisplay(displays, shot.displayId, shot.width, shot.height)
    if (!display) continue
    const path = importPng(shot.path, `screen-${display.id}.png`)
    if (path) captures.push({ display, path })
  }
  return captures.length ? captures : null
}

export function createScreenshotController(host: ScreenshotHost): {
  start: (event: IpcMainInvokeEvent) => Promise<ScreenshotResult>
  ready: (event: Electron.IpcMainEvent) => void
  painted: (event: Electron.IpcMainEvent) => void
  dismiss: () => void
  finish: (payload: { ok: true; path: string } | { ok: false }) => void
  cancel: () => void
  setKey: (event: Electron.IpcMainEvent, on: boolean) => void
  isOverlay: (win: BrowserWindow) => boolean
  isActive: () => boolean
} {
  const pool = new Map<number, OverlayWin>()
  let pending: Pending | null = null

  const restoreRequester = (overlay?: OverlayWin | null): void => {
    if (pending?.allowOverlayKey) return
    if (overlay && !overlay.isDestroyed()) {
      try {
        overlay.setFocusable(false)
      } catch {
        // ignore
      }
      try {
        overlay.blur()
      } catch {
        // ignore
      }
    }
    const req = pending?.requester
    if (req && !req.isDestroyed() && !req.isFocused()) {
      try {
        req.focus()
      } catch {
        // ignore
      }
    }
  }

  const isPooled = (win: BrowserWindow): boolean => {
    for (const item of pool.values()) {
      if (item === win) return true
    }
    return false
  }

  const parkOverlay = (win: OverlayWin): void => {
    try {
      win.setIgnoreMouseEvents(true, { forward: true })
    } catch {
      try {
        win.setIgnoreMouseEvents(true)
      } catch {
        // ignore
      }
    }
    try {
      win.setBounds(parkedRect(win.__displayBounds), false)
    } catch {
      // ignore
    }
    try {
      win.setBackgroundColor('#00000000')
    } catch {
      // ignore
    }
    try {
      // Stay opaque off-screen so Chromium actually rasterizes the capture.
      // Opacity 0 + later fade-in is what flashed a blank/black window.
      win.setOpacity(1)
    } catch {
      // ignore
    }
  }

  const applyAppCursor = (kind: 'crosshair' | 'default'): void => {
    setMacCursor(kind)
    const js =
      kind === 'crosshair'
        ? `document.documentElement.classList.add('is-screenshotting');document.querySelector('.screenshot-root')?.classList.remove('is-done')`
        : `document.documentElement.classList.remove('is-screenshotting');document.querySelector('.screenshot-root')?.classList.add('is-done')`
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      void win.webContents.executeJavaScript(js).catch(() => undefined)
    }
  }

  const concealOverlays = (): void => {
    applyAppCursor('default')
    for (const win of pool.values()) {
      if (win.isDestroyed()) continue
      parkOverlay(win)
    }
  }

  const settle = (result: ScreenshotResult): void => {
    const session = pending
    pending = null
    session?.detachEscape?.()
    concealOverlays()
    keepDockVisible()
    if (session?.requester && !session.requester.isDestroyed() && !session.requester.isFocused()) {
      try {
        session.requester.focus()
      } catch {
        // ignore
      }
    }
    session?.resolve(result)
  }

  const sendInit = (win: OverlayWin): void => {
    const init = win.__screenshotInit
    if (!init || win.isDestroyed() || win.webContents.isLoading()) return
    win.webContents.send(IPC.screenshotInit, init)
  }

  const reveal = (win: OverlayWin): void => {
    if (!pending || win.isDestroyed()) return
    pending.revealed = true
    const bounds = win.__displayBounds
    if (bounds) {
      try {
        const current = win.getBounds()
        if (current.width === bounds.width && current.height === bounds.height) {
          win.setPosition(bounds.x, bounds.y, false)
        } else {
          win.setBounds(bounds, false)
        }
      } catch {
        // ignore
      }
    }
    try {
      win.setIgnoreMouseEvents(false)
    } catch {
      // ignore
    }
    if (!win.isVisible()) {
      try {
        win.showInactive()
      } catch {
        // ignore
      }
    }
    keepDockVisible()
  }

  const armOverlay = (win: OverlayWin): void => {
    try {
      win.setHasShadow(false)
    } catch {
      // ignore
    }
    try {
      win.setContentProtection(true)
    } catch {
      // ignore
    }
    try {
      win.setAlwaysOnTop(true, 'pop-up-menu')
    } catch {
      // ignore
    }
    try {
      win.setFocusable(false)
    } catch {
      // ignore
    }
    parkOverlay(win)
    tuneMacOverlay(win)
    if (!win.isVisible()) {
      try {
        win.showInactive()
      } catch {
        // ignore
      }
    }
  }

  const createOverlay = (display: Electron.Display): OverlayWin => {
    const win = new BrowserWindow({
      ...parkedRect(display.bounds),
      title: '',
      frame: false,
      transparent: true,
      show: false,
      paintWhenInitiallyHidden: true,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      movable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      focusable: false,
      backgroundColor: '#00000000',
      ...(process.platform === 'darwin'
        ? { type: 'panel' as const, roundedCorners: false }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    }) as OverlayWin
    try {
      win.setAlwaysOnTop(true, 'pop-up-menu')
    } catch {
      // ignore
    }
    win.on('focus', () => {
      keepDockVisible()
      restoreRequester(win)
    })
    win.on('show', () => keepDockVisible())
    try {
      win.setTitle('')
    } catch {
      // ignore
    }
    win.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      try {
        win.setTitle('')
      } catch {
        // ignore
      }
    })
    win.on('closed', () => {
      if (pool.get(display.id) === win) pool.delete(display.id)
      if (!pending) return
      pending.overlays = pending.overlays.filter((item) => item !== win)
      if (pending.overlays.length === 0) settle({ ok: false, cancelled: true })
    })
    win.__displayBounds = display.bounds
    host.loadScreenshotRenderer(win)
    return win
  }

  const ensureOverlay = (display: Electron.Display): OverlayWin => {
    const existing = pool.get(display.id)
    if (existing && !existing.isDestroyed()) {
      existing.__displayBounds = display.bounds
      return existing
    }
    const win = createOverlay(display)
    pool.set(display.id, win)
    return win
  }

  return {
    isOverlay: (win) => isPooled(win),
    isActive: () => pending != null,

    ready(event) {
      const win = BrowserWindow.fromWebContents(event.sender) as OverlayWin | null
      if (!win || !pending) return
      sendInit(win)
    },

    painted(event) {
      const win = BrowserWindow.fromWebContents(event.sender) as OverlayWin | null
      if (!win || !pending || pending.dismissed) return
      reveal(win)
    },

    dismiss() {
      if (!pending || pending.dismissed) return
      pending.dismissed = true
      concealOverlays()
    },

    finish(payload) {
      if (!pending) return
      if (!payload.ok) {
        settle({
          ok: false,
          error: (payload as any).error || 'failed',
          cancelled: (payload as any).error ? false : true
        })
        return
      }
      settle({ ok: true, path: payload.path })
    },

    cancel() {
      if (!pending) {
        concealOverlays()
        return
      }
      settle({ ok: false, cancelled: true })
    },

    setKey(event, on) {
      if (!pending) return
      pending.allowOverlayKey = on
      const win = BrowserWindow.fromWebContents(event.sender) as OverlayWin | null
      if (!win || win.isDestroyed()) return
      try {
        win.setFocusable(on)
      } catch {
        // ignore
      }
      if (on) {
        try {
          win.focus()
        } catch {
          // ignore
        }
        return
      }
      restoreRequester(win)
    },

    async start(event): Promise<ScreenshotResult> {
      if (pending) return { ok: false, error: 'busy' }
      applyAppCursor('crosshair')
      const requester = BrowserWindow.fromWebContents(event.sender)

      return await new Promise<ScreenshotResult>((resolve) => {
        void (async () => {
          const onEscape = (inputEvent: Electron.Event, input: Electron.Input): void => {
            if (!pending || input.type !== 'keyDown' || input.key !== 'Escape') return
            inputEvent.preventDefault()
            for (const overlay of pending.overlays) {
              if (overlay.isDestroyed()) continue
              overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
            }
          }
          if (requester && !requester.isDestroyed()) {
            requester.webContents.on('before-input-event', onEscape)
          }

          pending = {
            resolve,
            overlays: [],
            locale: currentLocale(),
            dismissed: false,
            revealed: false,
            requester,
            allowOverlayKey: false,
            detachEscape: () => {
              if (requester && !requester.isDestroyed()) {
                requester.webContents.off('before-input-event', onEscape)
              }
            }
          }

          try {
            if (process.platform === 'darwin') {
              const status = systemPreferences.getMediaAccessStatus('screen')
              if (status === 'denied') {
                settle({ ok: false, error: 'denied' })
                return
              }
            }

            const displays = screen.getAllDisplays()
            const captures =
              captureDisplays(displays) ??
              (process.platform === 'darwin' ? null : await captureFallback(displays))
            if (!captures?.length) {
              settle({ ok: false, error: 'denied' })
              return
            }

            const locale = currentLocale()
            const nonce = Date.now()
            const live: OverlayWin[] = []
            for (const capture of captures) {
              const overlay = ensureOverlay(capture.display)
              overlay.__screenshotInit = {
                imagePath: capture.path,
                locale,
                displayWidth: capture.display.bounds.width,
                displayHeight: capture.display.bounds.height,
                nonce
              }
              armOverlay(overlay)
              live.push(overlay)
              sendInit(overlay)
            }
            pending.overlays = live
            keepDockVisible()

            setTimeout(() => {
              if (pending && !pending.revealed && !pending.dismissed) {
                settle({ ok: false, error: 'failed' })
              }
            }, OVERLAY_READY_MS)
          } catch (err) {
            console.error('[screenshot] capture failed', err)
            settle({ ok: false, error: 'failed' })
          }
        })()
      })
    }
  }
}
