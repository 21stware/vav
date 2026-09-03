import type { FileInspectResult } from '../../../shared/ipc.ts'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export type FileViewerStatusCopy = {
  loading: string
  zipEntries: (n: number) => string
  zipRatio: (n: number) => string
  csvSheet: (rows: number, cols: number) => string
  csvSheetCapped: (shown: number, total: number, cols: number) => string
  lines: (n: number) => string
  modifiedAt: (when: string) => string
}

/** Status-bar summary for the open preview (size · lines · badge · path). */
export function fileViewerStatusLeft(input: {
  info: FileInspectResult | null
  badge: string
  filePath: string
  hasUnsavedChanges: boolean
  csvModel: {
    rowCapped?: boolean
    rows: unknown[]
    totalRows: number
    headers: unknown[]
  } | null
  copy: FileViewerStatusCopy
  formatDate: (ms: number) => string
}): string {
  const { info, badge, filePath, hasUnsavedChanges, csvModel, copy } = input
  if (!info) return copy.loading
  const parts: string[] = []
  if (info.kind === 'zip' && info.zip) {
    parts.push(
      `${formatBytes(info.zip.compressedSize)} (${formatBytes(info.zip.uncompressedSize)} uncompressed)`
    )
    parts.push(copy.zipEntries(info.zip.entryCount))
    parts.push(copy.zipRatio(info.zip.ratio))
    parts.push(badge)
    parts.push(filePath)
    if (info.mtimeMs) parts.push(copy.modifiedAt(input.formatDate(info.mtimeMs)))
    return parts.join(' · ')
  }
  if (info.kind === 'binary') {
    if (info.size) parts.push(formatBytes(info.size))
    parts.push(badge)
    parts.push(filePath)
    if (info.mtimeMs) parts.push(copy.modifiedAt(input.formatDate(info.mtimeMs)))
    return parts.join(' · ')
  }
  if (info.size) parts.push(formatBytes(info.size))
  if (info.kind === 'csv' && csvModel) {
    parts.push(
      csvModel.rowCapped
        ? copy.csvSheetCapped(csvModel.rows.length, csvModel.totalRows, csvModel.headers.length)
        : copy.csvSheet(csvModel.totalRows, csvModel.headers.length)
    )
  } else if (info.lineCount != null) {
    parts.push(copy.lines(info.lineCount))
  }
  parts.push(badge)
  parts.push(filePath)
  if (hasUnsavedChanges) parts.push('•')
  return parts.join(' · ')
}

export type FileViewerShortcut =
  | 'close'
  | 'save'
  | 'save-as'
  | 'save-consume'
  | 'clear-selection'
  | 'toggle-agent'
  | 'close-window'
  | null

/** Keyboard chrome for a preview: save, close, Escape selection / agent / window. */
export function fileViewerShortcut(input: {
  metaOrCtrl: boolean
  key: string
  shift: boolean
  hasUnsavedChanges: boolean
  effectiveReadOnly: boolean
  hasSelectionOrCards: boolean
  agentPanelOpen: boolean
  embedded: boolean
}): FileViewerShortcut {
  if (input.metaOrCtrl && input.key === 'w') return 'close'
  if (input.metaOrCtrl && input.key.toLowerCase() === 's' && !input.effectiveReadOnly) {
    if (input.shift) return 'save-as'
    if (input.hasUnsavedChanges) return 'save'
    return 'save-consume'
  }
  if (input.key === 'Escape') {
    if (input.hasSelectionOrCards) return 'clear-selection'
    if (input.agentPanelOpen) return 'toggle-agent'
    if (!input.embedded) return 'close-window'
  }
  return null
}
