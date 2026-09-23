/**
 * Open a local path from chat / agent log into the app column.
 * Overlays (clips / generated visuals) still use a standalone preview window.
 */
import { isClipPath } from '@shared/clipPath'
import { looksLikeVisualOverlay } from '@shared/previewOverlay'
import { useSessionStore } from '../state/sessionStore'
import { resolveMentionedPath } from './filePathLinks'

export function resolveSessionFilePath(raw: string): string {
  const state = useSessionStore.getState()
  const conv = state.conversations.find((c) => c.id === state.activeId)
  return resolveMentionedPath(raw, conv?.workingDirectory ?? null, state.home || '')
}

/**
 * Conversation-opened path: visuals and temp clips are an overlay preview,
 * everything else opens in the app column.
 */
export function openConversationFile(rawPath: string): void {
  void import('./openInApp').then(({ openInApp }) => openInApp(rawPath))
}

/** Open path in the app-column storage view (folders browse, files open). */
export function openFileInSessionPreview(rawPath: string): void {
  void import('./openInApp').then(({ openInApp }) => openInApp(rawPath))
}

/** Standalone native preview window — not the in-session file drawer. */
export function openAttachmentPreview(path: string, conversationId?: string | null): void {
  if (!path.trim()) return
  if (looksLikeVisualOverlay(path) || isClipPath(path)) {
    void window.vav.window.openFilePreview(path, {
      origin: 'session',
      conversationId: conversationId || undefined,
      surface: looksLikeVisualOverlay(path) ? 'app' : 'file'
    })
    return
  }
  void import('./openInApp').then(({ openInApp }) => openInApp(path))
}

export function revealSessionFileInFinder(rawPath: string): void {
  const resolved = resolveSessionFilePath(rawPath)
  if (!resolved.trim()) return
  void window.vav.conversations.revealInFinder(resolved)
}
