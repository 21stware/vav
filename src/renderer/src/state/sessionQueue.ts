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

/** Composer chip, else the session's focused file (CLI handoff uses the same). */
export function resolveComposerContextFile(
  contextFiles: Record<string, string | null | undefined>,
  conversations: Array<{ id: string; focusedFilePath?: string | null }>,
  id: string
): string | null {
  return (contextFiles[id] ?? null) || conversations.find((c) => c.id === id)?.focusedFilePath || null
}

export function isEmptyComposerSend(
  text: string,
  attachments: string[],
  refs: unknown[],
  cards: unknown[]
): boolean {
  return !text.trim() && attachments.length === 0 && refs.length === 0 && cards.length === 0
}

export type ComposerSendDisposition = 'empty' | 'awaiting' | 'need-key' | 'full' | 'enqueue' | 'send'

/** First-send gate: empty / parked ask / missing VAV key / queue / go. */
export function composerSendDisposition(input: {
  empty: boolean
  awaitingTool: boolean
  needsApiKey: boolean
  isRunning: boolean
  queueLength: number
  maxQueue?: number
}): ComposerSendDisposition {
  if (input.empty) return 'empty'
  if (input.awaitingTool) return 'awaiting'
  if (input.needsApiKey) return 'need-key'
  if (!input.isRunning) return 'send'
  if (input.queueLength >= (input.maxQueue ?? MESSAGE_QUEUE_MAX)) return 'full'
  return 'enqueue'
}

/** Poll until `predicate` is true, or `timeoutMs` elapses. First check is immediate. */
export async function pollUntil(
  predicate: () => boolean,
  opts?: {
    timeoutMs?: number
    intervalMs?: number
    now?: () => number
    delay?: (ms: number) => Promise<void>
  }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 20_000
  const intervalMs = opts?.intervalMs ?? 40
  const now = opts?.now ?? Date.now
  const delay =
    opts?.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const started = now()
  for (;;) {
    if (predicate()) return true
    if (now() - started >= timeoutMs) return false
    await delay(intervalMs)
  }
}

/** After a turn ends, drain FIFO only when idle and no send-now is in flight. */
export function shouldDrainMessageQueue(opts: {
  sendNowInFlight: boolean
  isRunning?: boolean
  awaitingToolCallId?: string | null
  queueLength: number
}): boolean {
  if (opts.sendNowInFlight) return false
  if (opts.isRunning || opts.awaitingToolCallId) return false
  return opts.queueLength > 0
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

/** Clear the composer and any send-time error banner for this conversation. */
export function composerClearedPatch<
  T extends {
    drafts: Record<string, string>
    attachments: Record<string, string[]>
    quotes: Record<string, QuoteDraft | null>
    previewRefs: Record<string, PreviewRef[]>
    commentCards: Record<string, { ref: PreviewRef; comment: string }[]>
  }
>(state: T, activeId: string): {
  drafts: T['drafts']
  attachments: T['attachments']
  quotes: T['quotes']
  previewRefs: T['previewRefs']
  commentCards: T['commentCards']
  errorBanner: null
  errorBannerKind: null
  errorBannerDetail: null
} {
  return {
    drafts: { ...state.drafts, [activeId]: '' },
    attachments: { ...state.attachments, [activeId]: [] },
    quotes: { ...state.quotes, [activeId]: null },
    previewRefs: { ...state.previewRefs, [activeId]: [] },
    commentCards: { ...state.commentCards, [activeId]: [] },
    errorBanner: null,
    errorBannerKind: null,
    errorBannerDetail: null
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
