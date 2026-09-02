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
