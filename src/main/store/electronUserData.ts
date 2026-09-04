/**
 * Electron `userData` without a static `electron` import so headless `vavd`
 * can construct stores when a directory is injected.
 */
export function electronUserData(): string {
  const electron = require('electron') as { app?: { getPath: (name: string) => string } }
  const path = electron.app?.getPath('userData')
  if (!path) throw new Error('electron userData is not available')
  return path
}
