/**
 * Project control-plane frames onto the desktop workbench.
 *
 * iOS applies the same frames with `applyRemoteServerMessage`. The desktop
 * remote window is isomorphic — it must not wait on a racing catalog pull
 * to show the user turn or to leave the running state.
 */

import type { ChatMessage, MessageBlock, PlanBlock, ToolCallBlock, ToolName, TurnEvent, TurnStatus } from './types.ts'
import { TOOL_LABELS } from './types.ts'
import type { RemoteThreadBlock, RemoteThreadMessage, RemoteTurnEvent } from './remoteControl.ts'

const TOOL_NAMES = new Set<string>(Object.keys(TOOL_LABELS))

export function asRemoteToolName(tool: string): ToolName {
  return TOOL_NAMES.has(tool) ? (tool as ToolName) : 'external'
}

export function remoteBlockToMessageBlock(block: RemoteThreadBlock): MessageBlock {
  switch (block.kind) {
    case 'text':
      return { kind: 'text', text: block.text }
    case 'reasoning':
      return { kind: 'reasoning', text: block.text }
    case 'plan':
      return remotePlanToBlock(block)
    case 'awaiting':
      return {
        kind: 'toolCall',
        id: block.id,
        tool: asRemoteToolName(block.tool),
        summary: block.title || block.prompt || block.tool,
        input: '',
        output: '',
        status: 'pending',
        choices: block.choices.map((choice) => choice.label),
        ...(block.multiSelect ? { multiSelect: true } : {}),
        ...(block.prompt
          ? { questions: [{ question: block.prompt, choices: block.choices.map((c) => c.label) }] }
          : {}),
        ...(block.title ? { askTitle: block.title } : {})
      }
    case 'tool':
      return {
        kind: 'toolCall',
        id: block.id,
        tool: asRemoteToolName(block.tool),
        summary: block.summary || block.tool,
        input: '',
        output: '',
        status: parseToolStatus(block.status)
      }
  }
}

function remotePlanToBlock(block: Extract<RemoteThreadBlock, { kind: 'plan' }>): PlanBlock {
  return {
    kind: 'plan',
    title: block.title || 'Plan',
    steps: block.steps.map((step, index) => ({
      id: `step-${index}`,
      title: step.text,
      status: step.done ? 'done' : 'pending'
    }))
  }
}

function parseToolStatus(status: string): ToolCallBlock['status'] {
  if (
    status === 'pending' ||
    status === 'executing' ||
    status === 'completed' ||
    status === 'error' ||
    status === 'skipped' ||
    status === 'expired'
  ) {
    return status
  }
  return status === 'done' ? 'completed' : 'executing'
}

export function chatMessageFromRemoteThread(
  row: RemoteThreadMessage,
  parentId: string | null
): ChatMessage {
  const blocks = (row.blocks ?? []).map(remoteBlockToMessageBlock)
  if (!blocks.length && row.text) blocks.push({ kind: 'text', text: row.text })
  return {
    id: row.id,
    parentId,
    role: row.role,
    content: row.text,
    blocks,
    createdAt: row.at || Date.now(),
    ...(row.cancelled ? { cancelled: true } : {}),
    ...(row.error ? { errorText: row.error } : {})
  }
}

/**
 * Fold a host thread path into the local tree. Unknown ids append; known ids
 * keep richer local fields (changeSetId) while picking up new text/blocks.
 */
export function mergeRemoteThreadMessages(
  existing: ChatMessage[],
  thread: RemoteThreadMessage[]
): { messages: ChatMessage[]; added: ChatMessage[]; leafId: string | null } {
  const byId = new Map(existing.map((message) => [message.id, message]))
  const order = existing.map((message) => message.id)
  const added: ChatMessage[] = []
  let prevId: string | null = null

  for (const row of thread) {
    const current = byId.get(row.id)
    const parentId = current?.parentId ?? prevId
    const next = chatMessageFromRemoteThread(row, parentId)
    if (current) {
      byId.set(row.id, {
        ...current,
        ...next,
        parentId: current.parentId ?? next.parentId,
        changeSetId: current.changeSetId ?? next.changeSetId
      })
    } else {
      byId.set(row.id, next)
      order.push(row.id)
      added.push(next)
    }
    prevId = row.id
  }

  const leafId = thread.length ? thread[thread.length - 1]!.id : null
  return {
    messages: order.map((id) => byId.get(id)!),
    added,
    leafId
  }
}

/**
 * Catalog adopt must not wipe a live thread apply that raced ahead of
 * `sessions.get`. Incoming adds new ids; local wins on collision.
 */
export function mergeAdoptedHostMessages(
  incoming: ChatMessage[],
  existing: ChatMessage[]
): ChatMessage[] {
  if (!existing.length) return incoming
  if (!incoming.length) return existing
  const byId = new Map<string, ChatMessage>()
  const order: string[] = []
  for (const message of incoming) {
    byId.set(message.id, message)
    order.push(message.id)
  }
  for (const message of existing) {
    if (!byId.has(message.id)) order.push(message.id)
    const incomingMessage = byId.get(message.id)
    byId.set(
      message.id,
      incomingMessage
        ? {
            ...incomingMessage,
            ...message,
            changeSetId: message.changeSetId ?? incomingMessage.changeSetId
          }
        : message
    )
  }
  return order.map((id) => byId.get(id)!)
}

export function turnEventsFromRemoteThread(
  conversationId: string,
  thread: RemoteThreadMessage[],
  existing: ChatMessage[]
): { events: TurnEvent[]; messages: ChatMessage[]; added: ChatMessage[]; leafId: string | null } {
  const merged = mergeRemoteThreadMessages(existing, thread)
  const events: TurnEvent[] = []
  const existingIds = new Set(existing.map((message) => message.id))

  for (const message of merged.messages) {
    if (message.role !== 'user') continue
    if (!existingIds.has(message.id) || !existing.some((row) => row.id === message.id && row.content === message.content)) {
      events.push({ type: 'user', conversationId, message })
    }
  }

  const last = [...thread].reverse().find((row) => row.role !== 'system')
  if (last?.role === 'assistant' && !existingIds.has(last.id)) {
    const assistant = merged.messages.find((message) => message.id === last.id)
    if (assistant) {
      events.push(endEvent(conversationId, assistant, last.cancelled === true, last.error))
    }
  }

  return { ...merged, events }
}

export function turnEventsFromRemoteTurn(
  conversationId: string,
  turn: RemoteTurnEvent,
  started: boolean
): { events: TurnEvent[]; started: boolean } {
  if (turn.phase === 'running' || turn.phase === 'awaiting') {
    const events: TurnEvent[] = []
    if (!started) events.push({ type: 'start', conversationId })
    if (turn.phase === 'awaiting') {
      events.push({ type: 'phase', conversationId, phase: 'awaiting-user' })
    }
    if (turn.blocks?.length) {
      turn.blocks.forEach((block, index) => {
        events.push(...liveBlockEvents(conversationId, index, block))
      })
    } else {
      if (turn.thinking !== undefined) {
        events.push({
          type: 'delta',
          conversationId,
          index: 0,
          kind: 'reasoning',
          text: turn.thinking,
          replace: true
        })
      }
      if (turn.draft !== undefined) {
        events.push({
          type: 'delta',
          conversationId,
          index: turn.thinking !== undefined ? 1 : 0,
          kind: 'text',
          text: turn.draft,
          replace: true
        })
      }
    }
    if (turn.awaiting) {
      const block = remoteBlockToMessageBlock(turn.awaiting)
      if (block.kind === 'toolCall') {
        events.push({
          type: 'awaiting',
          conversationId,
          toolCallId: turn.awaiting.id,
          index: turn.blocks?.length ?? 0,
          block
        })
      }
    }
    return { events, started: true }
  }

  if (turn.phase === 'done' || turn.phase === 'error' || turn.phase === 'cancelled') {
    return {
      events: [
        endEvent(
          conversationId,
          {
            id: `remote-end-${conversationId}`,
            parentId: null,
            role: 'assistant',
            content: '',
            blocks: [],
            createdAt: Date.now(),
            ...(turn.phase === 'cancelled' ? { cancelled: true } : {}),
            ...(turn.error ? { errorText: turn.error } : {})
          },
          turn.phase === 'cancelled',
          turn.error
        )
      ],
      started: false
    }
  }

  return { events: [], started }
}

function liveBlockEvents(conversationId: string, index: number, block: RemoteThreadBlock): TurnEvent[] {
  if (block.kind === 'text' || block.kind === 'reasoning') {
    return [
      {
        type: 'delta',
        conversationId,
        index,
        kind: block.kind === 'reasoning' ? 'reasoning' : 'text',
        text: block.text,
        replace: true
      }
    ]
  }
  const mapped = remoteBlockToMessageBlock(block)
  if (mapped.kind === 'plan') {
    return [{ type: 'plan', conversationId, index, block: mapped }]
  }
  if (mapped.kind === 'toolCall' && mapped.status === 'pending' && (mapped.tool === 'ask_user_question' || mapped.tool === 'request' || mapped.choices?.length)) {
    return [
      {
        type: 'awaiting',
        conversationId,
        toolCallId: mapped.id,
        index,
        block: mapped
      }
    ]
  }
  if (mapped.kind === 'toolCall') {
    return [{ type: 'tool', conversationId, index, block: mapped }]
  }
  return []
}

function endEvent(
  conversationId: string,
  message: ChatMessage,
  cancelled: boolean,
  error?: string
): Extract<TurnEvent, { type: 'end' }> {
  return {
    type: 'end',
    conversationId,
    message,
    tokensUsed: 0,
    cancelled,
    ...(error ? { error, errorKind: cancelled ? 'cancelled' : 'generic' } : {})
  }
}

export function remoteControlTurnStatus(input: {
  conversationId: string
  generating: boolean
  awaitingId?: string | null
  liveBlocks?: RemoteThreadBlock[]
}): TurnStatus {
  const blocks = (input.liveBlocks ?? []).map(remoteBlockToMessageBlock)
  return {
    conversationId: input.conversationId,
    isRunning: input.generating,
    phase: input.awaitingId ? 'awaiting-user' : input.generating ? 'outputting' : 'idle',
    toolCount: blocks.filter((block) => block.kind === 'toolCall').length,
    awaitingToolCallId: input.awaitingId ?? null,
    messageId: null,
    blocks: input.generating ? blocks : []
  }
}
