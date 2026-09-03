/** Agent-turn file changes awaiting Accept / Reject in Change Review. */

export type ChangeType = 'modified' | 'added' | 'deleted'
export type ChangeEntryStatus = 'pending' | 'accepted' | 'rejected' | 'edited'
export type ChangeSetRisk = 'low' | 'medium' | 'high'
export type ChangeSetStatus = 'pending' | 'accepted' | 'rejected' | 'partial'
/** How to interpret {@link ChangeEntry.originalContent} / {@link ChangeEntry.newContent}. */
export type ChangeContentEncoding = 'utf8' | 'base64'

export interface ChangeEntry {
  filePath: string
  relativePath: string
  changeType: ChangeType
  /**
   * Unified diff for text, or a short non-diff summary for binary/raw
   * (e.g. `Binary file · DOCX · +42.1 KB`).
   */
  diffText: string
  originalContent: string | null
  newContent: string
  /** When `base64`, contents are raw bytes (office/PDF/images) — never line-diff. */
  contentEncoding?: ChangeContentEncoding
  status: ChangeEntryStatus
  riskLevel: ChangeSetRisk
}

export interface ChangeSet {
  id: string
  conversationId: string
  turnTitle: string
  model: string
  files: ChangeEntry[]
  risk: ChangeSetRisk
  status: ChangeSetStatus
  createdAt: number
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'error'
  | 'downloading'
  /** macOS: ZIP downloaded; Squirrel.Mac still verifying / unzipping. */
  | 'preparing'
  | 'ready'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  downloadUrl: string | null
  progress: number
  /** Bytes/sec while downloading; null when not transferring. */
  bytesPerSecond: number | null
  message: string | null
}

export function isBinaryChange(file: ChangeEntry): boolean {
  return file.contentEncoding === 'base64' || isLikelyBinaryPath(file.filePath)
}

export function isLikelyBinaryPath(path: string): boolean {
  return /\.(pdf|docx?|xlsx?|pptx?|pages|numbers|key|png|jpe?g|gif|webp|svg|ico|heic|heif|zip|tar|gz|tgz|rar|7z|dylib|so|dll|exe|bin|wasm|mp4|mov|webm|mkv|wav|mp3|m4a|aac|flac|ogg|woff2?|ttf|otf)$/i.test(
    path
  )
}

export function computeRisk(files: ChangeEntry[]): ChangeSetRisk {
  const deleted = files.some((f) => f.changeType === 'deleted')
  const n = files.length
  const sensitive = files.some((f) =>
    /\.(ya?ml|json|toml|lock|gradle|plist)$|package\.json|Dockerfile|Makefile|\.env/i.test(
      f.relativePath
    )
  )
  if (n > 15 || (deleted && n > 5) || (sensitive && n > 8)) return 'high'
  if (n > 5 || deleted || sensitive) return 'medium'
  return 'low'
}

export function summarizeChangeSetStatus(files: ChangeEntry[]): ChangeSetStatus {
  if (files.length === 0) return 'accepted'
  if (files.every((f) => f.status === 'accepted' || f.status === 'edited')) return 'accepted'
  if (files.every((f) => f.status === 'rejected')) return 'rejected'
  if (files.every((f) => f.status === 'pending')) return 'pending'
  return 'partial'
}

export function pendingChangeSetFileCount(
  files: Array<{ status: string }>
): number {
  return files.filter((f) => f.status === 'pending').length
}
