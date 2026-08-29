/**
 * Restricted workdir picker for the phone control plane.
 *
 * The phone may list directories and set a session workdir, but only under
 * roots the host already considers reachable: home, tmp, the session's
 * current folder, and remembered recents. File contents / pty stay off.
 */
export function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
}

export function remoteIsTemporary(path: string | null | undefined, tmpRoot: string): boolean {
  if (!path) return true
  const p = normalizeFsPath(path)
  const tmp = normalizeFsPath(tmpRoot)
  return p === tmp || p.startsWith(`${tmp}/`) || p.startsWith(`/private${tmp}`)
}

export function remotePathAllowed(path: string, roots: string[]): boolean {
  const p = normalizeFsPath(path)
  for (const root of roots) {
    const r = normalizeFsPath(root)
    if (p === r || p.startsWith(`${r}/`)) return true
    if (p === `/private${r}` || p.startsWith(`/private${r}/`)) return true
  }
  return false
}

export function remoteParentPath(path: string, roots: string[]): string | null {
  const p = normalizeFsPath(path)
  const slash = p.lastIndexOf('/')
  if (slash <= 0) return null
  const parent = p.slice(0, slash) || '/'
  return remotePathAllowed(parent, roots) ? parent : null
}

export function remoteBrowseRoots(input: {
  home: string
  tmp: string
  current?: string | null
  recent?: string[]
}): string[] {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const path of [input.home, input.tmp, input.current, ...(input.recent ?? [])]) {
    if (!path) continue
    const key = normalizeFsPath(path)
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(path)
  }
  return roots
}
