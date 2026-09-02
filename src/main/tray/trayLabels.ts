/**
 * Tray and remote-dir labels: home as `~`, otherwise the last path segment.
 * Pure so tests do not need Electron or the settings store.
 */
export function trayDirLabel(
  workingDirectory: string | null | undefined,
  home: string
): string {
  if (!workingDirectory || workingDirectory === '~') return '~'
  if (workingDirectory === home) return '~'
  if (workingDirectory.startsWith(home + '/') || workingDirectory.startsWith(home + '\\')) {
    return `~${workingDirectory.slice(home.length).replace(/\\/g, '/')}`
  }
  const parts = workingDirectory.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : workingDirectory
}
