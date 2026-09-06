import { IGNORED_NAMES, IGNORED_SUFFIXES, type FileEntry } from '../../shared/types.ts'
import { directoryFileEntry } from '../fs/fileEntrySort.ts'

function isIgnored(name: string): boolean {
  if (IGNORED_NAMES.has(name)) return true
  return IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

/** Folder-picker rows: files and folders, joined with the host's path rules. */
export function mapHostDirectoryEntries(
  parentPath: string,
  dirents: Array<{ name: string; isDirectory(): boolean }>,
  joinPath: (...parts: string[]) => string
): FileEntry[] {
  return dirents
    .filter((d) => !isIgnored(d.name))
    .map((d) =>
      directoryFileEntry({
        path: joinPath(parentPath, d.name),
        name: d.name,
        isDirectory: d.isDirectory(),
        size: 0,
        modifiedAt: 0,
        createdAt: 0
      })
    )
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
}
