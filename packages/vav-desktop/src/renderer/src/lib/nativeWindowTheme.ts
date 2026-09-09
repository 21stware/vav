/**
 * Main + Settings own the macOS glass sidebar. Companion windows are solid
 * and must not fight over process-wide `nativeTheme`.
 */
export function drivesNativeWindowTheme(search: string): boolean {
  const view = new URLSearchParams(search).get('view')
  return !view || view === 'settings'
}
