import { app, nativeImage, nativeTheme, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Menu / About / window titles — always uppercase brand. */
export const APP_NAME = 'VAV'

/**
 * Stable userData folder name (lowercase). Must NOT follow display-name case:
 * Electron derives the default userData path from `app.getName()`, and renaming
 * display text would otherwise orphan settings/apikey/conversations.
 */
export const APP_USER_DATA_DIR = 'vav'

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
    return image
  }
  console.warn('[brand] icon.png not found')
  return undefined
}

/** Push the brand tile onto the Dock (safe to call after hide/show / theme flip). */
export function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const icon = loadAppIcon()
  if (!icon) return
  app.dock.setIcon(icon)
  const variant = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  console.log(`[brand] dock icon ← ${resolveAppIconPath(variant) ?? resolveAppIconPath('light')}`)
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

/** Menu bar name, dock icon, and About panel — dev Electron still ships as Electron.app. */
export function applyBranding(): void {
  // Keep secrets/settings on the historic lowercase path even when the menu says VAV.
  pinUserDataPath()
  app.setName(APP_NAME)

  if (process.platform === 'win32') {
    // Without this the taskbar groups our windows under Electron's identity and
    // notifications are attributed to it too.
    app.setAppUserModelId('com.vav.app')
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
