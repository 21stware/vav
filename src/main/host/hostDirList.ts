export type HostDirListEntry = {
  name: string
  path: string
  isDirectory: true
  size: 0
  modifiedAt: 0
  createdAt: 0
}

/** Folder-picker rows: directories only, joined with the host's path rules. */
export function mapHostDirectoryEntries(
  parentPath: string,
  dirents: Array<{ name: string; isDirectory(): boolean }>,
  joinPath: (...parts: string[]) => string
): HostDirListEntry[] {
  return dirents
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      path: joinPath(parentPath, d.name),
      isDirectory: true as const,
      size: 0 as const,
      modifiedAt: 0 as const,
      createdAt: 0 as const
    }))
}
