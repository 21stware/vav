import type { TrayPane, TrayPaneKind } from '../../shared/traySessions.ts'

export type TrayPaneConversation = {
  archived?: boolean
  workingDirectory?: string | null
  title?: string | null
  updatedAt: number
  cliHost?: string | null
}

/** Build a tray row from a conversation. Archived / missing sessions are omitted. */
export function buildTrayPane(opts: {
  conversationId: string
  conversation: TrayPaneConversation | null | undefined
  kind: TrayPaneKind
  extra?: {
    tabId?: string
    paneTitle?: string
    createdAt?: number
    agentId?: string
    sessionTitle?: string
  }
  dirLabel: (workingDirectory: string) => string
  agentLabel: (agentId: string) => string
  hostDisplayName: (host: string) => string
}): TrayPane | null {
  const conversation = opts.conversation
  if (!conversation || conversation.archived) return null
  const extra = opts.extra
  const dir = conversation.workingDirectory || '~'
  const title =
    extra?.sessionTitle ||
    (conversation.title && conversation.title.trim()) ||
    opts.conversationId
  const agentId = extra?.agentId || conversation.cliHost || undefined
  const paneTitle =
    extra?.paneTitle ||
    (opts.kind === 'agent'
      ? agentId
        ? opts.agentLabel(agentId)
        : 'CLI'
      : opts.kind === 'bash'
        ? 'bash'
        : conversation.cliHost
          ? opts.hostDisplayName(conversation.cliHost)
          : 'VAV')
  return {
    conversationId: opts.conversationId,
    tabId: extra?.tabId ?? '',
    kind: opts.kind,
    sessionTitle: title,
    paneTitle,
    dirKey: dir,
    dirLabel: opts.dirLabel(dir),
    createdAt: extra?.createdAt ?? conversation.updatedAt,
    agentId
  }
}
