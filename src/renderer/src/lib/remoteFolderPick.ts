import type { FileEntry } from '@shared/types'
import { dirname } from './path.ts'

/** Folder the picker will open: a selected directory, otherwise the current listing. */
export function confirmFolderPath(currentPath: string, selected: FileEntry | null): string {
  if (selected?.isDirectory) return selected.path
  return currentPath
}

export function filterFileEntries(entries: FileEntry[], query: string): FileEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((entry) => entry.name.toLowerCase().includes(q))
}

export function canGoParent(path: string): boolean {
  const parent = dirname(path)
  return Boolean(parent) && parent !== path
}
