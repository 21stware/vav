import { trayPaneKey, type TrayPane } from '../../shared/traySessions.ts'

export type ResultUnseenKind = 'ok' | 'failed'

export type TrayUnseenConversation = {
  resultUnseen?: boolean
  resultKind?: ResultUnseenKind
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
  resultKind?: ResultUnseenKind
  getConversation: (id: string) => TrayUnseenConversation | null | undefined
  updateMeta: (id: string, patch: { resultUnseen: boolean; resultKind?: ResultUnseenKind }) => void
  broadcast: () => void
}): boolean {
  const conversation = opts.getConversation(opts.conversationId)
  if (!conversation) return false
  // First unseen finish wins — later PTY idle / exit must not flip the LED.
  if (opts.unseen) {
    if (conversation.resultUnseen) return false
    opts.updateMeta(opts.conversationId, {
      resultUnseen: true,
      resultKind: opts.resultKind ?? 'ok'
    })
  } else {
    if (!conversation.resultUnseen && conversation.resultKind == null) return false
    opts.updateMeta(opts.conversationId, { resultUnseen: false, resultKind: undefined })
  }
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
  const key = trayPaneKey(opts.pane)
  if (!opts.unseen.has(key)) {
    opts.unseen.set(key, {
      ...opts.pane,
      status: opts.pane.status === 'failed' ? 'failed' : 'done'
    })
  }
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
