import { dirname } from './path.ts'
import { fileSortLabelKey } from '../../../shared/i18n/index.ts'
import type { FileEntry, FileSortKey } from '../../../shared/types.ts'

/**
 * Direct parent of a selected path (Finder-style: arrows move among siblings
 * in this directory only). Root selection → root itself.
 */
export function selectionParent(
  selected: string | null,
  root: string,
  dirMap: Record<string, FileEntry[]> | undefined
): string {
  if (!selected || selected === root) return root
  const parent = dirname(selected)
  if (!parent || parent === selected) return root
  if (dirMap?.[parent]) return parent
  return parent || root
}

export function entryInDir(
  dir: string,
  path: string | null,
  dirMap: Record<string, FileEntry[]> | undefined
): FileEntry | null {
  if (!path) return null
  return (dirMap?.[dir] ?? []).find((e) => e.path === path) ?? null
}

export function sortButtonLabel(
  key: FileSortKey,
  t: (key: ReturnType<typeof fileSortLabelKey>) => string
): string {
  if (key === 'none') return '—'
  return t(fileSortLabelKey(key))
}
