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

export function isEmptyComposerSend(
  text: string,
  attachments: string[],
  refs: unknown[],
  cards: unknown[]
): boolean {
  return !text.trim() && attachments.length === 0 && refs.length === 0 && cards.length === 0
}

/** Comment cards win on id collision so the model gets the note, not a duplicate chip. */
export function mergePreviewAndCommentRefs(
  refs: PreviewRef[],
  cards: { ref: PreviewRef; comment: string }[]
): PreviewRef[] {
  const cardRefs = cards.map((c) => {
    const note = c.comment.trim()
    return note ? { ...c.ref, comment: note } : { ...c.ref }
  })
  const byId = new Map<string, PreviewRef>()
  for (const ref of refs) byId.set(ref.id, ref)
  for (const ref of cardRefs) byId.set(ref.id, ref)
  return [...byId.values()]
}

export function buildQueuedMessage(input: {
  text: string
  attachments: string[]
  previewRefs: PreviewRef[]
  commentCards: { ref: PreviewRef; comment: string }[]
  quote: QuoteDraft | null
  contextFile: string | null
  now?: number
  id?: string
}): QueuedMessage {
  const now = input.now ?? Date.now()
  return {
    id: input.id ?? `q-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text: input.text.trim(),
    attachments: [...input.attachments],
    previewRefs: input.previewRefs.map((r) => ({ ...r })),
    commentCards: input.commentCards.map((c) => ({
      ref: { ...c.ref },
      comment: c.comment
    })),
    quote: input.quote ? { ...input.quote } : null,
    contextFile: input.contextFile,
    createdAt: now
  }
}

/** Merge comment cards + preview refs, then fire agent.send. */
export async function dispatchQueuedPayload(
  conversationId: string,
  item: QueuedMessage,
  selectIfNeeded: () => Promise<void>
): Promise<void> {
  const allRefs = mergePreviewAndCommentRefs(item.previewRefs, item.commentCards)

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
