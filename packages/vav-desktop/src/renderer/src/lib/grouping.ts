import { dbConnectionTitle, type DbConnection } from '@shared/dbConnection'
import { isDefaultSessionTitle } from '@shared/i18n'
import { isDraftDbTitle } from './draftEditorTitle'
import {
  conversationProviderId,
  displayNameForCliHost,
  isStructuredCliHost,
  type ConversationMeta,
  type SidebarGroupingMode
} from '@shared/types'
import { basename } from './path'
import { isTemporaryWorkspace } from './format'
import { tt } from '../i18n/useT'
import { conversationOnMachine } from '@shared/workspaceHost'
import { sessionKindOf } from '@shared/sessionKind'
import {
  conversationMatchesFilter,
  type SidebarSessionFilter
} from './sidebarSessionFilter'

/** Sidebar key for the default empty Temporary Workspace shell. */
export const DEFAULT_WORKSPACE_KEY = '__temporary__'

export interface ConversationGroup {
  /** Stable id for collapse state; empty for pinned/search flat buckets. */
  key: string
  /**
   * Empty for the loose-pinned bucket and for search results — neither gets a
   * header. Workspace mode puts a label on every other bucket.
   */
  label: string
  /** Visual cue on the group header; omitted for time buckets. */
  kind?: 'workspace' | 'time' | 'provider' | 'database'
  /** Live connection id when kind is database. */
  connectionId?: string
  /** Provider id when kind is provider. */
  providerId?: string
  /**
   * Absolute workdir when kind is workspace.
   * `null` = Default workspace shell (not a project path; not selectable).
   */
  workdir?: string | null
  /**
   * False for the Default workspace bucket — it groups loose sessions but is
   * not a project path, so the header cannot open Workspace View.
   */
  workspaceSelectable?: boolean
  /** Renders inside the sidebar's 置顶 section instead of the main list. */
  pinned?: boolean
  conversations: ConversationMeta[]
}

const DAY = 24 * 60 * 60 * 1000

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Which time bucket a row falls into. "This week" is the trailing seven days
 * rather than the calendar week.
 */
function bucketOf(updatedAt: number, now: number): number {
  const today = startOfDay(now)
  if (updatedAt >= today) return 0
  if (updatedAt >= today - DAY) return 1
  if (updatedAt >= today - 6 * DAY) return 2
  return 3
}

function bucketLabels(): string[] {
  return [
    tt('sidebar.bucket.today'),
    tt('sidebar.bucket.yesterday'),
    tt('sidebar.bucket.thisWeek'),
    tt('sidebar.bucket.earlier')
  ]
}

function byUpdatedDesc(a: ConversationMeta, b: ConversationMeta): number {
  return b.updatedAt - a.updatedAt
}

function workspaceKey(conversation: ConversationMeta, tmp: string): string {
  if (isTemporaryWorkspace(conversation.workingDirectory, tmp)) return DEFAULT_WORKSPACE_KEY
  return conversation.workingDirectory ?? DEFAULT_WORKSPACE_KEY
}

function workspaceLabel(conversation: ConversationMeta, tmp: string): string {
  if (isTemporaryWorkspace(conversation.workingDirectory, tmp) || !conversation.workingDirectory) {
    return tt('sidebar.defaultWorkspace')
  }
  return basename(conversation.workingDirectory)
}

function byPinTimeDesc(a: ConversationMeta, b: ConversationMeta): number {
  return (b.pinTime ?? 0) - (a.pinTime ?? 0)
}

/** Inside a pinned workspace, pinned rows still float above the rest. */
function pinnedFirst(a: ConversationMeta, b: ConversationMeta): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return a.pinned ? byPinTimeDesc(a, b) : byUpdatedDesc(a, b)
}

/**
 * Orders the sidebar. Everything the user pinned comes first — whole workspaces
 * (in pin order, carrying their sessions) then loose pinned rows — and the
 * remainder follows the active grouping mode. A pinned workspace is *moved*,
 * never duplicated, so its sessions leave the time/workspace buckets below.
 * Searching collapses the remaining headers — they would only add noise.
 */
export function groupConversations(
  conversations: ConversationMeta[],
  searching: boolean,
  mode: SidebarGroupingMode = 'none',
  tmp = '',
  pinnedWorkspaces: readonly string[] = [],
  now = Date.now()
): ConversationGroup[] {
  const groups: ConversationGroup[] = []
  const roots = conversations.filter((c) => !c.swarmParentId)
  // Sessions already claimed by a pinned workspace must not appear again below.
  const claimed = new Set<string>()

  for (const path of pinnedWorkspaces) {
    if (!path || path.startsWith('__') || isTemporaryWorkspace(path, tmp)) continue
    const rows = roots
      .filter((c) => c.workingDirectory === path)
      .sort(pinnedFirst)
    // An empty pin is still a useful shortcut, but not while filtering.
    if (searching && rows.length === 0) continue
    for (const row of rows) claimed.add(row.id)
    groups.push({
      key: `workspace:${path}`,
      label: basename(path),
      kind: 'workspace',
      workdir: path,
      pinned: true,
      conversations: rows
    })
  }

  const loose = roots.filter((c) => !claimed.has(c.id))
  const pinned = loose.filter((c) => c.pinned).sort(byPinTimeDesc)
  const rest = loose.filter((c) => !c.pinned).sort(byUpdatedDesc)

  if (pinned.length) {
    groups.push({ key: 'pinned', label: '', pinned: true, conversations: pinned })
  }

  if (searching) {
    if (rest.length) groups.push({ key: 'search', label: '', conversations: rest })
    return groups
  }

  if (mode === 'workspace') {
    groups.push(...bucketByWorkspace(rest, tmp))
    return groups
  }

  if (mode === 'provider') {
    groups.push(...bucketByProvider(rest))
    return groups
  }

  const labels = bucketLabels()
  for (let bucket = 0; bucket < labels.length; bucket++) {
    const rows = rest.filter((c) => bucketOf(c.updatedAt, now) === bucket)
    if (rows.length) {
      groups.push({
        key: `time:${bucket}`,
        label: labels[bucket],
        kind: 'time',
        conversations: rows
      })
    }
  }
  return groups
}

function providerLabel(key: string): string {
  if (key === 'vav') return tt('agents.plainShell')
  if (isStructuredCliHost(key)) return displayNameForCliHost(key)
  return key
}

/** Groups by chat provider, ordered by the newest row inside each bucket. */
function bucketByProvider(rows: ConversationMeta[]): ConversationGroup[] {
  const map = new Map<string, ConversationMeta[]>()
  for (const row of rows) {
    const key = conversationProviderId(row)
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }

  return [...map.entries()]
    .map(([key, conversations]) => {
      const sorted = [...conversations].sort(byUpdatedDesc)
      return {
        key: `provider:${key}`,
        label: providerLabel(key),
        kind: 'provider' as const,
        providerId: key,
        conversations: sorted
      }
    })
    .sort((a, b) => {
      const aAt = a.conversations[0]?.updatedAt ?? 0
      const bAt = b.conversations[0]?.updatedAt ?? 0
      return bAt - aAt
    })
}

/** Groups by workingDirectory, ordered by the newest row inside each bucket. */
function bucketByWorkspace(rows: ConversationMeta[], tmp: string): ConversationGroup[] {
  const map = new Map<string, ConversationMeta[]>()
  for (const row of rows) {
    const key = workspaceKey(row, tmp)
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }

  // Always surface a default Workspace shell — empty until first chat / file.
  if (!map.has(DEFAULT_WORKSPACE_KEY)) {
    map.set(DEFAULT_WORKSPACE_KEY, [])
  }

  return [...map.entries()]
    .map(([key, conversations]) => {
      const sorted = [...conversations].sort(byUpdatedDesc)
      const first = sorted[0]
      const workdir =
        key === DEFAULT_WORKSPACE_KEY
          ? (first?.workingDirectory ?? null)
          : (first?.workingDirectory ?? key)
      const isDefault = key === DEFAULT_WORKSPACE_KEY
      return {
        key: `workspace:${key}`,
        label: first ? workspaceLabel(first, tmp) : tt('sidebar.defaultWorkspace'),
        kind: 'workspace' as const,
        workdir,
        // Default workspace is a bucket for unrooted sessions, not a project.
        workspaceSelectable: !isDefault,
        conversations: sorted
      }
    })
    .sort((a, b) => {
      // Keep the default Workspace shell first when it has no sessions yet.
      if (a.key === `workspace:${DEFAULT_WORKSPACE_KEY}` && a.conversations.length === 0) return -1
      if (b.key === `workspace:${DEFAULT_WORKSPACE_KEY}` && b.conversations.length === 0) return 1
      const aAt = a.conversations[0]?.updatedAt ?? 0
      const bAt = b.conversations[0]?.updatedAt ?? 0
      return bAt - aAt
    })
}

/** Flat visible order, for arrow-key movement and ⌘A. */
export function flatten(
  groups: ConversationGroup[],
  collapsedKeys: ReadonlySet<string> = new Set(),
  extras?: (conversation: ConversationMeta) => ConversationMeta[]
): ConversationMeta[] {
  return groups.flatMap((group) => {
    if (collapsedKeys.has(group.key)) return []
    return group.conversations.flatMap((row) => [row, ...(extras?.(row) ?? [])])
  })
}

/** Sidebar / agent label: user title if they named it, else `database@host`. */
export function stableDatabaseTitle(
  row: Pick<DbConnection, 'title' | 'database' | 'host' | 'driver' | 'user'>,
  untitled: string
): string {
  const custom = row.title.trim()
  if (custom && !isDraftDbTitle(custom, untitled) && !isDefaultSessionTitle(custom)) {
    return custom
  }
  return dbConnectionTitle({ ...row, title: '' })
}

/** DB connections must appear even when listMeta omitted the session row. */
export function mergeConnectedDbConversations(
  conversations: ConversationMeta[],
  connections: readonly DbConnection[]
): ConversationMeta[] {
  const extra: ConversationMeta[] = []
  for (const row of connections) {
    if (!row.conversationId) continue
    if (conversations.some((conversation) => conversation.id === row.conversationId)) continue
    extra.push({
      id: row.conversationId,
      title: dbConnectionTitle(row),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      workingDirectory: null,
      model: '',
      tokensUsed: 0,
      tokenLimit: 0,
      pinned: false,
      pinTime: null,
      duplicateSourceId: null,
      duplicateSourceTitle: null,
      archived: false,
      archivedAt: null,
      approvalMode: 'auto',
      sessionKind: 'db',
      dbConnectionId: row.id
    })
  }
  return extra.length ? [...conversations, ...extra] : conversations
}

/** Archive bucket, or live rows grouped after machine/search/filter + swarm-parent keep. */
export function listedSidebarGroups(
  conversations: ConversationMeta[],
  opts: {
    fileSessionsView: boolean
    archiveView: boolean
    databasesView?: boolean
    excludeIds?: ReadonlySet<string>
    query: string
    windowMachineId: string | null | undefined
    sessionFilter: SidebarSessionFilter
    running: (id: string) => boolean
    unread: (id: string) => boolean
    favoriteIds: ReadonlySet<string>
    /** Current selection — never hidden by the session filter. */
    focusedId?: string | null
    searching: boolean
    groupingMode: SidebarGroupingMode
    tmp: string
    pinnedWorkspaces: readonly string[]
    /** Table names by connection id — search still matches tables even though they live in the preview. */
    dbTableNames?: Record<string, string[]>
    /** Conversation id → live connection id when meta omitted `dbConnectionId`. */
    dbConnectionIds?: Record<string, string>
    /** Conversation id → stable connection title (never the auto-titled chat). */
    dbTitles?: Record<string, string>
  }
): ConversationGroup[] {
  if (opts.fileSessionsView) return []
  const needle = opts.query.trim().toLowerCase()
  if (opts.databasesView) {
    const rows = conversations
      .filter((c) => sessionKindOf(c) === 'db' && !c.archived)
      .filter((c) => !opts.excludeIds?.has(c.id))
      .filter((c) => conversationOnMachine(c, opts.windowMachineId))
      .filter((c) => {
        if (!needle) return true
        if (c.title.toLowerCase().includes(needle)) return true
        if ((opts.dbTitles?.[c.id] ?? '').toLowerCase().includes(needle)) return true
        const connectionId = c.dbConnectionId ?? opts.dbConnectionIds?.[c.id]
        const tables = connectionId ? (opts.dbTableNames?.[connectionId] ?? []) : []
        return tables.some((name) => name.toLowerCase().includes(needle))
      })
    const pinned = rows.filter((c) => c.pinned).sort(byPinTimeDesc)
    const rest = rows.filter((c) => !c.pinned).sort(byUpdatedDesc)
    const toGroup = (conversation: ConversationMeta, isPinned: boolean): ConversationGroup => ({
      key: `db:${conversation.id}`,
      // Connection title for the session row. Tables render in the preview, not here.
      label: opts.dbTitles?.[conversation.id] || conversation.title,
      kind: 'database',
      connectionId: conversation.dbConnectionId ?? opts.dbConnectionIds?.[conversation.id],
      pinned: isPinned || undefined,
      conversations: [conversation]
    })
    return [...pinned.map((row) => toGroup(row, true)), ...rest.map((row) => toGroup(row, false))]
  }
  // File-bound sessions live only under “File sessions” — never in workspace
  // groups. listMeta already omits them; the store still hydrates them for
  // FileSessionView, so we must filter here or a Downloads/file click looks
  // like a normal project session that “wrongly” opens the file canvas.
  if (opts.archiveView) {
    const rows = conversations
      .filter((c) => c.archived && !c.fileId && sessionKindOf(c) !== 'timer' && sessionKindOf(c) !== 'db')
      .filter((c) => conversationOnMachine(c, opts.windowMachineId))
      .filter((c) => !needle || c.title.toLowerCase().includes(needle))
      .sort((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
    return [{ key: 'archive', label: '', conversations: rows }]
  }
  const matched = conversations
    .filter((c) => !c.archived && !c.fileId && sessionKindOf(c) !== 'timer' && sessionKindOf(c) !== 'db')
    .filter((c) => conversationOnMachine(c, opts.windowMachineId))
    .filter((c) => !needle || c.title.toLowerCase().includes(needle))
    .filter((c) =>
      conversationMatchesFilter(c, opts.sessionFilter, {
        running: opts.running(c.id),
        unread: opts.unread(c.id),
        favoriteIds: opts.favoriteIds,
        focused: c.id === opts.focusedId
      })
    )
  const keep = new Set(matched.map((c) => c.id))
  for (const row of matched) {
    if (row.swarmParentId) keep.add(row.swarmParentId)
  }
  const rows = conversations.filter(
    (c) => keep.has(c.id) && !c.archived && !c.fileId && sessionKindOf(c) !== 'timer' && sessionKindOf(c) !== 'db'
  )
  return groupConversations(rows, opts.searching, opts.groupingMode, opts.tmp, opts.pinnedWorkspaces)
}
