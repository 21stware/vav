import { useSyncExternalStore } from 'react'
import {
  APP_FOLDER_ALL_ID,
  coerceAppLibraries,
  type AppFolder,
  type AppFolderLibraryId,
  type AppFolderLibraryState
} from '@shared/appFolders'
import { useSessionStore } from '../state/sessionStore'

const selected: Record<AppFolderLibraryId, string> = {
  data: APP_FOLDER_ALL_ID,
  scheduled: APP_FOLDER_ALL_ID
}
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function appFolderSelectedId(library: AppFolderLibraryId): string {
  return selected[library]
}

export function setAppFolderSelectedId(library: AppFolderLibraryId, id: string): void {
  const next = id.trim() || APP_FOLDER_ALL_ID
  if (selected[library] === next) return
  selected[library] = next
  emit()
}

export function useAppFolderSelectedId(library: AppFolderLibraryId): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => selected[library],
    () => APP_FOLDER_ALL_ID
  )
}

export function filedAppFolderId(selectedId: string): string | null {
  return selectedId === APP_FOLDER_ALL_ID ? null : selectedId
}

function libraryOf(id: AppFolderLibraryId): AppFolderLibraryState {
  return coerceAppLibraries(useSessionStore.getState().settings.appLibraries)[id]
}

function writeLibrary(id: AppFolderLibraryId, next: AppFolderLibraryState): void {
  const libraries = coerceAppLibraries(useSessionStore.getState().settings.appLibraries)
  const appLibraries = { ...libraries, [id]: next }
  useSessionStore.setState((state) => ({
    settings: { ...state.settings, appLibraries }
  }))
  void useSessionStore.getState().updateSettings({ appLibraries })
}

export function createAppFolder(library: AppFolderLibraryId, name: string): AppFolder {
  const now = Date.now()
  const folder: AppFolder = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Folder',
    createdAt: now,
    updatedAt: now
  }
  const current = libraryOf(library)
  void writeLibrary(library, { ...current, folders: [...current.folders, folder] })
  return folder
}

export function renameAppFolder(library: AppFolderLibraryId, id: string, name: string): void {
  const nextName = name.trim()
  if (!nextName) return
  const current = libraryOf(library)
  void writeLibrary(library, {
    ...current,
    folders: current.folders.map((folder) =>
      folder.id === id ? { ...folder, name: nextName, updatedAt: Date.now() } : folder
    )
  })
}

export function removeAppFolder(library: AppFolderLibraryId, id: string): void {
  const current = libraryOf(library)
  const assignments = { ...current.assignments }
  for (const [objectId, folderId] of Object.entries(assignments)) {
    if (folderId === id) delete assignments[objectId]
  }
  if (selected[library] === id) setAppFolderSelectedId(library, APP_FOLDER_ALL_ID)
  void writeLibrary(library, {
    folders: current.folders.filter((folder) => folder.id !== id),
    assignments
  })
}

export function moveAppFolderObjects(
  library: AppFolderLibraryId,
  objectIds: string[],
  folderId: string | null
): void {
  const current = libraryOf(library)
  const known = new Set(current.folders.map((folder) => folder.id))
  const target = folderId && known.has(folderId) ? folderId : null
  const assignments = { ...current.assignments }
  for (const id of objectIds) {
    if (target) assignments[id] = target
    else delete assignments[id]
  }
  void writeLibrary(library, { ...current, assignments })
}

export function assignCreatedAppObject(library: AppFolderLibraryId, objectId: string | undefined): void {
  if (!objectId) return
  const folderId = filedAppFolderId(selected[library])
  if (folderId) moveAppFolderObjects(library, [objectId], folderId)
}

export function appFolderCounts(
  assignments: Record<string, string>,
  objectIds: readonly string[]
): Record<string, number> {
  const byId: Record<string, number> = {}
  for (const id of objectIds) {
    const folderId = assignments[id]
    if (!folderId) continue
    byId[folderId] = (byId[folderId] ?? 0) + 1
  }
  return byId
}
