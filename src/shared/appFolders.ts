export const APP_FOLDER_ALL_ID = 'all'

export type AppFolderLibraryId = 'data' | 'scheduled'

export type AppFolder = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type AppFolderLibraryState = {
  folders: AppFolder[]
  /** Conversation id → folder id. Missing means unfiled (still in All). */
  assignments: Record<string, string>
}

export type AppFolderLibraries = Record<AppFolderLibraryId, AppFolderLibraryState>

export const EMPTY_APP_FOLDER_LIBRARY: AppFolderLibraryState = {
  folders: [],
  assignments: {}
}

export const EMPTY_APP_LIBRARIES: AppFolderLibraries = {
  data: { folders: [], assignments: {} },
  scheduled: { folders: [], assignments: {} }
}

export function isAppFolderLibraryId(value: string): value is AppFolderLibraryId {
  return value === 'data' || value === 'scheduled'
}

function coerceFolder(raw: unknown): AppFolder | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<AppFolder>
  if (typeof row.id !== 'string' || !row.id.trim()) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  if (!name) return null
  const createdAt = typeof row.createdAt === 'number' ? row.createdAt : 0
  const updatedAt = typeof row.updatedAt === 'number' ? row.updatedAt : createdAt
  return { id: row.id.trim(), name, createdAt, updatedAt }
}

function coerceAssignments(raw: unknown, folderIds: Set<string>): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Record<string, string> = {}
  for (const [id, folderId] of Object.entries(raw as Record<string, unknown>)) {
    if (!id.trim() || typeof folderId !== 'string') continue
    if (!folderIds.has(folderId) || folderId === APP_FOLDER_ALL_ID) continue
    next[id] = folderId
  }
  return next
}

export function coerceAppFolderLibrary(raw: unknown): AppFolderLibraryState {
  if (!raw || typeof raw !== 'object') return { folders: [], assignments: {} }
  const row = raw as Partial<AppFolderLibraryState>
  const folders = Array.isArray(row.folders)
    ? row.folders.map(coerceFolder).filter((item): item is AppFolder => item !== null)
    : []
  const ids = new Set(folders.map((folder) => folder.id))
  return { folders, assignments: coerceAssignments(row.assignments, ids) }
}

export function coerceAppLibraries(raw: unknown): AppFolderLibraries {
  const row = raw && typeof raw === 'object' ? (raw as Partial<AppFolderLibraries>) : {}
  return {
    data: coerceAppFolderLibrary(row.data),
    scheduled: coerceAppFolderLibrary(row.scheduled)
  }
}

export function appFolderDragType(library: AppFolderLibraryId): string {
  return `application/x-vav-app-${library}`
}

export function readAppFolderDrag(
  transfer: { getData(type: string): string },
  library: AppFolderLibraryId
): string[] {
  const raw = transfer.getData(appFolderDragType(library))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}
