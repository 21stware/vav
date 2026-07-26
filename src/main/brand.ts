import { app, nativeImage, type NativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const APP_NAME = 'vav'

/** Resolve the app icon PNG regardless of dev vs packaged layout. */
export function resolveAppIconPath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'icon.png')]
    : [
        join(process.cwd(), 'build/icon.png'),
        join(__dirname, '../../build/icon.png'),
        join(__dirname, '../../../build/icon.png')
      ]
  return candidates.find((path) => existsSync(path)) ?? null
}

export function loadAppIcon(): NativeImage | undefined {
  const path = resolveAppIconPath()
  if (!path) return undefined
  const image = nativeImage.createFromPath(path)
  return image.isEmpty() ? undefined : image
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

  const icon = loadAppIcon()
  if (icon && app.dock) app.dock.setIcon(icon)

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Copyright © vav'
  })
}
