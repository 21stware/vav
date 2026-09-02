import { hostJoin } from '../../shared/workspaceHost.ts'

/** Join a child name onto a host path using that path's separator style. */
export function joinOnHostPath(parent: string, name: string): string {
  const win = parent.includes('\\') && !parent.startsWith('/')
  return hostJoin(win ? 'win32' : 'linux', parent, name)
}
