import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { encodeGrokSessionDir } from './hostSessionStore.ts'
import { applyMissingHostUsage, readGrokSessionUsage } from './hostSessionUsage.ts'
import type { Conversation } from '../../shared/types.ts'

describe('readGrokSessionUsage', () => {
  it('reads turn_completed rows from updates.jsonl', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-grok-usage-'))
    const cwd = '/Users/oboo/repo/hold/vav'
    const id = 'sess-usage-1'
    const dir = join(home, '.grok', 'sessions', encodeGrokSessionDir(cwd), id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'updates.jsonl'),
      [
        JSON.stringify({
          timestamp: 1_786_511_238,
          method: '_x.ai/session/update',
          params: {
            update: {
              sessionUpdate: 'turn_completed',
              usage: {
                inputTokens: 16073,
                outputTokens: 247,
                cachedReadTokens: 11264,
                costUsdTicks: 144_792_000
              }
            }
          }
        }),
        JSON.stringify({
          timestamp: 1_786_511_300,
          method: 'session/update',
          params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: 'hi' } } }
        }),
        JSON.stringify({
          timestamp: 1_786_511_400,
          method: '_x.ai/session/update',
          params: {
            update: {
              sessionUpdate: 'turn_completed',
              usage: {
                inputTokens: 16338,
                outputTokens: 633,
                cachedReadTokens: 16000,
                costUsdTicks: 92_740_000
              }
            }
          }
        })
      ].join('\n')
    )
    const usage = readGrokSessionUsage(id, cwd, { home, modelId: 'grok-4.5' })
    assert.ok(usage)
    assert.equal(usage.history.length, 2)
    assert.equal(usage.history[0]?.newInputTokens, 4809)
    assert.equal(usage.history[0]?.cacheReadTokens, 11264)
    assert.equal(usage.history[1]?.newInputTokens, 338)
    assert.equal(usage.tokensUsed, usage.history[1]?.totalInputTokens)
    assert.ok(usage.reportedSessionCostUsd != null)
    assert.ok(usage.reportedSessionCostUsd! > 0)
  })
})

describe('applyMissingHostUsage', () => {
  it('fills an empty Grok conversation and skips one that already has history', () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-grok-hydrate-'))
    const cwd = '/tmp/proj'
    const id = 'sess-2'
    const dir = join(home, '.grok', 'sessions', encodeGrokSessionDir(cwd), id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'updates.jsonl'),
      JSON.stringify({
        timestamp: 100,
        method: '_x.ai/session/update',
        params: {
          update: {
            sessionUpdate: 'turn_completed',
            usage: { inputTokens: 80, outputTokens: 10, cachedReadTokens: 20 }
          }
        }
      })
    )
    const conversation = {
      cliHost: 'grok',
      workingDirectory: cwd,
      model: 'grok-4.5',
      tokenHistory: [],
      tokensUsed: 0,
      cliResumeCursor: { provider: 'grok', sessionId: id },
      hostTranscripts: {}
    } as Conversation
    assert.equal(applyMissingHostUsage(conversation, { home }), true)
    assert.equal(conversation.tokenHistory.length, 1)
    assert.equal(conversation.tokensUsed, 80)
    assert.equal(applyMissingHostUsage(conversation, { home }), false)
  })
})
