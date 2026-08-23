import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Conversation } from '../../shared/types.ts'
import { attachQuotaNamespace } from '../../shared/quotaWindows.ts'
import { buildAnalysisSnapshot } from './buildAnalysisSnapshot.ts'

function conversation(partial: Partial<Conversation>): Conversation {
  return {
    id: 'c1',
    title: 'Test',
    createdAt: 1,
    updatedAt: 1,
    workingDirectory: null,
    model: 'sonnet',
    tokensUsed: 0,
    tokenLimit: 200_000,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    messages: [],
    activeLeafId: null,
    tokenHistory: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    ...partial
  }
}

describe('buildAnalysisSnapshot', () => {
  it('lists VAV plus configured providers and maps API key / account quota', async () => {
    const snap = await buildAnalysisSnapshot({
      conversations: [
        conversation({
          cliHost: 'claude',
          tokenHistory: [
            {
              turnIndex: 1,
              totalInputTokens: 12,
              newInputTokens: 12,
              outputTokens: 4,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              timestamp: 1,
              estimatedCost: 0.2,
              costSource: 'estimated'
            }
          ],
          quotaWindows: attachQuotaNamespace(
            [
              {
                id: 'seven_day',
                kind: 'seven_day',
                usedPercent: 18,
                resetsAt: 2_000,
                updatedAt: 10
              }
            ],
            'claude',
            'ada@example.com'
          )
        })
      ],
      cliAgents: [
        { id: 'claude', name: 'Claude Code' },
        { id: 'custom-1', name: 'Local custom' }
      ],
      apiKeyPresent: true,
      forceRefresh: false,
      refreshQuotas: async () => undefined,
      quotaWindows: (host) =>
        host === 'claude'
          ? [
              {
                id: 'five_hour',
                kind: 'five_hour',
                usedPercent: 40,
                resetsAt: 3_000,
                updatedAt: 20
              }
            ]
          : [],
      readAccount: async (host) =>
        host === 'claude'
          ? {
              signedIn: true,
              accountId: 'ada@example.com',
              plan: 'Pro',
              authKind: 'oauth'
            }
          : { signedIn: false, accountId: null, plan: null, authKind: 'unknown' },
      readApiBalance: async () => ({
        supported: true,
        balance: {
          source: 'deepseek',
          currency: 'CNY',
          total: 12.3,
          granted: 2.3,
          toppedUp: 10,
          available: true
        }
      })
    })

    assert.equal(snap.usage.agent.sessions, 1)
    assert.equal(snap.usage.api.sessions, 0)
    assert.deepEqual(
      snap.providers.map((p) => p.hostKey),
      ['vav', 'claude', 'custom-1']
    )
    const vav = snap.providers[0]!
    assert.equal(vav.kind, 'api')
    assert.equal(vav.authKind, 'api-key')
    assert.equal(vav.signedIn, true)
    assert.equal(vav.balance?.total, 12.3)
    assert.equal(vav.balance?.currency, 'CNY')
    assert.equal(vav.balanceState, 'ready')
    const claude = snap.providers[1]!
    assert.equal(claude.accountId, 'ada@example.com')
    assert.equal(claude.plan, 'Pro')
    assert.equal(claude.windows.length, 2)
    assert.equal(claude.windows.some((w) => w.kind === 'five_hour'), true)
    assert.equal(claude.windows.some((w) => w.kind === 'seven_day'), true)
    assert.equal(snap.providers[2]?.authKind, 'unknown')
  })

  it('lists every present catalogue binary, not only the settings list', async () => {
    const snap = await buildAnalysisSnapshot({
      conversations: [],
      cliAgents: [{ id: 'grok', name: 'Grok build' }],
      catalogue: [
        { id: 'claude', name: 'Claude Code' },
        { id: 'codex', name: 'Codex' },
        { id: 'grok', name: 'Grok build' }
      ],
      presentIds: ['claude', 'codex'],
      apiKeyPresent: false,
      forceRefresh: false,
      refreshQuotas: async () => undefined,
      quotaWindows: () => [],
      readAccount: async () => ({
        signedIn: false,
        accountId: null,
        plan: null,
        authKind: 'unknown'
      })
    })
    assert.deepEqual(
      snap.providers.map((p) => p.hostKey),
      ['vav', 'claude', 'codex', 'grok']
    )
  })
})
