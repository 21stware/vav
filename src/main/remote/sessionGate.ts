import {
  enabledCliAgents,
  type AgentConfig,
  type CliHostKind,
  type ModelOption,
  type ThinkingLevel
} from '../../shared/types.ts'
import { isStructuredCliHost } from '../../shared/cliHost.ts'
import {
  agentModelHostKey,
  filterEnabledModels,
  labelForChatModel,
  modelsForChatHost
} from '../../shared/agentModels.ts'
import { collapseCursorListModels } from '../../shared/cursorModel.ts'
import { vendorIdFromEndpoint } from '../../shared/llmVendors.ts'
import { agentLabel } from '../../shared/remoteSessionControls.ts'
import { REMOTE_PHONE_CAPABILITIES, type RemoteHostEvent } from '../../shared/remoteControl.ts'

/** Phone host sheet: only bypass/edit are explicit; everything else is auto. */
export function remoteDefaultApproval(
  mode: string | null | undefined
): 'auto' | 'bypass' | 'edit' {
  return mode === 'bypass' || mode === 'edit' ? mode : 'auto'
}

/** Phone companion: live sessions can be mutated; archived / missing cannot. */
export function remoteLiveConversation(
  conversation: { archived?: boolean } | null | undefined
): 'ok' | 'not-found' | 'archived' {
  if (!conversation) return 'not-found'
  if (conversation.archived) return 'archived'
  return 'ok'
}

/** Pinned then recent folders, existing only, capped for the phone host sheet. */
export function remoteHostRecentDirs(
  pinned: string[],
  recents: string[],
  opts: {
    exists: (path: string) => boolean
    label: (path: string) => string
    cap?: number
  }
): { path: string; label: string }[] {
  const cap = opts.cap ?? 12
  const seen = new Set<string>()
  const recentDirs: { path: string; label: string }[] = []
  for (const path of [...pinned, ...recents]) {
    if (!path || seen.has(path) || !opts.exists(path)) continue
    seen.add(path)
    recentDirs.push({ path, label: opts.label(path) })
    if (recentDirs.length >= cap) break
  }
  return recentDirs
}

/** Structured CLI rows for the phone host-controls sheet. */
export function remoteControlAgentRows(
  cliAgents: AgentConfig[] | null | undefined
): { id: string; label: string }[] {
  return enabledCliAgents(cliAgents)
    .filter((agent) => isStructuredCliHost(agent.id))
    .map((agent) => ({
      id: agent.id,
      label: agent.name?.trim() || agentLabel(agent.id)
    }))
}

/** Enabled catalogue rows for the phone model picker. */
export function remoteCatalogModelRows(opts: {
  host: CliHostKind | null
  accountId?: string | null
  apiEndpoint: string
  customModels: string[]
  defaultModel?: string | null
  disabledAgentModels?: Record<string, string[]> | null
  snapshot: Record<string, { models?: ModelOption[] } | undefined>
}): { id: string; label: string }[] {
  const vendorId = opts.host == null ? vendorIdFromEndpoint(opts.apiEndpoint) : null
  const key = agentModelHostKey(opts.host, vendorId, opts.accountId)
  const snap = opts.snapshot[key]
  const raw =
    snap?.models?.length
      ? snap.models
      : modelsForChatHost(opts.host, opts.customModels, opts.defaultModel)
  const listed = opts.host === 'cursor' ? collapseCursorListModels(raw) : raw
  return filterEnabledModels(
    opts.host,
    listed,
    opts.disabledAgentModels,
    vendorId,
    opts.accountId
  ).map((model) => ({
    id: model.id,
    label: labelForChatModel(opts.host, model.id, opts.customModels, listed)
  }))
}

/** Phone send: missing/archived stay errors; a live busy turn queues. */
export function remoteSendDisposition(
  conversation: { archived?: boolean } | null | undefined,
  busy: boolean
): 'not-found' | 'archived' | 'enqueue' | 'send' {
  const live = remoteLiveConversation(conversation)
  if (live !== 'ok') return live
  return busy ? 'enqueue' : 'send'
}

/** Host switch is locked once the thread has messages. */
export function remoteHostSwitchAction(
  prevHost: string | null,
  nextHost: string | null,
  hasMessages: boolean
): 'same' | 'locked' | 'switch' {
  if (prevHost === nextHost) return 'same'
  if (hasMessages) return 'locked'
  return 'switch'
}

/** Cursor catalogue advertised thinking default for the current model id. */
export function cursorCatalogueDefaultThinking(
  snapshot: Record<string, { models?: ModelOption[] } | undefined>,
  model: string | null | undefined,
  host: string | null | undefined
): ThinkingLevel | null {
  if (host !== 'cursor' || !model) return null
  return (
    (snapshot[agentModelHostKey('cursor')]?.models ?? []).find((entry) => entry.id === model)
      ?.defaultThinkingLevel ?? null
  )
}

/** Phone host snapshot: identity, defaults, and recent folders. */
export function buildRemoteHostEvent(input: {
  name: string
  home: string
  tmp: string
  platform: string
  defaultAgent: string
  defaultModel: string
  thinking: string | null
  approval: 'auto' | 'bypass' | 'edit'
  recentDirs: { path: string; label: string }[]
}): RemoteHostEvent {
  return {
    type: 'host',
    name: input.name,
    home: input.home,
    tmp: input.tmp,
    platform: input.platform,
    capabilities: REMOTE_PHONE_CAPABILITIES,
    defaults: {
      agent: input.defaultAgent,
      model: input.defaultModel,
      thinking: input.thinking,
      approval: input.approval
    },
    recentDirs: input.recentDirs
  }
}
