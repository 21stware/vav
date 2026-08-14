import type { ChatMessage } from '@shared/types'

function preview(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`
}

/** One user turn is enough to show the timeline. */
export const MIN_REWIND_TURNS = 1

const PROMPT_PREVIEW = 72
const REPLY_PREVIEW = 64

export interface RewindTurn {
  id: string
  preview: string
  replyPreview: string
}

/** One rail entry per user prompt on the visible path, paired with the next reply. */
export function rewindTurnsFromMessages(messages: ChatMessage[]): RewindTurn[] {
  const turns: RewindTurn[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (message.role !== 'user') continue
    const next = messages[i + 1]
    const reply = next?.role === 'assistant' ? next.content : ''
    turns.push({
      id: message.id,
      preview: preview(message.content, PROMPT_PREVIEW),
      replyPreview: preview(reply, REPLY_PREVIEW)
    })
  }
  return turns
}

export function shouldShowRewind(turns: RewindTurn[]): boolean {
  return turns.length >= MIN_REWIND_TURNS
}

/**
 * The turn whose prompt sits at or above the reading line.
 * `turns` must be in document order with measured (or estimated) tops.
 */
export function pickRewindTurnAtScroll(
  turns: Array<{ id: string; top: number }>,
  focusY: number
): string | null {
  if (turns.length === 0) return null
  let current = turns[0]!.id
  for (const turn of turns) {
    if (turn.top <= focusY) current = turn.id
    else break
  }
  return current
}
