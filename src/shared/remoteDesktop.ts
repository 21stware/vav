/**
 * Map the phone-protocol snapshot onto desktop Conversation / ChatMessage /
 * TurnEvent shapes so web, the Chrome extension, and iOS stay views of the
 * same session model the renderer already paints.
 */
import type { AcpSessionState } from './acpSession.ts'
import { isStructuredCliHost, type CliHostKind } from './cliHost.ts'
import type {
  RemoteControlsEvent,
  RemoteHostEvent,
  RemoteSession,
  RemoteThreadBlock,
  RemoteThreadMessage,
  RemoteTurnEvent
} from './remoteControl.ts'
import type {
  ApprovalMode,
  ChatMessage,
  Conversation,
  ConversationMeta,
  MessageBlock,
  PlanBlock,
  ThinkingLevel,
  ToolCallBlock,
  ToolCallStatus,
  ToolName,
  TurnEvent
} from './types.ts'
import { TOOL_LABELS } from './types.ts'

const TOOL_NAMES = new Set<string>(Object.keys(TOOL_LABELS))

export function asToolName(tool: string): ToolName {
  return TOOL_NAMES.has(tool) ? (tool as ToolName) : 'external'
}

export function asApprovalMode(value: unknown): ApprovalMode {
  return value === 'bypass' || value === 'edit' ? value : 'auto'
}

export function asThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return value === 'off' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'max'
    ? value
    : undefined
}

export function asToolStatus(value: unknown): ToolCallStatus {
  return value === 'executing' ||
    value === 'completed' ||
    value === 'error' ||
    value === 'skipped' ||
    value === 'expired' ||
    value === 'pending'
    ? value
    : 'completed'
}

export function cliHostFromAgent(agent: string | null | undefined): CliHostKind | null {
  if (!agent || agent === 'vav') return null
  return isStructuredCliHost(agent) ? agent : null
}

export function acpSessionFromControls(controls?: RemoteControlsEvent | null): AcpSessionState | null {
  if (!controls?.modes?.length && !controls?.commands?.length) return null
  return {
    currentModeId: controls.mode ?? controls.modes[0]?.id ?? null,
    modes: (controls.modes ?? []).map((mode) => ({ id: mode.id, name: mode.label })),
    commands: (controls.commands ?? []).map((command) => ({
      name: command.id,
      description: command.label
    })),
    thinkingLevels: (controls.thinkingLevels ?? [])
      .map((row) => asThinkingLevel(row.id))
      .filter((level): level is ThinkingLevel => Boolean(level))
  }
}

/** Sentinel ConversationStore used to fill a missing model id. */
export const UNKNOWN_REMOTE_MODEL = 'unknown'

/**
 * Control-plane `sessions` rows have title/pin/workdir only. Adopting one as a
 * full Conversation would wipe model / cliHost (DeepSeek + `unknown`).
 */
export function isSparseRemoteConversation(source: {
  model?: string | null
  messages?: readonly unknown[] | null
  tokensUsed?: number | null
  tokenLimit?: number | null
}): boolean {
  const model = (source.model ?? '').trim()
  return (
    (!model || model === UNKNOWN_REMOTE_MODEL) &&
    (!source.messages || source.messages.length === 0) &&
    !source.tokensUsed &&
    !source.tokenLimit
  )
}

/** List chrome the `sessions` snapshot is allowed to write on an existing row. */
export function conversationListPatchFromRemoteSession(
  session: RemoteSession
): Partial<ConversationMeta> {
  const patch: Partial<ConversationMeta> = {
    pinned: session.pinned === true,
    pinTime: session.pinned ? (session.pinTime ?? session.updatedAt ?? Date.now()) : null
  }
  if (session.title) patch.title = session.title
  if (typeof session.workdir === 'string') patch.workingDirectory = session.workdir || null
  return patch
}

/** Host/model fields from a `controls` frame. Missing controls must not invent defaults. */
export function conversationPatchFromRemoteControls(
  controls: RemoteControlsEvent,
  existing?: Pick<ConversationMeta, 'model' | 'cliHost' | 'agentBinaryName'> | null
): Partial<ConversationMeta> {
  const cliHost = cliHostFromAgent(controls.agent)
  const thinking = asThinkingLevel(controls.thinking)
  const acpSession = acpSessionFromControls(controls)
  return {
    model: controls.model || existing?.model,
    approvalMode: asApprovalMode(controls.approval),
    ...(thinking ? { thinkingLevel: thinking } : {}),
    ...(typeof controls.fast === 'boolean' ? { fast: controls.fast } : {}),
    cliHost: cliHost ?? existing?.cliHost ?? null,
    agentBinaryName: cliHost ?? existing?.agentBinaryName ?? null,
    ...(acpSession ? { acpSession } : {})
  }
}

export type DesktopRemoteSessionDecision =
  | { kind: 'skip' }
  | { kind: 'patch'; patch: Partial<ConversationMeta> }
  | { kind: 'adopt'; meta: ConversationMeta }

/**
 * Chrome remaps `sessions` + `controls` every time. Desktop persists rows, so a
 * list-only snapshot must patch chrome — never replace model/host.
 */
export function desktopRemoteSessionApply(
  session: RemoteSession,
  opts: {
    existing?: Pick<ConversationMeta, 'model' | 'cliHost' | 'agentBinaryName'> | null
    existingIsLocal?: boolean
    adoptAsLocal?: boolean
    controls?: RemoteControlsEvent | null
    host?: RemoteHostEvent | null
  }
): DesktopRemoteSessionDecision {
  if (opts.existing && opts.existingIsLocal && !opts.adoptAsLocal) return { kind: 'skip' }
  if (opts.existing) {
    // List chrome only. Model/host arrive on `controls`; mixing a stale snapshot
    // here is what snapped the picker back to DeepSeek + `unknown`.
    return { kind: 'patch', patch: conversationListPatchFromRemoteSession(session) }
  }
  return {
    kind: 'adopt',
    meta: conversationFromRemoteSession(session, opts.controls, opts.host)
  }
}

export function conversationFromRemoteSession(
  session: RemoteSession,
  controls?: RemoteControlsEvent | null,
  host?: RemoteHostEvent | null
): ConversationMeta {
  const agent = controls?.agent ?? host?.defaults.agent ?? 'vav'
  const model = controls?.model || host?.defaults.model || ''
  const updatedAt = session.updatedAt || Date.now()
  return {
    id: session.id,
    title: session.title || 'New session',
    createdAt: updatedAt,
    updatedAt,
    workingDirectory: session.workdir || null,
    machineId: 'local',
    model,
    tokensUsed: 0,
    tokenLimit: 0,
    pinned: session.pinned === true,
    pinTime: session.pinned ? (session.pinTime ?? updatedAt) : null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: asApprovalMode(controls?.approval ?? host?.defaults.approval),
    thinkingLevel: asThinkingLevel(controls?.thinking ?? host?.defaults.thinking),
    fast: controls?.fast === true,
    cliHost: cliHostFromAgent(agent),
    agentBinaryName: cliHostFromAgent(agent),
    acpSession: acpSessionFromControls(controls)
  }
}

export function favoriteIdsFromRemoteSessions(sessions: RemoteSession[]): string[] {
  return sessions.filter((session) => session.favorite).map((session) => session.id)
}

export function messageBlocksFromRemote(blocks?: RemoteThreadBlock[]): MessageBlock[] {
  if (!blocks?.length) return []
  const out: MessageBlock[] = []
  for (const block of blocks) {
    const mapped = messageBlockFromRemote(block)
    if (mapped) out.push(mapped)
  }
  return out
}

export function messageBlockFromRemote(block: RemoteThreadBlock): MessageBlock | null {
  if (block.kind === 'text') {
    const text = block.text.replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
    return text ? { kind: 'text', text } : null
  }
  if (block.kind === 'reasoning') {
    const text = block.text.trim()
    return text ? { kind: 'reasoning', text } : null
  }
  if (block.kind === 'plan') {
    return planBlockFromRemote(block)
  }
  if (block.kind === 'tool' || block.kind === 'awaiting') {
    return toolBlockFromRemote(block)
  }
  return null
}

export function planBlockFromRemote(block: Extract<RemoteThreadBlock, { kind: 'plan' }>): PlanBlock {
  return {
    kind: 'plan',
    title: block.title || 'Plan',
    steps: (block.steps ?? []).map((step, index) => ({
      id: `step-${index}`,
      title: step.text,
      status: step.done ? 'done' : 'pending'
    }))
  }
}

export function toolBlockFromRemote(
  block: Extract<RemoteThreadBlock, { kind: 'tool' | 'awaiting' }>
): ToolCallBlock {
  if (block.kind === 'awaiting') {
    const choices = (block.choices ?? []).map((choice) => choice.label || choice.id)
    return {
      kind: 'toolCall',
      id: block.id,
      tool: asToolName(block.tool),
      summary: block.title || block.prompt || block.tool,
      input: '{}',
      output: '',
      status: 'pending',
      askTitle: block.title,
      multiSelect: block.multiSelect === true,
      choices,
      questions: [
        {
          question: block.prompt || block.title,
          choices,
          multiSelect: block.multiSelect === true
        }
      ]
    }
  }
  return {
    kind: 'toolCall',
    id: block.id,
    tool: asToolName(block.tool),
    summary: block.summary || block.tool,
    input: '{}',
    output: '',
    status: asToolStatus(block.status)
  }
}

export function chatMessagesFromRemoteThread(messages: RemoteThreadMessage[]): ChatMessage[] {
  const rows: ChatMessage[] = []
  let parentId: string | null = null
  for (const message of messages) {
    if (message.role === 'system') continue
    const blocks = messageBlocksFromRemote(message.blocks)
    const content = message.text || blocks.map((block) => ('text' in block ? block.text : '')).join('\n\n')
    if (!content && !blocks.length) continue
    const row: ChatMessage = {
      id: message.id,
      parentId,
      role: message.role,
      content,
      blocks: blocks.length ? blocks : content ? [{ kind: 'text', text: content }] : [],
      createdAt: message.at || Date.now(),
      ...(message.cancelled ? { cancelled: true } : {}),
      ...(message.error ? { errorText: message.error } : {}),
      ...(message.changeSetId ? { changeSetId: message.changeSetId } : {})
    }
    rows.push(row)
    parentId = message.id
  }
  return rows
}

export function conversationFromRemoteThread(
  meta: ConversationMeta,
  messages: RemoteThreadMessage[]
): Conversation {
  const path = chatMessagesFromRemoteThread(messages)
  return {
    ...meta,
    messages: path,
    activeLeafId: path.at(-1)?.id ?? null,
    tokenHistory: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null
  }
}

export function turnEventsFromRemoteTurn(event: RemoteTurnEvent): TurnEvent[] {
  const id = event.conversationId
  if (event.phase === 'running') {
    const events: TurnEvent[] = [{ type: 'start', conversationId: id }]
    if (event.recovery) {
      events.push({
        type: 'phase',
        conversationId: id,
        phase: event.recovery.kind,
        recovery: event.recovery
      })
    }
    const blocks = event.blocks ?? []
    blocks.forEach((block, index) => {
      if (block.kind === 'text') {
        events.push({ type: 'delta', conversationId: id, index, kind: 'text', text: block.text, replace: true })
      } else if (block.kind === 'reasoning') {
        events.push({
          type: 'delta',
          conversationId: id,
          index,
          kind: 'reasoning',
          text: block.text,
          replace: true
        })
      } else if (block.kind === 'plan') {
        events.push({ type: 'plan', conversationId: id, index, block: planBlockFromRemote(block) })
      } else if (block.kind === 'tool') {
        events.push({ type: 'tool', conversationId: id, index, block: toolBlockFromRemote(block) })
      } else if (block.kind === 'awaiting') {
        const tool = toolBlockFromRemote(block)
        events.push({
          type: 'awaiting',
          conversationId: id,
          toolCallId: block.id,
          index,
          block: tool
        })
      }
    })
    if (!blocks.length && event.thinking) {
      events.push({
        type: 'delta',
        conversationId: id,
        index: 0,
        kind: 'reasoning',
        text: event.thinking,
        replace: true
      })
    }
    if (!blocks.length && event.draft) {
      events.push({
        type: 'delta',
        conversationId: id,
        index: event.thinking ? 1 : 0,
        kind: 'text',
        text: event.draft,
        replace: true
      })
    }
    if (event.awaiting && !blocks.some((block) => 'id' in block && block.id === event.awaiting?.id)) {
      const tool = toolBlockFromRemote(event.awaiting)
      events.push({
        type: 'awaiting',
        conversationId: id,
        toolCallId: event.awaiting.id,
        index: Math.max(blocks.length, 1),
        block: tool
      })
    }
    return events
  }
  if (event.phase === 'awaiting' && event.awaiting) {
    const tool = toolBlockFromRemote(event.awaiting)
    return [
      {
        type: 'awaiting',
        conversationId: id,
        toolCallId: event.awaiting.id,
        index: 0,
        block: tool
      }
    ]
  }
  if (event.phase === 'done' || event.phase === 'error' || event.phase === 'cancelled') {
    const text = event.draft || ''
    return [
      {
        type: 'end',
        conversationId: id,
        message: {
          id: `live-end-${id}`,
          parentId: null,
          role: 'assistant',
          content: text,
          blocks: text ? [{ kind: 'text', text }] : [],
          createdAt: Date.now(),
          ...(event.phase === 'cancelled' ? { cancelled: true } : {}),
          ...(event.error ? { errorText: event.error } : {})
        },
        tokensUsed: 0,
        ...(event.error ? { error: event.error, errorKind: 'generic' as const } : {}),
        ...(event.phase === 'cancelled' ? { cancelled: true } : {})
      }
    ]
  }
  return []
}

export function userTurnEvent(conversationId: string, text: string): TurnEvent {
  const id = `local-user-${Date.now()}`
  return {
    type: 'user',
    conversationId,
    message: {
      id,
      parentId: null,
      role: 'user',
      content: text,
      blocks: text ? [{ kind: 'text', text }] : [],
      createdAt: Date.now()
    }
  }
}
