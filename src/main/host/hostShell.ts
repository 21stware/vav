/**
 * Open / reveal a path in the host's file manager or default app.
 *
 * Local windows use Electron `shell` (Finder, Quick Look). Remote daemons
 * have no Finder on this computer — spawn the equivalent on that machine.
 */

import path from 'node:path'

export function hostDirname(platform: string | undefined, filePath: string): string {
  return (platform === 'win32' ? path.win32 : path.posix).dirname(filePath)
}

/** Show the path in Finder / Explorer / the Linux file manager. */
export function revealSpawn(
  platform: string | undefined,
  filePath: string,
  isDirectory: boolean
): { file: string; args: string[] } {
  if (platform === 'darwin') return { file: 'open', args: ['-R', filePath] }
  if (platform === 'win32') return { file: 'explorer.exe', args: [`/select,${filePath}`] }
  const target = isDirectory ? filePath : hostDirname('linux', filePath)
  return { file: 'xdg-open', args: [target] }
}

/** Open with the host OS default application. */
export function openSpawn(
  platform: string | undefined,
  filePath: string
): { file: string; args: string[] } {
  if (platform === 'darwin') return { file: 'open', args: [filePath] }
  if (platform === 'win32') return { file: 'cmd.exe', args: ['/c', 'start', '', filePath] }
  return { file: 'xdg-open', args: [filePath] }
}

/** Quick Look on a Mac host; otherwise the same as {@link openSpawn}. */
export function previewSpawn(
  platform: string | undefined,
  filePath: string
): { file: string; args: string[] } {
  if (platform === 'darwin') return { file: 'qlmanage', args: ['-p', filePath] }
  return openSpawn(platform, filePath)
}
