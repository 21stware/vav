import { PRESET_MODELS, type ConversationMeta, type SidebarGroupingMode } from '../../../shared/types.ts'
import type { MessageKey, TParams } from '../../../shared/i18n/index.ts'
import type { SidebarSessionFilter } from './sidebarSessionFilter.ts'
import { basename } from './path.ts'

type Translate = (key: MessageKey, params?: TParams) => string

export function modelLabel(id: string): string {
  return PRESET_MODELS.find((model) => model.id === id)?.label ?? id
}

/** Running CLI agent display name (sidebar-conversation-list.rpml · Agent 类型). */
export function agentTypeLabel(
  conversation: ConversationMeta,
  cliAgents: Array<{ id: string; name: string }>
): string | null {
  const id = conversation.cliHost || conversation.agentBinaryName
  if (!id || id === 'vav') return null
  return cliAgents.find((a) => a.id === id)?.name ?? id
}

export function groupingOptions(t: Translate): { value: SidebarGroupingMode; label: string }[] {
  return [
    { value: 'none', label: t('sidebar.group.none') },
    { value: 'workspace', label: t('sidebar.group.workspace') },
    { value: 'provider', label: t('sidebar.group.provider') }
  ]
}

export function filterValueLabel(filter: SidebarSessionFilter, t: Translate): string {
  switch (filter.kind) {
    case 'none':
      return t('sidebar.filter.none')
    case 'active':
      return t('sidebar.filter.active')
    case 'favorite':
      return t('sidebar.filter.favorite')
    case 'workspace':
      return basename(filter.path)
  }
}

export type ConversationSubtitle =
  | { kind: 'status'; text: string }
  | { kind: 'meta'; age: string; dir: string | null }
  | null

export type SidebarTurnSnippet = {
  awaitingToolCallId?: string | null
  isRunning?: boolean
  toolCount?: number
}

/** Subtitle slot from sidebar-conversation-list.rpml (running / idle / empty). */
export function conversationSubtitle(opts: {
  conversation: Pick<
    ConversationMeta,
    'model' | 'updatedAt' | 'createdAt' | 'tokensUsed' | 'workingDirectory'
  >
  turn: SidebarTurnSnippet | undefined
  isActive: boolean
  tmp: string
  t: Translate
  agentLabel: string | null
  hideWorkdir?: boolean
  relativeTime: (timestamp: number) => string
  isTemporaryWorkspace: (path: string | null, tmp: string) => boolean
  workdirShortLabel: (path: string | null, tmp: string) => string
}): ConversationSubtitle {
  const { conversation, turn, isActive, tmp, t, agentLabel } = opts
  if (turn?.awaitingToolCallId) return { kind: 'status', text: t('sidebar.awaitingAnswer') }
  if (turn?.isRunning && isActive) {
    const core = t('sidebar.streaming', { model: modelLabel(conversation.model) })
    return { kind: 'status', text: agentLabel ? `${agentLabel} · ${core}` : core }
  }
  if (turn?.isRunning) {
    const core = t('sidebar.backgroundRunning', { count: turn.toolCount ?? 0 })
    return { kind: 'status', text: agentLabel ? `${agentLabel} · ${core}` : core }
  }
  if (conversation.updatedAt === conversation.createdAt && conversation.tokensUsed === 0) {
    return null
  }
  const dir =
    !opts.hideWorkdir && !opts.isTemporaryWorkspace(conversation.workingDirectory ?? null, tmp)
      ? opts.workdirShortLabel(conversation.workingDirectory ?? null, tmp)
      : null
  return { kind: 'meta', age: opts.relativeTime(conversation.updatedAt), dir }
}

const TITLE_LEAD = /^[#\s\u00a0\u3000]+/

/** Strip markdown hashes / leading whitespace from auto-titles. */
export function flattenSessionTitle(title: string, fallback = 'New session'): string {
  return title.replace(TITLE_LEAD, '').trim() || title.trim() || fallback
}

export type SelectionRunClass = 'run-only' | 'run-start' | 'run-middle' | 'run-end'

/** Adjacent multi-select row chrome (start / middle / end / only). */
export function adjacentRunClass(prev: boolean, next: boolean): SelectionRunClass {
  if (!prev && !next) return 'run-only'
  if (!prev && next) return 'run-start'
  if (prev && next) return 'run-middle'
  return 'run-end'
}

/** Conversation list: no chrome for a single selected row. */
export function conversationSelectionRunClass(
  id: string,
  selectedIds: string[],
  orderedIds: string[]
): string {
  if (selectedIds.length <= 1 || !selectedIds.includes(id)) return ''
  const selected = new Set(selectedIds)
  const index = orderedIds.indexOf(id)
  if (index < 0) return 'run-only'
  const prev = index > 0 && selected.has(orderedIds[index - 1]!)
  const next = index < orderedIds.length - 1 && selected.has(orderedIds[index + 1]!)
  return adjacentRunClass(prev, next)
}

export function hostMachineLabel(
  machineId: string,
  hosts: Array<{ id: string; name?: string | null }>,
  localId: string,
  thisMachine: string,
  fallback?: string
): string {
  if (machineId === localId) return thisMachine
  return hosts.find((h) => h.id === machineId)?.name?.trim() || fallback || machineId
}

export function incomingConnectLabels(
  clients: Array<{ device?: string | null }> | undefined,
  format: (name: string) => string
): string[] {
  const labels: string[] = []
  for (const client of clients ?? []) {
    if (client.device) labels.push(format(client.device))
  }
  return labels
}

/** Durable project path that can be pinned; temp / synthetic groups cannot. */
export function pinnableWorkspaceDir(opts: {
  groupKind: string | undefined
  workspaceSelectable?: boolean
  groupWorkdir: string | null | undefined
  tmp: string
  isTemporaryWorkspace: (path: string | null, tmp: string) => boolean
}): string | null {
  const dir = opts.groupWorkdir ?? null
  if (
    opts.groupKind !== 'workspace' ||
    opts.workspaceSelectable === false ||
    !dir ||
    dir.startsWith('__') ||
    opts.isTemporaryWorkspace(dir, opts.tmp)
  ) {
    return null
  }
  return dir
}

/** After archiving the active row, pick the visible neighbor above, else below. */
export function nextVisibleSelectionAfterArchive(
  visibleIds: string[],
  activeId: string | null | undefined,
  leavingIds: string[]
): string | null {
  if (!activeId || !leavingIds.includes(activeId)) return null
  const leaving = new Set(leavingIds)
  const index = visibleIds.indexOf(activeId)
  if (index < 0) return null
  for (let i = index - 1; i >= 0; i -= 1) {
    const id = visibleIds[i]!
    if (!leaving.has(id)) return id
  }
  for (let i = index + 1; i < visibleIds.length; i += 1) {
    const id = visibleIds[i]!
    if (!leaving.has(id)) return id
  }
  return null
}
