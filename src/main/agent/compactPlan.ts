import { threadPath } from '../../shared/thread.ts'
import { COMPACT_MIN_FOLDED, defaultKeepAfterIndex } from '../../shared/compaction.ts'
import type { ChatMessage } from '../../shared/types.ts'

export type CompactPlanErrors = {
  busy: string
  missing: string
  cliHost: string
  empty: string
  notEnough: string
}

export type CompactClearErrors = Pick<CompactPlanErrors, 'busy' | 'missing' | 'cliHost'>

export type CompactPlan =
  | { ok: false; error: string }
  | {
      ok: true
      leafId: string
      keepAfterMessageId: string
      toFold: ChatMessage[]
      kept: ChatMessage[]
    }

export function compactClearGate(opts: {
  isRunning: boolean
  conversation: { cliHost?: string | null } | null | undefined
  errors: CompactClearErrors
}): { ok: true } | { ok: false; error: string } {
  if (opts.isRunning) return { ok: false, error: opts.errors.busy }
  if (!opts.conversation) return { ok: false, error: opts.errors.missing }
  if (opts.conversation.cliHost) return { ok: false, error: opts.errors.cliHost }
  return { ok: true }
}

export function planConversationCompact(opts: {
  isRunning: boolean
  conversation:
    | {
        cliHost?: string | null
        messages: ChatMessage[]
        activeLeafId?: string | null
      }
    | null
    | undefined
  keepAfterMessageId?: string | null
  errors: CompactPlanErrors
}): CompactPlan {
  const gate = compactClearGate(opts)
  if (!gate.ok) return gate
  const conversation = opts.conversation!
  const leafId =
    conversation.activeLeafId ?? threadPath(conversation.messages, null).at(-1)?.id
  if (!leafId) return { ok: false, error: opts.errors.empty }

  const path = threadPath(conversation.messages, leafId)
  let keepIdx: number | null = null
  if (opts.keepAfterMessageId) {
    keepIdx = path.findIndex((m) => m.id === opts.keepAfterMessageId)
    if (keepIdx < COMPACT_MIN_FOLDED) {
      return { ok: false, error: opts.errors.notEnough }
    }
  } else {
    keepIdx = defaultKeepAfterIndex(path.length)
    if (keepIdx == null) return { ok: false, error: opts.errors.notEnough }
  }

  const keepAfterMessageId = path[keepIdx]!.id
  const toFold = path.slice(0, keepIdx)
  if (toFold.length < COMPACT_MIN_FOLDED) {
    return { ok: false, error: opts.errors.notEnough }
  }
  return {
    ok: true,
    leafId,
    keepAfterMessageId,
    toFold,
    kept: path.slice(keepIdx)
  }
}
