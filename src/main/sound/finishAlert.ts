import { app, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const FILE_NAME = 'finish_alert.mp3'

function appPathSafe(): string | null {
  try {
    return app.getAppPath()
  } catch {
    return null
  }
}

/** Packaged extraResource first; repo root in dev. */
export function resolveFinishAlertPath(): string | null {
  const appPath = appPathSafe()
  const candidates = [
    typeof process.resourcesPath === 'string' ? join(process.resourcesPath, FILE_NAME) : '',
    appPath ? join(appPath, FILE_NAME) : '',
    appPath ? join(appPath, '..', FILE_NAME) : '',
    join(__dirname, '../../..', FILE_NAME),
    join(__dirname, '../../../..', FILE_NAME),
    join(process.cwd(), FILE_NAME)
  ].filter(Boolean)
  return candidates.find((path) => existsSync(path)) ?? null
}

/**
 * Play the bundled finish-alert chime.
 *
 * macOS uses `afplay` so the sound still fires when every window is closed.
 * Other platforms fall back to HTMLAudio in any live renderer.
 */
export function playFinishAlert(): boolean {
  const file = resolveFinishAlertPath()
  if (!file) {
    console.warn('[sound] finish_alert.mp3 not found')
    return false
  }
  if (process.platform === 'darwin') {
    try {
      const child = spawn('afplay', [file], { stdio: 'ignore', detached: true })
      child.unref()
      return true
    } catch (err) {
      console.warn('[sound] afplay failed', err)
      return false
    }
  }
  const url = pathToFileURL(file).href
  const script = `(() => { const a = new Audio(${JSON.stringify(url)}); a.play().catch(() => {}); })()`
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    void window.webContents.executeJavaScript(script).catch(() => {})
    return true
  }
  return false
}
