import type { PreviewRef, QuoteDraft } from '../../../shared/types.ts'

/**
 * In-memory pending send while a turn is streaming (main-chat-streaming.rpml §5).
 * Not persisted; cleared when the conversation is removed.
 */
export interface QueuedMessage {
  id: string
  text: string
  attachments: string[]
  previewRefs: PreviewRef[]
  commentCards: { ref: PreviewRef; comment: string }[]
  quote: QuoteDraft | null
  contextFile: string | null
  createdAt: number
}

/** Max pending items per conversation (spec §2.10). */
export const MESSAGE_QUEUE_MAX = 20

/** Merge comment cards + preview refs, then fire agent.send. */
export async function dispatchQueuedPayload(
  conversationId: string,
  item: QueuedMessage,
  selectIfNeeded: () => Promise<void>
): Promise<void> {
  const cardRefs = item.commentCards.map((c) => {
    const note = c.comment.trim()
    return note ? { ...c.ref, comment: note } : { ...c.ref }
  })
  const byId = new Map<string, PreviewRef>()
  for (const ref of item.previewRefs) byId.set(ref.id, ref)
  for (const ref of cardRefs) byId.set(ref.id, ref)
  const allRefs = [...byId.values()]

  await selectIfNeeded()
  await window.vav.agent.send(
    conversationId,
    item.text,
    item.attachments,
    item.quote,
    allRefs.length ? allRefs : null,
    item.contextFile
  )
}
