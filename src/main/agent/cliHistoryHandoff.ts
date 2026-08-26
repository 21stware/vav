/**
 * After a workspace switch, structured CLI hosts spawn a fresh session in the
 * new cwd (resume cursors are bound to the old tree). VAV still has the
 * transcript — this turns that path into a preamble so the next prompt keeps
 * the conversation.
 */
import type { ChatMessage, LeafCompaction } from '@shared/types'
import { compactionBoundaryIndex, compactionForLeaf } from '../../shared/compaction.ts'
import { threadPath } from '../../shared/thread.ts'
import { pathToSummarySource } from './history.ts'

const HANDOFF_MAX_CHARS = 48_000

export type CliHistoryHandoffMark = {
  previousCwd: string | null
}

export function formatCliWorkspaceHandoff(opts: {
  messages: ChatMessage[]
  leafId: string | null
  /** Current user turn — already sent as the live prompt. */
  excludeMessageId?: string | null
  compactions?: LeafCompaction[] | null
  previousCwd?: string | null
  nextCwd: string
  maxChars?: number
}): string | null {
  const path = threadPath(opts.messages, opts.leafId)
  const prior = opts.excludeMessageId
    ? path.filter((message) => message.id !== opts.excludeMessageId)
    : path
  if (prior.length === 0) return null

  const compaction = compactionForLeaf(opts.compactions, opts.messages, opts.leafId)
  const boundary = compactionBoundaryIndex(path, compaction)
  const maxChars = opts.maxChars ?? HANDOFF_MAX_CHARS
  let source: string
  if (compaction && boundary > 0) {
    const tail = prior.filter((message) => {
      const index = path.findIndex((entry) => entry.id === message.id)
      return index >= boundary
    })
    const summary = compaction.summary.trim()
    const rest = pathToSummarySource(tail, Math.max(2_000, maxChars - summary.length - 200))
    source = [`[Conversation summary]\n${summary}`, rest].filter(Boolean).join('\n\n')
  } else {
    source = pathToSummarySource(prior, maxChars)
  }
  if (!source.trim()) return null

  return [
    formatCwdNotice(opts.previousCwd, opts.nextCwd),
    'The previous host session ended when the working directory changed. Here is the conversation so far:',
    source,
    "End of prior conversation. Continue from here in the new working directory. The user's next message follows."
  ].join('\n\n')
}

export function applyCliHistoryHandoff(prompt: string, handoff: string | null): string {
  if (!handoff?.trim()) return prompt
  return `${handoff.trim()}\n\n${prompt}`
}

function formatCwdNotice(previousCwd: string | null | undefined, nextCwd: string): string {
  const prev = previousCwd?.trim() || ''
  const next = nextCwd.trim()
  if (prev && next && prev !== next) {
    return `[Working directory changed from ${prev} to ${next}. Tools now run in the new directory.]`
  }
  if (next) return `[Working directory is now ${next}.]`
  return '[Working directory changed.]'
}
