import type { PreviewRef } from '../../../shared/types.ts'

export type SessionCommentCard = { ref: PreviewRef; comment: string }

export function setCommentCardsMap(
  cards: Record<string, SessionCommentCard[]>,
  id: string,
  next: SessionCommentCard[]
): Record<string, SessionCommentCard[]> {
  return { ...cards, [id]: next }
}

export function updateCommentCardInMap(
  cards: Record<string, SessionCommentCard[]>,
  id: string,
  refId: string,
  comment: string
): Record<string, SessionCommentCard[]> {
  return {
    ...cards,
    [id]: (cards[id] ?? []).map((c) => (c.ref.id === refId ? { ...c, comment } : c))
  }
}

export function removeCommentCardFromMap(
  cards: Record<string, SessionCommentCard[]>,
  id: string,
  refId: string
): Record<string, SessionCommentCard[]> {
  return {
    ...cards,
    [id]: (cards[id] ?? []).filter((c) => c.ref.id !== refId)
  }
}

export function clearCommentCardsMap(
  cards: Record<string, SessionCommentCard[]>,
  id: string
): Record<string, SessionCommentCard[]> {
  return { ...cards, [id]: [] }
}
