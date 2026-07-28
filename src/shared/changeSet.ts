/** Agent-turn file changes awaiting Accept / Reject in Change Review. */

export type ChangeType = 'modified' | 'added' | 'deleted'
export type ChangeEntryStatus = 'pending' | 'accepted' | 'rejected' | 'edited'
export type ChangeSetRisk = 'low' | 'medium' | 'high'
export type ChangeSetStatus = 'pending' | 'accepted' | 'rejected' | 'partial'

export interface ChangeEntry {
  filePath: string
  relativePath: string
  changeType: ChangeType
  diffText: string
  originalContent: string | null
  newContent: string
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
  | 'ready'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  releaseUrl: string | null
  downloadUrl: string | null
  progress: number
  message: string | null
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
