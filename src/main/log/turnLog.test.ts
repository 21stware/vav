import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOG_EVENT } from '../../shared/appLog.ts'
import type { TurnEvent } from '../../shared/types.ts'
import type { AppLogInput, AppLogRecord } from '../../shared/appLog.ts'
import { createAppLogger, type AppLogger } from './appLogger.ts'
import { logTurnEvent } from './turnLog.ts'

function captureLogger(): { logger: AppLogger; rows: AppLogInput[] } {
  const rows: AppLogInput[] = []
  const logger: AppLogger = {
    write(input) {
      rows.push(input)
      return { id: 'x', ts: 1, ...input, level: input.level ?? 'info', retention: 'session' } as AppLogRecord
    },
    user: () => null,
    agent(event, message, extra) {
      const input: AppLogInput = {
        channel: 'agent',
        event,
        message,
        level: extra?.level,
        retention: extra?.retention,
        conversationId: extra?.conversationId,
        data: extra?.data
      }
      rows.push(input)
      return null
    },
    system: () => null
  }
  return { logger, rows }
}

describe('logTurnEvent', () => {
  it('records start, tool, awaiting, and a failed end with duration — not deltas', () => {
    const { logger, rows } = captureLogger()
    const conv = { model: 'deepseek-v4-flash', cliHost: null }
    logTurnEvent({ type: 'start', conversationId: 'c1' } satisfies TurnEvent, conv, logger)
    logTurnEvent(
      {
        type: 'delta',
        conversationId: 'c1',
        index: 0,
        kind: 'text',
        text: 'hello'
      },
      conv,
      logger
    )
    logTurnEvent(
      {
        type: 'tool',
        conversationId: 'c1',
        index: 1,
        block: {
          kind: 'toolCall',
          id: 't1',
          tool: 'fs_read',
          summary: 'src/app.ts',
          input: '{}',
          output: '',
          status: 'done'
        }
      },
      conv,
      logger
    )
    logTurnEvent(
      {
        type: 'end',
        conversationId: 'c1',
        message: { id: 'm', role: 'assistant', content: '', createdAt: 1, parentId: null, blocks: [] },
        tokensUsed: 10,
        error: 'quota',
        errorKind: 'quota'
      },
      conv,
      logger
    )
    assert.equal(
      rows.some((row) => row.event === LOG_EVENT.agentTurnStart),
      true
    )
    assert.equal(
      rows.some((row) => row.event === LOG_EVENT.agentTool && row.message === 'fs_read done'),
      true
    )
    const end = rows.find((row) => row.event === LOG_EVENT.agentTurnEnd)
    assert.equal(end?.level, 'error')
    assert.equal(end?.data?.errorKind, 'quota')
    assert.equal(typeof end?.data?.durationMs, 'number')
    assert.equal(
      rows.some((row) => row.event === 'delta' || row.message === 'hello'),
      false
    )
  })
})

describe('createAppLogger', () => {
  it('is a type-level helper — store append is the sink', () => {
    const appended: AppLogInput[] = []
    const logger = createAppLogger({
      append: (input: AppLogInput) => {
        appended.push(input)
        return null
      }
    } as never)
    logger.user(LOG_EVENT.userSend, 'Send', { conversationId: 'c1', data: { chars: 3 } })
    assert.equal(appended[0]?.channel, 'user')
    assert.equal(appended[0]?.event, LOG_EVENT.userSend)
  })
})
