/**
 * Open a local path from chat / agent log into the session side preview.
 * Falls back to a standalone preview window when there is no active session.
 */
import { isClipPath } from '@shared/clipPath'
import { looksLikeVisualOverlay } from '@shared/previewOverlay'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { resolveMentionedPath } from './filePathLinks'

export function resolveSessionFilePath(raw: string): string {
  const state = useSessionStore.getState()
  const conv = state.conversations.find((c) => c.id === state.activeId)
  return resolveMentionedPath(raw, conv?.workingDirectory ?? null, state.home || '')
}

/**
 * Conversation-opened path: visuals and temp clips are an overlay preview,
 * not the session file drawer / File Session.
 */
export function openConversationFile(rawPath: string): void {
  const resolved = resolveSessionFilePath(rawPath)
  if (!resolved.trim()) return
  if (looksLikeVisualOverlay(resolved) || isClipPath(resolved)) {
    void window.vav.window.openFilePreview(resolved, {
      origin: 'session',
      surface: looksLikeVisualOverlay(resolved) ? 'app' : 'file'
    })
    return
  }
  openFileInSessionPreview(rawPath)
}

/** Open path in the right-hand session file drawer (default for files-tree peek). */
export function openFileInSessionPreview(rawPath: string): void {
  const resolved = resolveSessionFilePath(rawPath)
  if (!resolved.trim()) return
  if (isClipPath(resolved) && looksLikeVisualOverlay(resolved)) {
    void window.vav.window.openFilePreview(resolved, { origin: 'session', surface: 'app' })
    return
  }
  const state = useSessionStore.getState()
  const id = state.activeId
  if (!id) {
    void window.vav.window.openFilePreview(resolved, { origin: 'session' })
    return
  }
  useWorkspaceStore.getState().selectPath(id, resolved)
  void state.attachContextFile(id, resolved)
  state.setSessionPreview({ kind: 'file' })
  state.setFilePreviewOpen(true)
}

/** Standalone native preview window — not the in-session file drawer. */
export function openAttachmentPreview(path: string, conversationId?: string | null): void {
  if (!path.trim()) return
  void window.vav.window.openFilePreview(path, {
    origin: 'session',
    conversationId: conversationId || undefined,
    surface: looksLikeVisualOverlay(path) ? 'app' : 'file'
  })
}

export function revealSessionFileInFinder(rawPath: string): void {
  const resolved = resolveSessionFilePath(rawPath)
  if (!resolved.trim()) return
  void window.vav.conversations.revealInFinder(resolved)
}
