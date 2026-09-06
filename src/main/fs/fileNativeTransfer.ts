/**
 * OS-native file transfer helpers (clipboard file list, Get Info / Properties).
 *
 * These speak Finder / Explorer pasteboard types, not in-memory JS File blobs.
 * Script builders are pure so they can be unit-tested without spawning.
 */

export function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

export function splitDirName(path: string): { dir: string; name: string } {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (idx < 0) return { dir: '', name: path }
  return { dir: path.slice(0, idx), name: path.slice(idx + 1) }
}

/** Finder-style “Copy”: the pasteboard holds the file, not its text. */
export function copyFilesAppleScript(paths: string[]): string {
  if (paths.length === 1) {
    return `set the clipboard to (POSIX file "${escapeAppleScriptString(paths[0])}")`
  }
  const items = paths.map((path) => `POSIX file "${escapeAppleScriptString(path)}"`).join(', ')
  return `set the clipboard to {${items}}`
}

/** Opens Finder’s Get Info window for the path. */
export function getInfoAppleScript(path: string): string {
  const posix = `POSIX file "${escapeAppleScriptString(path)}" as alias`
  return [
    'tell application "Finder"',
    '  activate',
    `  open information window of (${posix})`,
    'end tell'
  ].join('\n')
}

export function copyFilesPowerShell(paths: string[]): string {
  const adds = paths
    .map((path) => `$files.Add('${escapePowerShellSingleQuoted(path)}') | Out-Null`)
    .join('\n')
  return [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$files = New-Object System.Collections.Specialized.StringCollection',
    adds,
    '[System.Windows.Forms.Clipboard]::SetFileDropList($files)'
  ].join('\n')
}

export function propertiesPowerShell(path: string): string {
  const { dir, name } = splitDirName(path)
  return [
    '$shell = New-Object -ComObject Shell.Application',
    `$folder = $shell.NameSpace('${escapePowerShellSingleQuoted(dir)}')`,
    `$item = $folder.ParseName('${escapePowerShellSingleQuoted(name)}')`,
    "$item.InvokeVerb('Properties')"
  ].join('\n')
}

export function sanitizeDragPaths(
  paths: unknown,
  isAllowed: (path: string) => boolean,
  exists: (path: string) => boolean
): string[] {
  if (!Array.isArray(paths)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.includes('\0')) continue
    if (seen.has(path)) continue
    if (!isAllowed(path) || !exists(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

export function startDragItem<TIcon>(
  paths: string[],
  icon: TIcon
): { file: string; icon: TIcon } | { file: string; files: string[]; icon: TIcon } | null {
  if (paths.length === 0) return null
  if (paths.length === 1) return { file: paths[0], icon }
  return { file: paths[0], files: paths, icon }
}
