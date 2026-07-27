import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const APP_NAME = 'vav'

/** Resolve the app icon PNG regardless of dev vs packaged layout. */
export function resolveAppIconPath(): string | null {
  const file = 'icon.png'
  // `open -a … --args <project>` often leaves cwd outside the repo — never
  // rely on process.cwd() alone. Prefer paths anchored to the running code /
  // bundle resources (prepare-electron-brand copies icon.png there in dev).
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

export function loadAppIcon(): NativeImage | undefined {
  const path = resolveAppIconPath()
  if (!path) {
    console.warn('[brand] icon.png not found')
    return undefined
  }
  const image = nativeImage.createFromPath(path)
  if (image.isEmpty()) {
    console.warn(`[brand] icon.png empty at ${path}`)
    return undefined
  }
  return image
}

/** Push the brand tile onto the Dock (safe to call after hide/show). */
export function applyDockIcon(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  const icon = loadAppIcon()
  if (!icon) return
  app.dock.setIcon(icon)
  console.log(`[brand] dock icon ← ${resolveAppIconPath()}`)
}

/** Menu bar name, dock icon, and About panel — dev Electron still ships as Electron.app. */
export function applyBranding(): void {
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
    copyright: 'Copyright © vav'
  })
}
