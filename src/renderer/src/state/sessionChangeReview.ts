import { pendingChangeSetFileCount, type ChangeSet } from '../../../shared/changeSet.ts'

export type ChangeReviewSlice = {
  changeSet: ChangeSet | null
  changeSetsById: Record<string, ChangeSet>
  changeReviewId: string | null
  pendingReviewByConversation: Record<string, { changeSetId: string; count: number }>
}

type SetFn = (
  partial:
    | Partial<ChangeReviewSlice>
    | ((state: ChangeReviewSlice) => Partial<ChangeReviewSlice>)
) => void

type GetFn = () => ChangeReviewSlice

export function syncPendingBanner(set: SetFn, changeSet: ChangeSet): void {
  const pending = pendingChangeSetFileCount(changeSet.files)
  set((state) => {
    const next = { ...state.pendingReviewByConversation }
    if (pending === 0) delete next[changeSet.conversationId]
    else next[changeSet.conversationId] = { changeSetId: changeSet.id, count: pending }
    return { pendingReviewByConversation: next }
  })
}

function rememberChangeSet(set: SetFn, changeSet: ChangeSet, extra?: Partial<ChangeReviewSlice>): void {
  set((state) => ({
    changeSet: state.changeSet?.id === changeSet.id ? changeSet : state.changeSet,
    changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet },
    ...extra
  }))
  syncPendingBanner(set, changeSet)
}

export async function openChangeReview(
  get: GetFn,
  set: SetFn,
  changeSetId: string
): Promise<void> {
  if (!changeSetId) return
  const hit = get().changeSetsById[changeSetId]
  if (hit) {
    set({ changeSet: hit })
    return
  }
  const changeSet = await window.vav.changeSets.get(changeSetId)
  if (!changeSet) return
  set((state) => ({
    changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet },
    changeSet
  }))
}

export function closeChangeReview(set: SetFn): void {
  set({ changeReviewId: null })
}

export async function refreshChangeSet(get: GetFn, set: SetFn): Promise<void> {
  const id = get().changeReviewId ?? get().changeSet?.id
  if (!id) return
  const changeSet = await window.vav.changeSets.get(id)
  if (!changeSet) {
    set({ changeReviewId: null, changeSet: null })
    return
  }
  set((state) => ({
    changeSet,
    changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet }
  }))
  syncPendingBanner(set, changeSet)
}

export async function applyChangeEdit(
  get: GetFn,
  set: SetFn,
  filePath: string,
  content: string
): Promise<void> {
  const id = get().changeReviewId ?? get().changeSet?.id
  if (!id) return
  const changeSet = await window.vav.changeSets.applyEdit(id, filePath, content)
  if (changeSet) {
    set((state) => ({
      changeSet,
      changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet }
    }))
    syncPendingBanner(set, changeSet)
  }
}

export async function acceptChangeFilesFor(
  set: SetFn,
  changeSetId: string,
  filePaths: string[]
): Promise<void> {
  if (!changeSetId || filePaths.length === 0) return
  const changeSet = await window.vav.changeSets.accept(changeSetId, filePaths)
  if (changeSet) rememberChangeSet(set, changeSet)
}

export async function rejectChangeFilesFor(
  set: SetFn,
  changeSetId: string,
  filePaths: string[]
): Promise<void> {
  if (!changeSetId || filePaths.length === 0) return
  const changeSet = await window.vav.changeSets.reject(changeSetId, filePaths)
  if (changeSet) rememberChangeSet(set, changeSet)
}

export async function acceptAllChangesFor(set: SetFn, changeSetId: string): Promise<void> {
  if (!changeSetId) return
  const changeSet = await window.vav.changeSets.acceptAll(changeSetId)
  if (changeSet) rememberChangeSet(set, changeSet, { changeReviewId: null })
}

export async function rejectAllChangesFor(set: SetFn, changeSetId: string): Promise<void> {
  if (!changeSetId) return
  const changeSet = await window.vav.changeSets.rejectAll(changeSetId)
  if (changeSet) rememberChangeSet(set, changeSet, { changeReviewId: null })
}

export async function undoChangeFileFor(
  set: SetFn,
  changeSetId: string,
  filePath: string
): Promise<void> {
  if (!changeSetId) return
  const changeSet = await window.vav.changeSets.undo(changeSetId, filePath)
  if (changeSet) rememberChangeSet(set, changeSet)
}

export function activeChangeSetId(get: GetFn): string | null {
  return get().changeReviewId ?? get().changeSet?.id ?? null
}
