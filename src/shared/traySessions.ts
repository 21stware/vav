/**
 * Tray menu grouping: live CLI agents and bash panes, bucketed by workdir.
 * Agents sit above bash inside each directory.
 */

export type TrayPaneKind = 'agent' | 'bash'

export type TrayPane = {
  conversationId: string
  tabId: string
  kind: TrayPaneKind
  /** Conversation title. */
  sessionTitle: string
  /** Agent name or bash tab title. */
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
  return `${pane.sessionTitle} · ${pane.paneTitle}`
}

/** Group by directory; within a group, agents first, then bash, oldest first. */
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
      if (a.kind !== b.kind) return a.kind === 'agent' ? -1 : 1
      return a.createdAt - b.createdAt
    })
    return {
      dirKey,
      dirLabel: list[0]?.dirLabel || dirKey,
      panes: list
    }
  })
}
