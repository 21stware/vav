import { extname } from 'node:path'
import type { FileEntry, FileSortKey } from '../../shared/types.ts'

/** Cap a directory listing after ignore-filters; `truncated` is the overflow count. */
export function capVisibleEntries<T>(visible: T[], cap: number): { slice: T[]; truncated: number } {
  return {
    slice: visible.slice(0, cap),
    truncated: Math.max(0, visible.length - cap)
  }
}

export function sortEntries(entries: FileEntry[], key: FileSortKey, ascending: boolean): FileEntry[] {
  if (key === 'none') return entries

  const direction = ascending ? 1 : -1
  const byName = (a: FileEntry, b: FileEntry): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

  return [...entries].sort((a, b) => {
    // Folders lead for every sort except raw filesystem order (`none`).
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    let cmp = 0
    switch (key) {
      case 'date':
      case 'dateModified':
        cmp = a.modifiedAt - b.modifiedAt
        break
      case 'dateCreated':
      case 'dateAdded':
        cmp = (a.createdAt || a.modifiedAt) - (b.createdAt || b.modifiedAt)
        break
      case 'size':
        cmp = a.size - b.size
        break
      case 'kind': {
        cmp = kindLabel(a).localeCompare(kindLabel(b))
        break
      }
      case 'application': {
        cmp = applicationLabel(a).localeCompare(applicationLabel(b))
        break
      }
      case 'tags':
        // Tags need Spotlight xattrs; without them keep a stable name order.
        cmp = 0
        break
      case 'name':
      default:
        cmp = byName(a, b)
        break
    }
    if (cmp === 0) cmp = byName(a, b)
    return cmp * direction
  })
}

export function kindLabel(entry: FileEntry): string {
  if (entry.isDirectory) return 'Folder'
  const ext = extname(entry.name).toLowerCase()
  return ext ? ext.slice(1).toUpperCase() : 'Document'
}

/** Best-effort “opens with” grouping when Launch Services isn’t available. */
export function applicationLabel(entry: FileEntry): string {
  if (entry.isDirectory) return 'Finder'
  const ext = extname(entry.name).toLowerCase()
  switch (ext) {
    case '.swift':
    case '.m':
    case '.mm':
    case '.h':
    case '.xcodeproj':
      return 'Xcode'
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.json':
    case '.md':
    case '.css':
    case '.html':
      return 'Editor'
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.svg':
      return 'Preview'
    case '.pdf':
      return 'Preview'
    case '.mp3':
    case '.wav':
    case '.m4a':
    case '.mp4':
    case '.mov':
      return 'QuickTime Player'
    case '.sh':
    case '.zsh':
    case '.bash':
      return 'Terminal'
    case '.app':
      return entry.name
    default:
      return ext ? ext.slice(1).toUpperCase() : 'Other'
  }
}
