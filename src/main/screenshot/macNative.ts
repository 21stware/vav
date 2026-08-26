import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'

export type MacDisplayCapture = {
  displayId: number
  path: string
  width: number
  height: number
}

const ADDON = 'vav_screencap.node'

type NativeAddon = {
  capture(excludePid: number, outDir: string): number
  tune(handle: Buffer): number
  setCursor(kind: number): number
}

let native: NativeAddon | null | undefined

function addonPath(): string | null {
  const appPath = ((): string | null => {
    try {
      return app.getAppPath()
    } catch {
      return null
    }
  })()
  const candidates = [
    typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'bin', ADDON) : '',
    appPath ? join(appPath, 'resources', 'bin', ADDON) : '',
    appPath ? join(appPath, '..', 'resources', 'bin', ADDON) : '',
    join(__dirname, '../../resources/bin', ADDON),
    join(__dirname, '../../../resources/bin', ADDON),
    join(process.cwd(), 'resources', 'bin', ADDON)
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? null
}

function loadNative(): NativeAddon | null {
  if (native !== undefined) return native
  if (process.platform !== 'darwin') {
    native = null
    return null
  }
  const path = addonPath()
  if (!path) {
    console.error('[screenshot] native capture addon missing')
    native = null
    return null
  }
  try {
    const requireAddon = createRequire(join(__dirname, 'macNative.js'))
    native = requireAddon(path) as NativeAddon
    return native
  } catch (err) {
    console.error('[screenshot] failed to load native capture', err)
    native = null
    return null
  }
}

/** Disable AppKit zoom, drop the shadow, and keep the overlay out of the Window menu. */
export function tuneMacOverlay(win: BrowserWindow): boolean {
  const addon = loadNative()
  if (!addon) return false
  try {
    return addon.tune(win.getNativeWindowHandle()) === 0
  } catch (err) {
    console.error('[screenshot] tune window failed', err)
    return false
  }
}

/** Crosshair the instant capture starts; arrow the instant it ends. */
export function setMacCursor(kind: 'crosshair' | 'default'): boolean {
  const addon = loadNative()
  if (!addon) return false
  try {
    return addon.setCursor(kind === 'crosshair' ? 1 : 0) === 0
  } catch (err) {
    console.error('[screenshot] set cursor failed', err)
    return false
  }
}

/** Capture every display as-is (app windows stay on screen and in the shot). */
export function captureMacDisplays(excludePid: number, outDir: string): MacDisplayCapture[] | null {
  const addon = loadNative()
  if (!addon) return null
  let code = 1
  try {
    code = addon.capture(excludePid, outDir)
  } catch (err) {
    console.error('[screenshot] native capture failed', err)
    return null
  }
  if (code !== 0) return null
  const manifest = join(outDir, 'manifest.json')
  if (!existsSync(manifest)) return null
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as MacDisplayCapture[]
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return parsed.filter((item) => item.path && existsSync(item.path))
  } catch {
    return null
  }
}
