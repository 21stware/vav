/**
 * Workspace / grant checks for local filesystem IPC.
 *
 * A compromised renderer must not read ~/.ssh or rewrite files outside the
 * watched workspace, clips, and paths the user opened through a main-process
 * dialog.
 */
import { isAbsolute, relative, resolve } from 'node:path'

export function isPathInside(root: string, target: string): boolean {
  if (!root || !target || root.includes('\0') || target.includes('\0')) return false
  let r = resolve(root)
  let t = resolve(target)
  if (process.platform === 'win32') {
    r = r.toLowerCase()
    t = t.toLowerCase()
  }
  if (t === r) return true
  const rel = relative(r, t)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** True when `target` sits under any root, or equals / sits under a granted path. */
export function isPathAllowed(
  target: string,
  roots: Iterable<string>,
  granted: Iterable<string> = []
): boolean {
  if (!target || target.includes('\0')) return false
  for (const root of roots) {
    if (isPathInside(root, target)) return true
  }
  for (const g of granted) {
    // Grant is a file or directory: the path itself and its descendants, never parents.
    if (isPathInside(g, target)) return true
  }
  return false
}
