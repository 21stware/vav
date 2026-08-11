/**
 * Open a local path from chat / agent log into the session side preview.
 * Falls back to a standalone preview window when there is no active session.
 */
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { resolveMentionedPath } from './filePathLinks'

export function resolveSessionFilePath(raw: string): string {
  const state = useSessionStore.getState()
  const conv = state.conversations.find((c) => c.id === state.activeId)
  return resolveMentionedPath(raw, conv?.workingDirectory ?? null, state.home || '')
}

/** Open path in the right-hand session file drawer (default for chat links). */
export function openFileInSessionPreview(rawPath: string): void {
  const resolved = resolveSessionFilePath(rawPath)
  if (!resolved.trim()) return
  const state = useSessionStore.getState()
  const id = state.activeId
  if (!id) {
    void window.vav.window.openFilePreview(resolved, { origin: 'session' })
    return
  }
  useWorkspaceStore.getState().selectPath(id, resolved)
  void state.attachContextFile(id, resolved)
  state.setFilePreviewOpen(true)
}

export function revealSessionFileInFinder(rawPath: string): void {
  const resolved = resolveSessionFilePath(rawPath)
  if (!resolved.trim()) return
  void window.vav.conversations.revealInFinder(resolved)
}
