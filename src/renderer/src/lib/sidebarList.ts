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
