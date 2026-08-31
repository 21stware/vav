/**
 * When a structured CLI host must spawn a fresh native session (workspace
 * switch, login change, a session lost to an error, or a retry/edit that
 * must not keep the replaced turn), VAV still has the transcript — this
 * turns that path into a preamble so the next prompt keeps the conversation.
 */
import type { ChatMessage, LeafCompaction } from '@shared/types'
import { compactionBoundaryIndex, compactionForLeaf } from '../../shared/compaction.ts'
import { threadPath } from '../../shared/thread.ts'
import { pathToSummarySource } from './history.ts'

const HANDOFF_MAX_CHARS = 48_000

export type CliHistoryHandoffReason = 'cwd-changed' | 'session-lost' | 'retry'

export type CliHistoryHandoffMark = {
  previousCwd: string | null
  reason?: CliHistoryHandoffReason
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
  /** Why the native session was replaced. Defaults to `cwd-changed`. */
  reason?: CliHistoryHandoffReason
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

  if (opts.reason === 'retry') {
    return [
      'This is a new attempt at the same point in the conversation. Here is the conversation so far — the previous attempt is not included:',
      source,
      "End of prior conversation. Answer the user's next message as a fresh attempt, not as a follow-up."
    ].join('\n\n')
  }
  if (opts.reason === 'session-lost') {
    return [
      formatCwdNotice(opts.previousCwd, opts.nextCwd),
      'The previous host session was lost (it could not be resumed after an error or restart) and this is a fresh session. Here is the conversation so far:',
      source,
      "End of prior conversation. Continue from here as the same assistant. The user's next message follows."
    ].join('\n\n')
  }
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
