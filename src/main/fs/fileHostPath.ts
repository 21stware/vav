import { hostJoin } from '../../shared/workspaceHost.ts'

/** Empty, `.`/`..`, or a name that would escape the parent directory. */
export function isInvalidRenameName(name: string): boolean {
  return !name || name.includes('/') || name.includes('\\') || name === '.' || name === '..'
}

/** Join a child name onto a host path using that path's separator style. */
export function joinOnHostPath(parent: string, name: string): string {
  const win = parent.includes('\\') && !parent.startsWith('/')
  return hostJoin(win ? 'win32' : 'linux', parent, name)
}
