import type { ConversationMeta, TerminalLayoutNode } from '../../../shared/types.ts'
import { mergeConversationList } from './sessionListMerge.ts'

export async function persistSwarmLayout(
  set: (partial: { conversations: ConversationMeta[] }) => void,
  getConversations: () => ConversationMeta[],
  rootId: string,
  layout: TerminalLayoutNode | null,
  full?: TerminalLayoutNode | null
): Promise<void> {
  const list = await window.vav.conversations.setSwarmLayout(rootId, layout, full)
  set({ conversations: mergeConversationList(getConversations(), list) })
}

export function setLeaf(
  set: (partial: { activeLeaf: Record<string, string | null> }) => void,
  activeLeaf: Record<string, string | null>,
  conversationId: string,
  leafId: string | null
): void {
  set({ activeLeaf: { ...activeLeaf, [conversationId]: leafId } })
}
