import { useSessionStore } from '../../state/sessionStore'
import { useWorkspaceStore } from '../../state/workspaceStore'

/**
 * App-column file canvases bind a workspace (recursive FS watcher + cached
 * directory tree) per file-session conversation. Nothing used to release them,
 * so every file opened from Storage kept a live watcher in main and a slice in
 * the renderer — each FS tick under any of those folders re-listed directories
 * for sessions nobody was looking at. Refcount mounts and drop the binding once
 * the last canvas for that session goes away.
 */
const mounts = new Map<string, number>()
/** prepareFileWorkspace is async; re-release after it settles. */
const SETTLE_MS = 1500

function inUseElsewhere(id: string): boolean {
  const state = useSessionStore.getState()
  return state.activeId === id || state.detachedConversationIds.includes(id)
}

function release(id: string): void {
  if ((mounts.get(id) ?? 0) > 0 || inUseElsewhere(id)) return
  void window.vav?.files?.watch?.(id, null)?.catch?.(() => undefined)
  if (useWorkspaceStore.getState().workspaces[id]) {
    useWorkspaceStore.getState().forgetLocalWorkspace(id)
  }
}

export function retainAppFileWorkspace(id: string): () => void {
  mounts.set(id, (mounts.get(id) ?? 0) + 1)
  return () => {
    const next = (mounts.get(id) ?? 1) - 1
    if (next > 0) {
      mounts.set(id, next)
      return
    }
    mounts.delete(id)
    release(id)
    setTimeout(() => release(id), SETTLE_MS)
  }
}
