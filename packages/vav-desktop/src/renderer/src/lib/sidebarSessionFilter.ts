import type { ConversationMeta } from '@shared/types'
import { sessionKindOf } from '@shared/sessionKind'

export type SidebarSessionObject = 'none' | 'file' | 'knowledge' | 'data'

export type SidebarSessionFilter =
  | { kind: 'none'; object?: SidebarSessionObject }
  | { kind: 'active'; object?: SidebarSessionObject }
  | { kind: 'favorite'; object?: SidebarSessionObject }
  | { kind: 'workspace'; path: string; object?: SidebarSessionObject }

export const SIDEBAR_FILTER_NONE = 'none'
export const SIDEBAR_FILTER_ACTIVE = 'active'
export const SIDEBAR_FILTER_FAVORITE = 'favorite'
export const SIDEBAR_OBJECT_NONE = 'none'
export const SIDEBAR_OBJECTS = ['none', 'file', 'knowledge', 'data'] as const
const WORKSPACE_PREFIX = 'ws:'
const OBJECT_SUFFIX = '|obj:'

export function sessionObjectOf(filter: SidebarSessionFilter): SidebarSessionObject {
  return filter.object ?? 'none'
}

export function encodeSidebarSessionFilter(filter: SidebarSessionFilter): string {
  const base = filter.kind === 'workspace' ? `${WORKSPACE_PREFIX}${filter.path}` : filter.kind
  const object = sessionObjectOf(filter)
  return object === 'none' ? base : `${base}${OBJECT_SUFFIX}${object}`
}

export function parseSidebarSessionFilter(raw: string | undefined | null): SidebarSessionFilter {
  if (!raw) return { kind: 'none', object: 'none' }
  const split = raw.indexOf(OBJECT_SUFFIX)
  const left = split >= 0 ? raw.slice(0, split) : raw
  const objectRaw = split >= 0 ? raw.slice(split + OBJECT_SUFFIX.length) : 'none'
  const object: SidebarSessionObject =
    objectRaw === 'file' || objectRaw === 'knowledge' || objectRaw === 'data' ? objectRaw : 'none'
  if (!left || left === SIDEBAR_FILTER_NONE) return { kind: 'none', object }
  if (left === SIDEBAR_FILTER_ACTIVE) return { kind: 'active', object }
  if (left === SIDEBAR_FILTER_FAVORITE) return { kind: 'favorite', object }
  if (left.startsWith(WORKSPACE_PREFIX)) {
    const path = left.slice(WORKSPACE_PREFIX.length)
    if (path) return { kind: 'workspace', path, object }
  }
  return { kind: 'none', object }
}

export function isValidSidebarSessionFilter(raw: string): boolean {
  const parsed = parseSidebarSessionFilter(raw)
  if (parsed.kind === 'workspace') return parsed.path.length > 0
  return parsed.kind === 'none' || parsed.kind === 'active' || parsed.kind === 'favorite'
}

export function isSidebarSessionFilterEnabled(filter: SidebarSessionFilter): boolean {
  return filter.kind !== 'none' || sessionObjectOf(filter) !== 'none'
}

/**
 * PiP list: keep the sidebar's workspace / favorite filter, otherwise show
 * Running and unread (running + done) — the compact monitor set.
 */
export function pipSessionFilter(sidebarFilter: SidebarSessionFilter): SidebarSessionFilter {
  return sidebarFilter.kind === 'none'
    ? { kind: 'active', object: sessionObjectOf(sidebarFilter) }
    : sidebarFilter
}

function sameWorkdir(left: string | null | undefined, right: string): boolean {
  if (!left) return false
  const a = left.replace(/[\\/]+$/, '')
  const b = right.replace(/[\\/]+$/, '')
  return a === b
}

function conversationMatchesObject(
  conversation: ConversationMeta,
  object: SidebarSessionObject
): boolean {
  if (object === 'none') return true
  const kind = sessionKindOf(conversation)
  if (object === 'file') return kind === 'file'
  if (object === 'knowledge') return kind === 'knowledge'
  return kind === 'db'
}

export function conversationMatchesFilter(
  conversation: ConversationMeta,
  filter: SidebarSessionFilter,
  ctx: {
    running: boolean
    unread: boolean
    favoriteIds: ReadonlySet<string>
    /** Focused row stays listed — a new session is neither running nor unread. */
    focused?: boolean
  }
): boolean {
  if (ctx.focused) return true
  if (!conversationMatchesObject(conversation, sessionObjectOf(filter))) return false
  switch (filter.kind) {
    case 'none':
      return true
    case 'active':
      return ctx.running || ctx.unread
    case 'favorite':
      return ctx.favoriteIds.has(conversation.id)
    case 'workspace':
      return sameWorkdir(conversation.workingDirectory, filter.path)
  }
}

/** Live turn, window activity, or a busy PTY counts as running. */
export function isSessionRunning(opts: {
  isRunning?: boolean
  activity?: string
  shellBusy?: boolean
}): boolean {
  return !!opts.isRunning || opts.activity === 'running' || !!opts.shellBusy
}

/**
 * Unread is idle-after-done or a sticky resultUnseen badge. Awaiting a tool
 * is not unread; awaiting also excludes "running" for the unread check.
 */
export function isSessionUnread(opts: {
  awaitingToolCallId?: string | null
  isRunning?: boolean
  activity?: string
  resultUnseen?: boolean
}): boolean {
  const awaiting = !!opts.awaitingToolCallId
  const running = !!opts.isRunning && !awaiting
  return (
    (!awaiting && !running && (opts.activity === 'done' || opts.activity === 'failed')) ||
    opts.resultUnseen === true
  )
}

/** Sidebar LED: pending (ask / permission) yellow, unseen finish green / red. */
export function sessionUnreadBadge(
  awaiting: boolean,
  running: boolean,
  activity: string | undefined
): 'awaiting' | 'done' | 'failed' | null {
  if (awaiting || activity === 'pending') return 'awaiting'
  if (running) return null
  if (activity === 'done' || activity === 'failed') return activity
  return null
}
