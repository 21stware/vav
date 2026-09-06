import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_LOG_RETENTION_DAYS,
  EPHEMERAL_TTL_MS,
  LOG_EVENT,
  MAX_LOG_MESSAGE_CHARS,
  MAX_LOG_RECORDS,
  SESSION_TTL_MS,
  clampLogRetentionDays,
  defaultRetentionFor,
  formatLogLine,
  isLogExpired,
  logStatsOf,
  parseLogRecord,
  pruneLogRecords,
  queryLogRecords,
  redactLogData,
  sanitizeLogInput,
  ttlMsFor,
  type AppLogRecord
} from './appLog.ts'

function rec(partial: Partial<AppLogRecord> & Pick<AppLogRecord, 'id' | 'retention'>): AppLogRecord {
  return {
    ts: 1_000,
    channel: 'agent',
    level: 'info',
    event: 'agent.tool',
    message: 'ok',
    ...partial
  }
}

describe('appLog retention', () => {
  it('classifies user actions as durable, nav as ephemeral, agent tools as session', () => {
    assert.equal(defaultRetentionFor('user', 'info', LOG_EVENT.userSend), 'durable')
    assert.equal(defaultRetentionFor('user', 'info', LOG_EVENT.userSettingsNav), 'ephemeral')
    assert.equal(defaultRetentionFor('agent', 'info', LOG_EVENT.agentTool), 'session')
    assert.equal(defaultRetentionFor('agent', 'debug', LOG_EVENT.agentTurnPhase), 'ephemeral')
    assert.equal(defaultRetentionFor('agent', 'error', LOG_EVENT.agentTurnEnd), 'durable')
    assert.equal(defaultRetentionFor('system', 'info', LOG_EVENT.systemBoot), 'durable')
  })

  it('clamps retention days to the allowed set', () => {
    assert.equal(clampLogRetentionDays(7), 7)
    assert.equal(clampLogRetentionDays(2), DEFAULT_LOG_RETENTION_DAYS)
    assert.equal(clampLogRetentionDays('14'), 14)
    assert.equal(clampLogRetentionDays(null), DEFAULT_LOG_RETENTION_DAYS)
  })

  it('expires ephemeral, session, and durable on their own clocks', () => {
    const now = 10_000_000
    assert.equal(
      isLogExpired({ ts: now - EPHEMERAL_TTL_MS - 1, retention: 'ephemeral' }, now, 7),
      true
    )
    assert.equal(isLogExpired({ ts: now - 1_000, retention: 'ephemeral' }, now, 7), false)
    assert.equal(
      isLogExpired({ ts: now - SESSION_TTL_MS - 1, retention: 'session' }, now, 7),
      true
    )
    const day = 24 * 60 * 60_000
    assert.equal(isLogExpired({ ts: now - 8 * day, retention: 'durable' }, now, 7), true)
    assert.equal(isLogExpired({ ts: now - 6 * day, retention: 'durable' }, now, 7), false)
    assert.equal(ttlMsFor('durable', 1), day)
  })

  it('drops expired rows then oldest overflow per class', () => {
    const now = 50_000
    const records: AppLogRecord[] = [
      rec({ id: 'old-eph', retention: 'ephemeral', ts: now - EPHEMERAL_TTL_MS - 1 }),
      rec({ id: 'live-eph', retention: 'ephemeral', ts: now - 10 }),
      rec({ id: 's1', retention: 'session', ts: 1 }),
      rec({ id: 's2', retention: 'session', ts: 2 }),
      rec({ id: 's3', retention: 'session', ts: 3 })
    ]
    const pruned = pruneLogRecords(records, now, 7, {
      ephemeral: 2_000,
      session: 2,
      durable: 20_000
    })
    const ids = pruned.map((row) => row.id).sort()
    assert.deepEqual(ids, ['live-eph', 's2', 's3'])
  })
})

describe('appLog redaction', () => {
  it('strips secrets and truncates long strings', () => {
    const data = redactLogData({
      apiKey: 'sk-secret',
      token: 'abc',
      pairing: 'vav-daemon://x',
      path: '/tmp/workspace/file.ts',
      nested: { password: 'hunter2', ok: true }
    })
    assert.equal(data?.apiKey, '[redacted]')
    assert.equal(data?.token, '[redacted]')
    assert.equal(data?.pairing, '[redacted]')
    assert.equal(data?.path, '/tmp/workspace/file.ts')
    assert.equal((data?.nested as { password: string; ok: boolean }).password, '[redacted]')
    assert.equal((data?.nested as { ok: boolean }).ok, true)
  })

  it('redacts bearer-looking string values even under innocent keys', () => {
    const data = redactLogData({ note: 'sk-ant-12345', heading: 'hello' })
    assert.equal(data?.note, '[redacted]')
    assert.equal(data?.heading, 'hello')
  })

  it('drops non-objects and sanitizes a record', () => {
    assert.equal(redactLogData(null), undefined)
    assert.equal(sanitizeLogInput({ channel: 'user', event: '', message: 'x' }, 1, 'id'), null)
    const row = sanitizeLogInput(
      {
        channel: 'user',
        event: LOG_EVENT.userSend,
        message: 'x'.repeat(MAX_LOG_MESSAGE_CHARS + 40),
        conversationId: 'c1',
        data: { apiKey: 'nope', chars: 12 }
      },
      42,
      'r1'
    )
    assert.equal(row?.id, 'r1')
    assert.equal(row?.ts, 42)
    assert.equal(row?.retention, 'durable')
    assert.equal(row?.message.endsWith('…'), true)
    assert.equal(row?.message.length, MAX_LOG_MESSAGE_CHARS)
    assert.equal(row?.data?.apiKey, '[redacted]')
    assert.equal(row?.data?.chars, 12)
  })
})

describe('appLog query', () => {
  const rows: AppLogRecord[] = [
    rec({
      id: 'a',
      ts: 3,
      channel: 'user',
      event: 'user.send',
      message: 'Send',
      conversationId: 'c1',
      retention: 'durable'
    }),
    rec({
      id: 'b',
      ts: 2,
      channel: 'agent',
      event: 'agent.tool',
      message: 'fs_read done',
      conversationId: 'c1',
      retention: 'session'
    }),
    rec({
      id: 'c',
      ts: 1,
      channel: 'system',
      level: 'error',
      event: 'system.uncaught',
      message: 'boom',
      retention: 'durable'
    })
  ]

  it('filters, searches, and returns newest first', () => {
    const user = queryLogRecords(rows, { channel: 'user' })
    assert.equal(user.length, 1)
    assert.equal(user[0]?.id, 'a')
    const search = queryLogRecords(rows, { search: 'fs_read' })
    assert.equal(search[0]?.id, 'b')
    const conv = queryLogRecords(rows, { conversationId: 'c1' })
    assert.equal(conv.length, 2)
    assert.deepEqual(
      queryLogRecords(rows, { limit: 2 }).map((row) => row.id),
      ['a', 'b']
    )
  })

  it('formats a line and parses it back from JSON', () => {
    const line = formatLogLine(rows[0]!)
    assert.match(line, /user\/info/)
    assert.match(line, /user.send/)
    const parsed = parseLogRecord(rows[2])
    assert.equal(parsed?.event, 'system.uncaught')
    assert.equal(parseLogRecord({ id: 'x' }), null)
    assert.deepEqual(logStatsOf(rows), { ephemeral: 0, session: 1, durable: 2, total: 3 })
  })
})
