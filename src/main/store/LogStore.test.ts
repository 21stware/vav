import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EPHEMERAL_TTL_MS, LOG_EVENT, SESSION_TTL_MS } from '../../shared/appLog.ts'
import { LogStore } from './LogStore.ts'

describe('LogStore', () => {
  it('keeps ephemeral in memory and persists session + durable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-logs-'))
    let now = 1_000
    let n = 0
    const store = new LogStore({
      dir,
      now: () => now,
      id: () => `id-${++n}`,
      durableDays: () => 7
    })
    store.append({
      channel: 'agent',
      event: LOG_EVENT.agentTurnPhase,
      message: 'working',
      conversationId: 'c1'
    })
    store.append({
      channel: 'agent',
      event: LOG_EVENT.agentTool,
      message: 'fs_read',
      conversationId: 'c1'
    })
    store.append({
      channel: 'user',
      event: LOG_EVENT.userSend,
      message: 'Send',
      conversationId: 'c1',
      data: { chars: 4, apiKey: 'sk-hidden' }
    })
    store.dispose()

    const sessionFile = readFileSync(join(dir, 'session.jsonl'), 'utf8')
    const durableFile = readFileSync(join(dir, 'durable.jsonl'), 'utf8')
    assert.equal(sessionFile.includes('agent.tool'), true)
    assert.equal(sessionFile.includes('agent.turn.phase'), false)
    assert.equal(durableFile.includes('user.send'), true)
    assert.equal(durableFile.includes('sk-hidden'), false)
    assert.equal(durableFile.includes('[redacted]'), true)

    const reloaded = new LogStore({ dir, now: () => now, id: () => 'x' })
    reloaded.load()
    assert.equal(reloaded.stats().ephemeral, 0)
    assert.equal(reloaded.stats().session, 1)
    assert.equal(reloaded.stats().durable, 1)
    assert.equal(reloaded.query({ channel: 'user' })[0]?.data?.chars, 4)
  })

  it('expires by class, removes session rows with the conversation, keeps durable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-logs-'))
    let now = 10_000
    let n = 0
    const store = new LogStore({
      dir,
      now: () => now,
      id: () => `id-${++n}`,
      durableDays: () => 7
    })
    store.append({
      channel: 'agent',
      event: LOG_EVENT.agentTool,
      message: 'tool',
      conversationId: 'gone'
    })
    store.append({
      channel: 'user',
      event: LOG_EVENT.userSend,
      message: 'Send',
      conversationId: 'gone'
    })
    store.append({
      channel: 'agent',
      event: LOG_EVENT.agentTurnPhase,
      message: 'working',
      conversationId: 'gone'
    })
    assert.equal(store.removeForConversation('gone'), 2)
    assert.equal(store.stats().session, 0)
    assert.equal(store.stats().durable, 1)
    assert.equal(store.stats().ephemeral, 0)

    store.append({ channel: 'agent', event: LOG_EVENT.agentTurnPhase, message: 'later' })
    now += EPHEMERAL_TTL_MS + 1
    assert.equal(store.stats().ephemeral, 0)

    store.append({
      channel: 'agent',
      event: LOG_EVENT.agentTool,
      message: 'old-session',
      conversationId: 'keep'
    })
    now += SESSION_TTL_MS + 1
    assert.equal(store.query({ conversationId: 'keep' }).length, 0)

    assert.equal(store.clear('durable'), 1)
    assert.equal(store.stats().total, 0)
    store.dispose()
  })
})
