import { remoteParentPath, remotePathAllowed } from '../../shared/remoteWorkspace.ts'

export type RemoteDirEntry = { name: string; path: string }

export function listRemoteRootEntries(
  roots: string[],
  opts: { exists: (path: string) => boolean; label: (path: string) => string }
): RemoteDirEntry[] {
  const seen = new Set<string>()
  const entries: RemoteDirEntry[] = []
  for (const root of roots) {
    if (!opts.exists(root) || seen.has(root)) continue
    seen.add(root)
    entries.push({ name: opts.label(root), path: root })
  }
  return entries
}

export function listRemoteChildEntries(
  path: string,
  roots: string[],
  opts: {
    readdir: (path: string) => { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }[]
    join: (dir: string, name: string) => string
  }
): RemoteDirEntry[] | 'forbidden' {
  if (!remotePathAllowed(path, roots)) return 'forbidden'
  let entries: RemoteDirEntry[] = []
  try {
    for (const dirent of opts.readdir(path)) {
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue
      if (dirent.name.startsWith('.')) continue
      entries.push({ name: dirent.name, path: opts.join(path, dirent.name) })
      if (entries.length >= 200) break
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return 'forbidden'
  }
  return entries
}

export function remoteDirParent(path: string, roots: string[]): string | null {
  return remoteParentPath(path, roots)
}
