/**
 * Unseen attention items. Completions drive the macOS Dock badge;
 * asks / approvals / requests still notify and clear when the session
 * is focused (or the turn moves on).
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

export function completeAttentionId(conversationId: string): string {
  return `complete:${conversationId}`
}

export function acknowledgeConversation(
  items: AttentionItem[],
  conversationId: string
): AttentionItem[] {
  if (!conversationId) return items
  return items.filter((item) => item.conversationId !== conversationId)
}

/** Earliest unseen Done — insertion order is completion order. */
export function firstCompleteConversation(items: AttentionItem[]): string | null {
  return items.find((item) => item.kind === 'complete')?.conversationId ?? null
}

export function dockBadgeLabel(count: number): string {
  if (count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}

/** Dock shows unseen Done only — not asks / approvals / requests. */
export function completeAttentionCount(items: AttentionItem[]): number {
  return items.reduce((n, item) => n + (item.kind === 'complete' ? 1 : 0), 0)
}
