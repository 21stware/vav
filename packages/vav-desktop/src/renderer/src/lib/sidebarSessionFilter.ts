import type { ConversationMeta } from '@shared/types'

export type SidebarSessionFilter =
  | { kind: 'none' }
  | { kind: 'active' }
  | { kind: 'favorite' }
  | { kind: 'workspace'; path: string }

export const SIDEBAR_FILTER_NONE = 'none'
export const SIDEBAR_FILTER_ACTIVE = 'active'
export const SIDEBAR_FILTER_FAVORITE = 'favorite'
const WORKSPACE_PREFIX = 'ws:'

export function encodeSidebarSessionFilter(filter: SidebarSessionFilter): string {
  if (filter.kind === 'workspace') return `${WORKSPACE_PREFIX}${filter.path}`
  return filter.kind
}

export function parseSidebarSessionFilter(raw: string | undefined | null): SidebarSessionFilter {
  if (!raw || raw === SIDEBAR_FILTER_NONE) return { kind: 'none' }
  if (raw === SIDEBAR_FILTER_ACTIVE) return { kind: 'active' }
  if (raw === SIDEBAR_FILTER_FAVORITE) return { kind: 'favorite' }
  if (raw.startsWith(WORKSPACE_PREFIX)) {
    const path = raw.slice(WORKSPACE_PREFIX.length)
    if (path) return { kind: 'workspace', path }
  }
  return { kind: 'none' }
}

export function isSidebarSessionFilterEnabled(filter: SidebarSessionFilter): boolean {
  return filter.kind !== 'none'
}

function sameWorkdir(left: string | null | undefined, right: string): boolean {
  if (!left) return false
  const a = left.replace(/[\\/]+$/, '')
  const b = right.replace(/[\\/]+$/, '')
  return a === b
}

export function conversationMatchesFilter(
  conversation: ConversationMeta,
  filter: SidebarSessionFilter,
  ctx: {
    running: boolean
    unread: boolean
    favoriteIds: ReadonlySet<string>
  }
): boolean {
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
  return (!awaiting && !running && opts.activity === 'done') || opts.resultUnseen === true
}
