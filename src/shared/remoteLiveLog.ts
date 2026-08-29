/**
 * Slot-ordered live assistant log for the phone — same index model as
 * desktop StreamProjection. Thinking and text are siblings, not two buckets.
 */
import type { RemoteThreadBlock } from './remoteControl.ts'

export const REMOTE_LIVE_TEXT_CAP = 8000

export function applyLiveDelta(
  slots: Map<number, RemoteThreadBlock>,
  index: number,
  kind: 'text' | 'reasoning',
  chunk: string
): void {
  if (!chunk) return
  const cur = slots.get(index)
  if (cur && cur.kind === kind && typeof cur.text === 'string') {
    slots.set(index, { kind, text: `${cur.text}${chunk}`.slice(0, REMOTE_LIVE_TEXT_CAP) })
    return
  }
  slots.set(index, { kind, text: chunk.slice(0, REMOTE_LIVE_TEXT_CAP) })
}

export function compactLiveBlocks(slots: Map<number, RemoteThreadBlock>): RemoteThreadBlock[] {
  return [...slots.keys()]
    .sort((a, b) => a - b)
    .map((index) => slots.get(index)!)
    .filter(isVisibleLiveBlock)
}

export function isVisibleLiveBlock(block: RemoteThreadBlock): boolean {
  if (block.kind === 'plan') return false
  if (block.kind === 'tool' && block.tool === 'plan') return false
  if (block.kind === 'text' || block.kind === 'reasoning') return Boolean(block.text?.trim())
  return true
}

export function draftFromLiveBlocks(blocks: RemoteThreadBlock[]): { text: string; thinking: string } {
  let text = ''
  let thinking = ''
  for (const block of blocks) {
    if (block.kind === 'text' && block.text) text += (text ? '\n\n' : '') + block.text
    if (block.kind === 'reasoning' && block.text) thinking += (thinking ? '\n\n' : '') + block.text
  }
  return {
    text: text.slice(0, REMOTE_LIVE_TEXT_CAP),
    thinking: thinking.slice(0, REMOTE_LIVE_TEXT_CAP)
  }
}
