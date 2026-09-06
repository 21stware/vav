import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { threadPath } from '../../shared/thread.ts'
import { TIMER_OUTPUT_FILE } from '../../shared/timer.ts'
import type { ChatMessage } from '../../shared/types.ts'

export function lastAssistantText(messages: ChatMessage[], activeLeafId: string | null): string {
  const path = threadPath(messages, activeLeafId)
  for (let i = path.length - 1; i >= 0; i--) {
    const message = path[i]!
    if (message.role !== 'assistant') continue
    const parts: string[] = []
    for (const block of message.blocks ?? []) {
      if (block.kind === 'text' && block.text.trim()) parts.push(block.text.trim())
    }
    if (parts.length) return parts.join('\n\n')
  }
  return ''
}

/** Prefer an agent-written OUTPUT.md; otherwise persist the last assistant reply. */
export function ensureTimerOutput(
  workdir: string,
  messages: ChatMessage[],
  activeLeafId: string | null
): string | null {
  const path = join(workdir, TIMER_OUTPUT_FILE)
  if (existsSync(path)) return path
  const text = lastAssistantText(messages, activeLeafId)
  if (!text) return null
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
  return path
}
