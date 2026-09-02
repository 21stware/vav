import type { MessageBlock } from '../../shared/types.ts'
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
