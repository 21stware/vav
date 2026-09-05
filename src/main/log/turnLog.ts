import { LOG_EVENT } from '@shared/appLog'
import type { TurnEvent } from '@shared/types'
import { appLog, type AppLogger } from './appLogger'

const turnStarted = new Map<string, number>()

function hostOf(conversation?: { cliHost?: string | null; model?: string } | null): string {
  return conversation?.cliHost?.trim() || 'vav'
}

/**
 * Project a TurnEvent into the diagnostic log.
 * Skips token deltas / file drafts / mirrors — those flood without adding a
 * debug story. Phase / tool / start / end / errors are the useful spine.
 */
export function logTurnEvent(
  event: TurnEvent,
  conversation?: { model?: string; cliHost?: string | null } | null,
  logger: AppLogger = appLog()
): void {
  const conversationId = event.conversationId
  if (event.type === 'start') {
    turnStarted.set(conversationId, Date.now())
    logger.agent(LOG_EVENT.agentTurnStart, 'Turn started', {
      conversationId,
      data: { model: conversation?.model || '', host: hostOf(conversation) }
    })
    return
  }
  if (event.type === 'phase') {
    logger.agent(LOG_EVENT.agentTurnPhase, event.phase, {
      conversationId,
      level: 'debug',
      data: { phase: event.phase }
    })
    return
  }
  if (event.type === 'tool') {
    logger.agent(LOG_EVENT.agentTool, `${event.block.tool} ${event.block.status}`, {
      conversationId,
      data: {
        tool: event.block.tool,
        status: event.block.status,
        summary: event.block.summary,
        id: event.block.id
      }
    })
    return
  }
  if (event.type === 'awaiting') {
    logger.agent(LOG_EVENT.agentAwaiting, event.block.tool, {
      conversationId,
      data: { tool: event.block.tool, toolCallId: event.toolCallId }
    })
    return
  }
  if (event.type === 'usage') {
    logger.agent(LOG_EVENT.agentUsage, 'Usage sample', {
      conversationId,
      level: 'debug',
      data: { tokensUsed: event.tokensUsed, tokenLimit: event.tokenLimit }
    })
    return
  }
  if (event.type === 'cli-session') {
    logger.agent(LOG_EVENT.agentCliSession, 'CLI session', {
      conversationId,
      level: 'debug',
      data: { modes: event.state.modes?.length ?? 0 }
    })
    return
  }
  if (event.type === 'end') {
    const started = turnStarted.get(conversationId)
    turnStarted.delete(conversationId)
    const durationMs = started != null ? Date.now() - started : undefined
    const failed = Boolean(event.error)
    const cancelled = Boolean(event.cancelled)
    logger.agent(LOG_EVENT.agentTurnEnd, cancelled ? 'Cancelled' : failed ? 'Failed' : 'Done', {
      conversationId,
      level: failed ? 'error' : 'info',
      data: {
        cancelled,
        error: event.error,
        errorKind: event.errorKind,
        durationMs,
        host: hostOf(conversation),
        model: conversation?.model || ''
      }
    })
  }
}
