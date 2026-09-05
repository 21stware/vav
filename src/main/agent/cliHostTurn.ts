import type { MessageBlock, TurnRecovery, TurnStatus } from '../../shared/types.ts'
import { en, isApprovalDenyText, zhCN } from '../../shared/i18n/index.ts'
import { parseToolInput } from '../../shared/askPlan.ts'

export type TurnContentBlock = {
  kind: string
  text?: string
  status?: string
}

export function turnHasAnswerContent(blocks: TurnContentBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.kind === 'toolCall' ||
      block.kind === 'plan' ||
      (block.kind === 'text' && (block.text ?? '').trim().length > 0)
  )
}

export function turnHasIncompleteWork(blocks: TurnContentBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.kind === 'toolCall' &&
      (block.status === 'pending' || block.status === 'executing')
  )
}

/**
 * Normal send: assistant is a child of the user message.
 * Regenerate / retry: keep the existing parent and mint a new assistant id.
 */
export function cliTurnParentId(
  messageId: string,
  currentParentId: string | null,
  messages: Array<{ id: string; role: string }>
): string | null {
  if (messages.some((message) => message.id === messageId && message.role === 'user')) {
    return messageId
  }
  return currentParentId
}

export function findChecklistIndex(blocks: MessageBlock[]): number | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block?.kind === 'toolCall' && block.tool === 'plan') return i
  }
  return null
}

export function extractUrlFromInput(block: MessageBlock | undefined): string | null {
  if (!block || block.kind !== 'toolCall') return null
  const parsed = parseToolInput(block.input)
  return typeof parsed.url === 'string' && parsed.url.trim() ? parsed.url.trim() : null
}

export function isPlanDocRejectText(text: string): boolean {
  const line = text.split('\n')[0]?.trim() ?? ''
  return (
    isApprovalDenyText(text) ||
    line === zhCN['planDoc.reject'] ||
    line === en['planDoc.reject'] ||
    line === zhCN['common.cancel'] ||
    line === en['common.cancel']
  )
}

export function isAskCancelText(text: string): boolean {
  const line = text.split('\n')[0]?.trim() ?? ''
  return (
    isApprovalDenyText(text) ||
    line === zhCN['common.cancel'] ||
    line === en['common.cancel'] ||
    line === '已取消'
  )
}

/** Idle / in-flight TurnStatus for a late-joining window (sparse blocks stay). */
export function cliHostTurnStatus(
  conversationId: string,
  turn:
    | {
        phase: TurnStatus['phase']
        toolCount: number
        pendingPermissions: { values(): IterableIterator<{ toolCallId: string }> }
        messageId: string | null
        blocks: MessageBlock[]
        recovery?: TurnRecovery | null
      }
    | undefined
): TurnStatus {
  const awaiting = turn
    ? ([...turn.pendingPermissions.values()][0]?.toolCallId ?? null)
    : null
  return {
    conversationId,
    isRunning: !!turn,
    phase: turn?.phase ?? 'idle',
    toolCount: turn?.toolCount ?? 0,
    awaitingToolCallId: awaiting,
    messageId: turn?.messageId ?? null,
    blocks: turn ? turn.blocks.map((b) => ({ ...b })) : [],
    recovery: turn?.recovery ?? null
  }
}
