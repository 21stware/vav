/**
 * Tray menu grouping: live CLI agents, VAV chat sessions, and bash panes,
 * bucketed by workdir. Inside each directory: agents, then chats, then bash.
 */

export type TrayPaneKind = 'agent' | 'chat' | 'bash'

const KIND_ORDER: Record<TrayPaneKind, number> = {
  agent: 0,
  chat: 1,
  bash: 2
}

/** Two em spaces so session rows sit under the path header. */
export const TRAY_ITEM_INDENT = '\u2003\u2003'

export type TrayPane = {
  conversationId: string
  tabId: string
  kind: TrayPaneKind
  /** Conversation title. */
  sessionTitle: string
  /** Agent name, VAV, or bash tab title. */
  paneTitle: string
  /** Absolute workdir or a stable fallback key. */
  dirKey: string
  /** Compact label for the group header (`~/repo/vav`). */
  dirLabel: string
  createdAt: number
  agentId?: string
}

export type TrayPaneGroup = {
  dirKey: string
  dirLabel: string
  panes: TrayPane[]
}

export function trayItemLabel(pane: TrayPane): string {
  if (pane.kind === 'agent') return `${pane.sessionTitle} - ${pane.paneTitle}`
  if (pane.kind === 'bash') return `${pane.sessionTitle} · ${pane.paneTitle}`
  return pane.sessionTitle
}

export function trayIndentedLabel(label: string): string {
  return `${TRAY_ITEM_INDENT}${label}`
}

export function trayPaneKey(pane: Pick<TrayPane, 'conversationId' | 'kind' | 'tabId'>): string {
  return `${pane.conversationId}:${pane.kind}:${pane.tabId}`
}

/** Live rows win; unseen completed rows fill in anything not already listed. */
export function mergeLiveAndUnseenTrayPanes(live: TrayPane[], unseen: TrayPane[]): TrayPane[] {
  const keys = new Set(live.map(trayPaneKey))
  const extra: TrayPane[] = []
  for (const pane of unseen) {
    const key = trayPaneKey(pane)
    if (keys.has(key)) continue
    keys.add(key)
    extra.push(pane)
  }
  return [...live, ...extra]
}

/**
 * First idle after spawn is the shell settling, not a finished command.
 * A later running→idle (or a long first run) is a completed result.
 */
export function shouldRecordPtyCompletion(opts: {
  primed: boolean
  runningSince: number | null
  now: number
  minRunMs?: number
}): boolean {
  if (opts.runningSince == null) return false
  if (opts.primed) return true
  return opts.now - opts.runningSince >= (opts.minRunMs ?? 1200)
}

/** Group by directory; within a group, agents, then chats, then bash. */
export function groupTrayPanes(panes: TrayPane[]): TrayPaneGroup[] {
  const buckets = new Map<string, TrayPane[]>()
  const order: string[] = []
  for (const pane of panes) {
    const key = pane.dirKey || '~'
    const list = buckets.get(key)
    if (list) list.push(pane)
    else {
      buckets.set(key, [pane])
      order.push(key)
    }
  }
  return order.map((dirKey) => {
    const list = buckets.get(dirKey) ?? []
    list.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      // Chats arrive with updatedAt as createdAt — newest first.
      if (a.kind === 'chat') return b.createdAt - a.createdAt
      return a.createdAt - b.createdAt
    })
    return {
      dirKey,
      dirLabel: list[0]?.dirLabel || dirKey,
      panes: list
    }
  })
}
