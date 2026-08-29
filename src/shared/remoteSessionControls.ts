/**
 * Phone snapshot of the composer run controls (agent / model / thinking /
 * session mode / permission). Pure so the wire payload stays unit-testable.
 */
import { acpCurrentModeId, acpSessionModes, type AcpSessionState } from './acpSession.ts'
import {
  displayNameForCliHost,
  isStructuredCliHost,
  type CliHostKind
} from './cliHost.ts'
import {
  clampThinkingLevel,
  parseThinkingLevel,
  sessionShowsFast,
  sessionShowsThinking,
  thinkingLevelsForSession
} from './thinkingLevel.ts'
import type { ApprovalMode, ThinkingLevel } from './types.ts'
import type { RemoteControlsEvent } from './remoteControl.ts'

const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  max: '最高'
}

const APPROVAL_OPTIONS: { id: ApprovalMode; label: string }[] = [
  { id: 'auto', label: 'Normal' },
  { id: 'bypass', label: 'Bypass' },
  { id: 'edit', label: 'Read' }
]

export function agentLabel(id: string): string {
  if (!id || id === 'vav') return 'VAV'
  return isStructuredCliHost(id) ? displayNameForCliHost(id) : id
}

export function buildRemoteControls(input: {
  conversationId: string
  cliHost?: string | null
  model?: string | null
  thinkingLevel?: string | null
  approvalMode?: string | null
  fast?: boolean
  acpSession?: AcpSessionState | null
  hasMessages: boolean
  agents: { id: string; label: string }[]
  models: { id: string; label: string }[]
  catalogueDefaultThinking?: ThinkingLevel | null
  workingDirectory?: string | null
  dirLabel?: string
  temporary?: boolean
}): RemoteControlsEvent {
  const host = isStructuredCliHost(input.cliHost) ? input.cliHost : null
  const agent = host ?? 'vav'
  const model = input.model ?? ''
  const showThinking = sessionShowsThinking(host, model)
  const allowed = showThinking
    ? thinkingLevelsForSession({
        cliHost: host,
        modelId: model,
        acpThinkingLevels: input.acpSession?.thinkingLevels,
        catalogueDefault: input.catalogueDefaultThinking ?? null
      })
    : []
  const thinking = showThinking
    ? clampThinkingLevel(parseThinkingLevel(input.thinkingLevel), allowed)
    : null
  const modes = host ? acpSessionModes(input.acpSession) : []
  const modeId = host ? acpCurrentModeId(input.acpSession) : null
  const approval: ApprovalMode =
    input.approvalMode === 'bypass' || input.approvalMode === 'edit' ? input.approvalMode : 'auto'
  const showFast = sessionShowsFast(host)

  return {
    type: 'controls',
    conversationId: input.conversationId,
    agentLocked: input.hasMessages,
    agent,
    agents: [{ id: 'vav', label: 'VAV' }, ...input.agents],
    model,
    models: input.models,
    thinking,
    thinkingLevels: allowed.map((id) => ({ id, label: THINKING_LABEL[id] })),
    mode: modeId,
    modes: modes.map((mode) => ({ id: mode.id, label: mode.name })),
    approval,
    approvals: APPROVAL_OPTIONS,
    fast: showFast ? input.fast === true : null,
    workingDirectory: input.workingDirectory ?? '',
    dirLabel: input.dirLabel ?? '',
    temporary: input.temporary === true
  }
}

export function parseApprovalMode(value: unknown): ApprovalMode | null {
  return value === 'auto' || value === 'bypass' || value === 'edit' ? value : null
}

export function parseAgentId(value: unknown): CliHostKind | 'vav' | null {
  if (value === 'vav' || value === '') return 'vav'
  if (typeof value === 'string' && isStructuredCliHost(value)) return value
  return null
}
