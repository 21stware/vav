import type { ConversationMeta, SidebarGroupingMode } from '@shared/types'
import { basename } from './path'
import { isTemporaryWorkspace } from './format'
import { tt } from '../i18n/useT'

export interface ConversationGroup {
  /** Stable id for collapse state; empty for pinned/search flat buckets. */
  key: string
  /**
   * Empty for the pinned section and for search results — neither gets a header.
   * Workspace/source modes put a label on every non-pinned bucket.
   */
  label: string
  /** Visual cue on the group header; omitted for time buckets. */
  kind?: 'workspace' | 'source' | 'time'
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
  if (isTemporaryWorkspace(conversation.workingDirectory, tmp)) return '__temporary__'
  return conversation.workingDirectory ?? '__temporary__'
}

function workspaceLabel(conversation: ConversationMeta, tmp: string): string {
  if (isTemporaryWorkspace(conversation.workingDirectory, tmp) || !conversation.workingDirectory) {
    return tt('sidebar.temporaryWorkspace')
  }
  return basename(conversation.workingDirectory)
}

function sourceKey(conversation: ConversationMeta): string {
  return conversation.duplicateSourceId ?? conversation.id
}

function sourceLabel(conversation: ConversationMeta): string {
  if (conversation.duplicateSourceId && conversation.duplicateSourceTitle) {
    return tt('sidebar.sourceFrom', { title: conversation.duplicateSourceTitle })
  }
  return conversation.title
}

/**
 * Orders the sidebar: pinned rows first by pinTime, then by the active grouping
 * mode. Searching collapses every header — they would only add noise.
 */
export function groupConversations(
  conversations: ConversationMeta[],
  searching: boolean,
  mode: SidebarGroupingMode = 'none',
  tmp = '',
  now = Date.now()
): ConversationGroup[] {
  const pinned = conversations
    .filter((c) => c.pinned)
    .sort((a, b) => (b.pinTime ?? 0) - (a.pinTime ?? 0))
  const rest = conversations.filter((c) => !c.pinned).sort(byUpdatedDesc)

  const groups: ConversationGroup[] = []
  if (pinned.length) groups.push({ key: 'pinned', label: '', conversations: pinned })

  if (searching) {
    if (rest.length) groups.push({ key: 'search', label: '', conversations: rest })
    return groups
  }

  if (mode === 'workspace') {
    groups.push(...bucketByKey(rest, (c) => workspaceKey(c, tmp), (c) => workspaceLabel(c, tmp), 'workspace'))
    return groups
  }

  if (mode === 'source') {
    groups.push(...bucketByKey(rest, sourceKey, sourceLabel, 'source'))
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

/** Groups keyed by `keyOf`, ordered by the newest row inside each bucket. */
function bucketByKey(
  rows: ConversationMeta[],
  keyOf: (c: ConversationMeta) => string,
  labelOf: (c: ConversationMeta) => string,
  kind: 'workspace' | 'source'
): ConversationGroup[] {
  const map = new Map<string, ConversationMeta[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }

  return [...map.entries()]
    .map(([key, conversations]) => {
      const sorted = [...conversations].sort(byUpdatedDesc)
      return {
        key: `${kind}:${key}`,
        label: labelOf(sorted[0]),
        kind,
        conversations: sorted
      }
    })
    .sort((a, b) => b.conversations[0].updatedAt - a.conversations[0].updatedAt)
}

/** Flat visible order, for arrow-key movement and ⌘A. */
export function flatten(
  groups: ConversationGroup[],
  collapsedKeys: ReadonlySet<string> = new Set()
): ConversationMeta[] {
  return groups.flatMap((group) =>
    collapsedKeys.has(group.key) ? [] : group.conversations
  )
}
