import type { ConversationMeta, SidebarGroupingMode } from '@shared/types'
import { basename } from './path'
import { isTemporaryWorkspace } from './format'
import { tt } from '../i18n/useT'

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
  kind?: 'workspace' | 'time'
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
