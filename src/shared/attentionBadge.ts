/**
 * Unseen attention items that drive the macOS Dock badge.
 *
 * One session usually holds a single item, so focusing it drops the badge
 * by 1. Completions, asks, approvals, and requests all count until the
 * user looks at that session (or the turn moves on).
 */
export type AttentionKind = 'ask' | 'approval' | 'request' | 'complete'

export interface AttentionItem {
  id: string
  conversationId: string
  kind: AttentionKind
}

export function addAttentionItem(items: AttentionItem[], next: AttentionItem): AttentionItem[] {
  if (items.some((item) => item.id === next.id)) return items
  return [...items, next]
}

export function acknowledgeConversation(
  items: AttentionItem[],
  conversationId: string
): AttentionItem[] {
  if (!conversationId) return items
  return items.filter((item) => item.conversationId !== conversationId)
}

export function dockBadgeLabel(count: number): string {
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}
