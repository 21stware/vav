/**
 * Workspace / grant checks for local filesystem IPC.
 *
 * A compromised renderer must not read ~/.ssh or rewrite files outside the
 * watched workspace, clips, and paths the user opened through a main-process
 * dialog.
 */
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

function normalizePath(path: string): string {
  let next = resolve(path)
  if (process.platform === 'win32') next = next.toLowerCase()
  return next
}

/** Realpath the longest existing prefix, then join any not-yet-created suffix. */
function realpathForAllow(path: string): string {
  const resolved = resolve(path)
  const missing: string[] = []
  let current = resolved
  while (true) {
    try {
      const real = realpathSync(current)
      return missing.length ? join(real, ...missing.reverse()) : real
    } catch {
      const parent = dirname(current)
      if (parent === current) return resolved
      missing.push(basename(current))
      current = parent
    }
  }
}

function literalInside(root: string, target: string): boolean {
  const r = normalizePath(root)
  const t = normalizePath(target)
  if (t === r) return true
  const rel = relative(r, t)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function isPathInside(root: string, target: string): boolean {
  if (!root || !target || root.includes('\0') || target.includes('\0')) return false
  if (!literalInside(root, target)) return false
  return literalInside(realpathForAllow(root), realpathForAllow(target))
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
