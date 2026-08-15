import { app, nativeImage, nativeTheme, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isDevRuntime } from './devRuntime'

export const APP_NAME_RELEASE = 'VAV'
export const APP_NAME_DEV = 'VAV Dev'
export const APP_ID_RELEASE = 'com.vav.app'
export const APP_ID_DEV = 'dev.vav.app'
export const APP_USER_DATA_RELEASE = 'vav'
export const APP_USER_DATA_DEV = 'vav-dev'

/**
 * Menu / About / window titles / Dock process name.
 * Dev uses a distinct marker so Launch Services, the Dock, and Activity
 * Monitor do not merge it with the installed release app.
 */
export const APP_NAME = isDevRuntime() ? APP_NAME_DEV : APP_NAME_RELEASE

/** Bundle id / AppUserModelID — release vs local Electron must never share this. */
export const APP_ID = isDevRuntime() ? APP_ID_DEV : APP_ID_RELEASE

/**
 * userData folder (and Chromium singleton lock). Must stay distinct from the
 * display name: Electron would otherwise orphan settings when the menu title
 * changes. Dev writes to `vav-dev` so it can run beside the release app.
 */
export const APP_USER_DATA_DIR = isDevRuntime() ? APP_USER_DATA_DEV : APP_USER_DATA_RELEASE

/** CLI shim filename (`~/.local/bin/VAV`). Never follows the Dev display name. */
export const APP_CLI_NAME = APP_NAME_RELEASE

/**
 * Resolve an app icon PNG (light or dark) regardless of dev vs packaged layout.
 * Prefer paths anchored to the running code / bundle — `open -a` leaves cwd elsewhere.
 */
export function resolveAppIconPath(variant: 'light' | 'dark' = 'light'): string | null {
  const file = variant === 'dark' ? 'icon-dark.png' : 'icon.png'
  const candidates = [
    join(process.resourcesPath, file),
    join(app.getAppPath(), 'build', file),
    join(app.getAppPath(), '../build', file),
    join(__dirname, '../../build', file),
    join(__dirname, '../../../build', file),
    join(process.cwd(), 'build', file)
  ]
  return candidates.find((path) => existsSync(path)) ?? null
}

export function loadAppIcon(variant?: 'light' | 'dark'): NativeImage | undefined {
  const dark =
    variant === 'dark' ||
    (variant === undefined && process.platform === 'darwin' && nativeTheme.shouldUseDarkColors)
  // Prefer themed tile; fall back to light so a missing dark asset never blanks the Dock.
  const ordered: Array<'dark' | 'light'> = dark ? ['dark', 'light'] : ['light']
  for (const kind of ordered) {
    const path = resolveAppIconPath(kind)
    if (!path) continue
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) {
      console.warn(`[brand] ${kind} icon empty at ${path}`)
      continue
    }
    return isDevRuntime() ? stampDevMarker(image) : image
  }
  console.warn('[brand] icon.png not found')
  return undefined
}

/** Last Dock badge text — restored after setIcon, which can drop AppKit's badge. */
let dockBadgeText = ''

/** Set the macOS Dock numeric badge. Empty string clears it. */
export function setDockBadge(text: string): void {
  dockBadgeText = text
  if (process.platform !== 'darwin' || !app.dock) return
  app.dock.setBadge(text)
}

/** Push the brand tile onto the Dock (safe to call after hide/show / theme flip). */
export function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const icon = loadAppIcon()
  if (!icon) return
  app.dock.setIcon(icon)
  // setIcon drops a runtime badge — put the attention count back.
  app.dock.setBadge(dockBadgeText)
  const variant = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  console.log(`[brand] dock icon ← ${resolveAppIconPath(variant) ?? resolveAppIconPath('light')}`)
}

/**
 * Paint a DEV pill on the icon itself so Dock / Cmd-Tab stay distinct from
 * the release app. Clipped to existing alpha so it stays inside the squircle.
 */
export function stampDevMarker(source: NativeImage): NativeImage {
  try {
    const { width, height } = source.getSize()
    if (width < 16 || height < 16) return source
    const dst = Buffer.from(source.toBitmap())
    if (dst.length < width * height * 4) return source

    const pad = Math.max(2, Math.round(width * 0.09))
    const bh = Math.max(7, Math.round(height * 0.2))
    const bw = Math.min(width - pad * 2, Math.max(Math.round(bh * 2.2), Math.round(width * 0.46)))
    const x0 = width - pad - bw
    const y0 = height - pad - bh
    const radius = Math.max(2, Math.round(bh * 0.36))

    fillRoundRect(dst, width, height, x0, y0, bw, bh, radius, { r: 255, g: 79, b: 18 })
    if (bh >= 8) drawDevGlyphs(dst, width, height, x0, y0, bw, bh)
    return nativeImage.createFromBitmap(dst, { width, height })
  } catch (err) {
    console.warn('[brand] stampDevMarker failed', err)
    return source
  }
}

const DEV_GLYPHS: Record<string, string[]> = {
  D: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100']
}

function fillRoundRect(
  dst: Buffer,
  width: number,
  height: number,
  x0: number,
  y0: number,
  bw: number,
  bh: number,
  radius: number,
  color: { r: number; g: number; b: number }
): void {
  const x1 = x0 + bw
  const y1 = y0 + bh
  for (let y = y0; y < y1; y++) {
    if (y < 0 || y >= height) continue
    for (let x = x0; x < x1; x++) {
      if (x < 0 || x >= width) continue
      if (!inRoundRect(x, y, x0, y0, x1, y1, radius)) continue
      const i = (y * width + x) * 4
      const baseA = dst[i + 3] ?? 0
      if (baseA < 18) continue
      dst[i] = color.b
      dst[i + 1] = color.g
      dst[i + 2] = color.r
      dst[i + 3] = 255
    }
  }
}

function inRoundRect(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number
): boolean {
  const cx = x < x0 + radius ? x0 + radius : x >= x1 - radius ? x1 - 1 - radius : x
  const cy = y < y0 + radius ? y0 + radius : y >= y1 - radius ? y1 - 1 - radius : y
  if (cx === x && cy === y) return true
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function drawDevGlyphs(
  dst: Buffer,
  width: number,
  height: number,
  x0: number,
  y0: number,
  bw: number,
  bh: number
): void {
  const letters = ['D', 'E', 'V']
  const rows = 7
  const cols = 5
  const gap = 1
  const units = letters.length * cols + (letters.length - 1) * gap
  const scale = Math.max(1, Math.floor(Math.min((bw * 0.62) / units, (bh * 0.5) / rows)))
  const textW = units * scale
  const textH = rows * scale
  let px = x0 + Math.round((bw - textW) / 2)
  const py = y0 + Math.round((bh - textH) / 2)
  for (const letter of letters) {
    const glyph = DEV_GLYPHS[letter]
    if (!glyph) continue
    for (let gy = 0; gy < rows; gy++) {
      const row = glyph[gy] ?? ''
      for (let gx = 0; gx < cols; gx++) {
        if (row[gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = px + gx * scale + sx
            const y = py + gy * scale + sy
            if (x < 0 || y < 0 || x >= width || y >= height) continue
            const i = (y * width + x) * 4
            dst[i] = 255
            dst[i + 1] = 255
            dst[i + 2] = 255
            dst[i + 3] = 255
          }
        }
      }
    }
    px += (cols + gap) * scale
  }
}

/**
 * Pin userData before any store reads. Safe to call multiple times.
 * Display name stays {@link APP_NAME}; on-disk folder stays {@link APP_USER_DATA_DIR}.
 */
export function pinUserDataPath(): void {
  try {
    const target = join(app.getPath('appData'), APP_USER_DATA_DIR)
    if (app.getPath('userData') !== target) {
      app.setPath('userData', target)
    }
  } catch (err) {
    console.error('[brand] pinUserDataPath failed', err)
  }
}

/** Menu bar name, dock icon, and About panel. */
export function applyBranding(): void {
  pinUserDataPath()
  app.setName(APP_NAME)

  if (process.platform === 'win32') {
    // Without this the taskbar groups our windows under Electron's identity and
    // notifications are attributed to it too.
    app.setAppUserModelId(APP_ID)
    return
  }

  if (process.platform !== 'darwin') return

  process.title = APP_NAME
  applyDockIcon()

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright © VAV'
  })
}
