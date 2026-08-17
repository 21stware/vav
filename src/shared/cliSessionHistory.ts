import type { CliHostKind, ProviderResumeCursor } from './cliHost'
import type { TrayPane } from './traySessions'

/** Host/UI fallbacks — keep in sync with `agents.sessionUntitled` / `common.untitledSession`. */
const BLANK_SESSION_TITLES = new Set([
  '未命名会话',
  'Untitled session',
  '新会话',
  'New session',
  '新对话',
  'New chat'
])

/** Persistent native CLI session — survives pane close so History can resume it. */
export interface SwarmSessionRecord {
  key: string
  agentId: CliHostKind
  cursor: ProviderResumeCursor
  /** User-given name; wins over the host title when set. */
  name: string | null
  /** Last title read from the host session store. */
  title: string | null
  conversationId: string
  workingDirectory: string
  createdAt: number
  updatedAt: number
}

export interface SwarmHistoryRow {
  id: string
  conversationId: string
  tabId: string | null
  agentId: string
  agentName: string
  /** Display title only — tray label is `${title} - ${agentName}`. */
  title: string
  dirKey: string
  dirLabel: string
  createdAt: number
  updatedAt: number
  live: boolean
  resumable: boolean
  cursor: ProviderResumeCursor | null
}

export interface SwarmHistoryGroup {
  dirKey: string
  dirLabel: string
  items: SwarmHistoryRow[]
}

export function swarmSessionKey(agentId: string, sessionId: string): string {
  return `${agentId}:${sessionId}`
}

export function liveSwarmHistoryId(conversationId: string, tabId: string): string {
  return `live:${conversationId}:${tabId}`
}

export function parseSwarmHistoryId(
  id: string
):
  | { kind: 'session'; agentId: string; sessionId: string }
  | { kind: 'live'; conversationId: string; tabId: string }
  | null {
  if (id.startsWith('live:')) {
    const rest = id.slice('live:'.length)
    const split = rest.indexOf(':')
    if (split <= 0 || split === rest.length - 1) return null
    return {
      kind: 'live',
      conversationId: rest.slice(0, split),
      tabId: rest.slice(split + 1)
    }
  }
  const split = id.indexOf(':')
  if (split <= 0 || split === id.length - 1) return null
  return { kind: 'session', agentId: id.slice(0, split), sessionId: id.slice(split + 1) }
}

export function swarmSessionDisplayTitle(input: {
  name?: string | null
  title?: string | null
  fallback: string
}): string {
  const named = input.name?.replace(/\s+/g, ' ').trim()
  if (named) return named
  const titled = input.title?.replace(/\s+/g, ' ').trim()
  if (titled && !isBlankSwarmSessionTitle(titled)) return titled
  return input.fallback
}

/** No user-given name and no host title — opened then closed without a turn. */
export function isBlankSwarmSessionTitle(title: string | null | undefined): boolean {
  const trimmed = title?.replace(/\s+/g, ' ').trim()
  if (!trimmed) return true
  return BLANK_SESSION_TITLES.has(trimmed)
}

/** Closed History rows with no dialogue (and no rename) should not be listed. */
export function shouldKeepClosedSwarmHistoryRecord(input: {
  name?: string | null
  title?: string | null
  hasConversation?: boolean
}): boolean {
  if (input.name?.replace(/\s+/g, ' ').trim()) return true
  if (input.hasConversation === true) return true
  return !isBlankSwarmSessionTitle(input.title)
}

/** Same string the tray menu shows for an agent pane (`Title - Agent`). */
export function swarmHistoryItemLabel(row: Pick<SwarmHistoryRow, 'title' | 'agentName'>): string {
  return `${row.title} - ${row.agentName}`
}

/** One row in a tray-shaped native History menu. */
export type SwarmHistoryMenuEntry =
  | { kind: 'header'; label: string }
  | { kind: 'separator' }
  | { kind: 'dir'; label: string }
  | { kind: 'item'; id: string; label: string }
  | { kind: 'empty'; label: string }

/**
 * Tray-shaped select: disabled header, dir groups, each session as a submenu.
 */
export function buildSwarmHistoryMenuEntries(input: {
  header: string
  emptyLabel: string
  groups: { dirLabel: string; items: { id: string; label: string }[] }[]
}): SwarmHistoryMenuEntry[] {
  const entries: SwarmHistoryMenuEntry[] = [{ kind: 'header', label: input.header }]
  const visible = input.groups.filter((group) => group.items.length > 0)
  if (visible.length === 0) {
    entries.push({ kind: 'separator' }, { kind: 'empty', label: input.emptyLabel })
    return entries
  }
  for (const group of visible) {
    entries.push({ kind: 'separator' }, { kind: 'dir', label: group.dirLabel })
    for (const item of group.items) {
      entries.push({ kind: 'item', id: item.id, label: item.label })
    }
  }
  return entries
}

/**
 * Split the focused pane along its long edge.
 * `row` = left/right (⌘D); `column` = top/bottom (⌘⇧D).
 */
export function longEdgeSplitAxis(width: number, height: number): 'row' | 'column' {
  return width >= height ? 'row' : 'column'
}



export function mergeSwarmHistoryRows(
  live: SwarmHistoryRow[],
  extras: SwarmHistoryRow[]
): SwarmHistoryRow[] {
  const seen = new Set<string>()
  const out: SwarmHistoryRow[] = []
  for (const row of live) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  for (const row of extras) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

/**
 * Group like the tray: first-seen directory order, live agents first inside
 * a directory (oldest first), then closed sessions newest first.
 */
export function groupSwarmHistoryRows(rows: SwarmHistoryRow[]): SwarmHistoryGroup[] {
  const buckets = new Map<string, SwarmHistoryRow[]>()
  const order: string[] = []
  for (const row of rows) {
    const key = row.dirKey || '~'
    const list = buckets.get(key)
    if (list) list.push(row)
    else {
      buckets.set(key, [row])
      order.push(key)
    }
  }
  return order.map((dirKey) => {
    const list = buckets.get(dirKey) ?? []
    list.sort((a, b) => {
      if (a.live !== b.live) return a.live ? -1 : 1
      if (a.live && b.live) return a.createdAt - b.createdAt
      return b.updatedAt - a.updatedAt
    })
    return {
      dirKey,
      dirLabel: list[0]?.dirLabel || dirKey,
      items: list
    }
  })
}

/** Build a tray-shaped live row so History labels stay identical to the menu. */
export function trayPaneToHistoryRow(
  pane: TrayPane,
  extras: {
    title: string
    resumable: boolean
    cursor: ProviderResumeCursor | null
    sessionId?: string | null
    updatedAt?: number
  }
): SwarmHistoryRow {
  const sid = extras.sessionId?.trim() || null
  return {
    id: sid
      ? swarmSessionKey(pane.agentId || 'cli', sid)
      : liveSwarmHistoryId(pane.conversationId, pane.tabId),
    conversationId: pane.conversationId,
    tabId: pane.tabId,
    agentId: pane.agentId || 'cli',
    agentName: pane.paneTitle,
    title: extras.title,
    dirKey: pane.dirKey,
    dirLabel: pane.dirLabel,
    createdAt: pane.createdAt,
    updatedAt: extras.updatedAt ?? pane.createdAt,
    live: true,
    resumable: extras.resumable,
    cursor: extras.cursor
  }
}
