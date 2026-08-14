import { app } from 'electron'

/**
 * True for local development — including branded `vav.app` launches where
 * Electron reports `app.isPackaged === true` (path.txt → dist/vav.app).
 *
 * Prefer this over `!app.isPackaged` for DevTools / Inspect Element / reload.
 */
export function isDevRuntime(): boolean {
  if (!app.isPackaged) return true
  if (process.env.ELECTRON_RENDERER_URL) return true
  if (process.env.ELECTRON_IS_DEV === '1') return true
  // electron-vite / `electron .` style: defaultApp is set when the binary
  // loads an app from argv rather than a packaged asar.
  if (process.defaultApp) return true
  // Branded `node_modules/electron/dist/vav.app` reports isPackaged=true.
  // Path is the reliable split from /Applications/VAV.app.
  if (process.execPath.replace(/\\/g, '/').includes('/node_modules/electron/dist/')) {
    return true
  }
  return false
}
