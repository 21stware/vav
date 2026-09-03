import { trayPaneKey, type TrayPane } from '../../shared/traySessions.ts'

export type TrayUnseenConversation = {
  resultUnseen?: boolean
  archived?: boolean
}

export function deleteUnseenForConversation(
  unseen: Map<string, TrayPane>,
  conversationId: string
): boolean {
  let changed = false
  for (const [key, pane] of unseen) {
    if (pane.conversationId !== conversationId) continue
    unseen.delete(key)
    changed = true
  }
  return changed
}

export function persistTrayResultUnseen(opts: {
  conversationId: string
  unseen: boolean
  getConversation: (id: string) => TrayUnseenConversation | null | undefined
  updateMeta: (id: string, patch: { resultUnseen: boolean }) => void
  broadcast: () => void
}): boolean {
  const conversation = opts.getConversation(opts.conversationId)
  if (!conversation || conversation.resultUnseen === opts.unseen) return false
  opts.updateMeta(opts.conversationId, { resultUnseen: opts.unseen })
  opts.broadcast()
  return true
}

/** Live foreground clears the badge; background completions stay unseen. */
export function applyUnseenResultToMap(opts: {
  pane: TrayPane
  unseen: Map<string, TrayPane>
  ephemeral: boolean
  isForeground: boolean
}): { persist?: boolean; notifyComplete: boolean } {
  if (opts.ephemeral) return { notifyComplete: false }
  if (opts.isForeground) {
    deleteUnseenForConversation(opts.unseen, opts.pane.conversationId)
    return { persist: false, notifyComplete: false }
  }
  opts.unseen.set(trayPaneKey(opts.pane), opts.pane)
  return { persist: true, notifyComplete: true }
}

export function shouldHydratePersistedUnseen(opts: {
  resultUnseen?: boolean
  archived?: boolean
  ephemeral: boolean
  alreadyListed: boolean
}): boolean {
  return Boolean(opts.resultUnseen) && !opts.archived && !opts.ephemeral && !opts.alreadyListed
}
