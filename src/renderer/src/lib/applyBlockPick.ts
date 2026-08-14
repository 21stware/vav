import type { PreviewBlock } from '@shared/previewBlock'
import type { PreviewRef } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { isPickGestureActive } from './clickPick'

function pickLabel(block: PreviewBlock): string {
  if (block.label) return block.label
  if (block.kind === 'line' || block.id.startsWith('line-L')) return `line ${block.startLine}`
  const kind = (block.kind || 'block').replace(/_/g, '-')
  if (block.startLine === block.endLine) return `${kind} · line ${block.startLine}`
  return `${kind} · lines ${block.startLine}–${block.endLine}`
}

export function blockToPreviewRef(
  sourcePath: string,
  badge: string,
  block: PreviewBlock
): PreviewRef {
  return {
    id: `${sourcePath}::${block.id}`,
    filePath: sourcePath,
    label: pickLabel(block),
    startLine: block.startLine,
    endLine: block.endLine,
    text: block.text,
    badge
  }
}

/** Attach a picked block to the session comment cards + CLI prompt. */
export function applyBlockPick(opts: {
  conversationId?: string | null
  sourcePath: string
  badge: string
  block: PreviewBlock
}): void {
  const conversationId = opts.conversationId ?? useSessionStore.getState().activeId
  if (!conversationId) return

  const ref = blockToPreviewRef(opts.sourcePath, opts.badge, opts.block)
  const store = useSessionStore.getState()
  const existing = store.commentCards[conversationId] ?? []
  if (existing.some((c) => c.ref.id === ref.id)) {
    store.setCommentCards(
      conversationId,
      existing.filter((c) => c.ref.id !== ref.id)
    )
    return
  }
  const cleaned = existing.filter((c) => c.comment.trim())
  store.setCommentCards(conversationId, [...cleaned, { ref, comment: '' }])

  void import('./cliFocusHandoff').then(({ handoffBlockToCli }) => {
    handoffBlockToCli(conversationId, ref)
  })
  requestAnimationFrame(() => {
    if (isPickGestureActive()) return
    store.focusCommentCard(ref.id)
  })
}

export function selectedBlockIdsForPath(
  conversationId: string | null | undefined,
  sourcePath: string
): string[] {
  if (!conversationId) return []
  const cards = useSessionStore.getState().commentCards[conversationId] ?? []
  const prefix = `${sourcePath}::`
  return cards.filter((c) => c.ref.id.startsWith(prefix)).map((c) => c.ref.id.slice(prefix.length))
}
