import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TokenSnapshot } from './types.ts'
import {
  aggregateAnalysisUsage,
  analysisHostOrNull,
  hostBucketsFromConversation,
  localAnalysisProviders,
  applyApiBalanceToSnapshot,
  orderByProviderList,
  snapshotWithFreshUsage,
  stubAnalysisProviders,
  usageKindForHost
} from './analysis.ts'

function snap(partial: Partial<TokenSnapshot> & { turnIndex: number }): TokenSnapshot {
  return {
    totalInputTokens: (partial.newInputTokens ?? 0) + (partial.cacheReadTokens ?? 0),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    newInputTokens: 0,
    outputTokens: 0,
    timestamp: 1,
    estimatedCost: 0,
    costSource: 'estimated',
    ...partial
  }
}

describe('usageKindForHost', () => {
  it('treats VAV and LLM vendors as API, everything else as an agent', () => {
    assert.equal(usageKindForHost('vav'), 'api')
    assert.equal(usageKindForHost('deepseek'), 'api')
    assert.equal(usageKindForHost('openrouter'), 'api')
    assert.equal(usageKindForHost('claude'), 'agent')
    assert.equal(usageKindForHost('custom-1'), 'agent')
  })
})

describe('orderByProviderList', () => {
  it('uses the saved order, then the tie-break for unknown ids', () => {
    const rows = [{ id: 'claude' }, { id: 'deepseek' }, { id: 'openrouter' }]
    assert.deepEqual(
      orderByProviderList(rows, (row) => row.id, ['openrouter', 'claude']).map((row) => row.id),
      ['openrouter', 'claude', 'deepseek']
    )
    assert.deepEqual(
      orderByProviderList(rows, (row) => row.id, null, (a, b) => a.id.localeCompare(b.id)).map(
        (row) => row.id
      ),
      ['claude', 'deepseek', 'openrouter']
    )
  })
})

describe('hostBucketsFromConversation', () => {
  it('includes the active host and parked transcripts, skipping the active key', () => {
    const buckets = hostBucketsFromConversation({
      cliHost: 'claude',
      tokenHistory: [snap({ turnIndex: 1, newInputTokens: 10, outputTokens: 4 })],
      reportedSessionCostUsd: 1.25,
      tokensUsed: 14,
      hostTranscripts: {
        vav: {
          tokenHistory: [snap({ turnIndex: 1, newInputTokens: 20, outputTokens: 8, estimatedCost: 0.1 })],
          reportedSessionCostUsd: null,
          tokensUsed: 28
        },
        claude: {
          tokenHistory: [snap({ turnIndex: 99, newInputTokens: 999, outputTokens: 999 })],
          reportedSessionCostUsd: 99,
          tokensUsed: 999
        }
      }
    })
    assert.deepEqual(
      buckets.map((b) => b.hostKey),
      ['claude', 'vav']
    )
    assert.equal(buckets[0]?.reportedSessionCostUsd, 1.25)
    assert.equal(buckets[1]?.kind, 'api')
  })
})

describe('aggregateAnalysisUsage', () => {
  it('unifies API and agent totals across conversations', () => {
    const usage = aggregateAnalysisUsage([
      {
        cliHost: null,
        tokenHistory: [
          snap({
            turnIndex: 1,
            newInputTokens: 100,
            outputTokens: 40,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            estimatedCost: 0.2
          })
        ],
        reportedSessionCostUsd: null,
        tokensUsed: 140
      },
      {
        cliHost: 'claude',
        tokenHistory: [snap({ turnIndex: 1, newInputTokens: 50, outputTokens: 20, estimatedCost: 0.05 })],
        reportedSessionCostUsd: 1.5,
        hostTranscripts: {
          vav: {
            tokenHistory: [snap({ turnIndex: 1, newInputTokens: 30, outputTokens: 10, estimatedCost: 0.08 })],
            reportedSessionCostUsd: null
          }
        }
      }
    ])

    assert.equal(usage.api.sessions, 2)
    assert.equal(usage.api.turns, 2)
    assert.equal(usage.api.inputTokens, 130)
    assert.equal(usage.api.outputTokens, 50)
    assert.equal(usage.api.cacheReadTokens, 10)
    assert.equal(usage.api.cacheWriteTokens, 5)
    assert.ok(usage.api.costApprox)
    assert.ok(usage.api.costUsd > 0)

    assert.equal(usage.agent.sessions, 1)
    assert.equal(usage.agent.turns, 1)
    assert.equal(usage.agent.inputTokens, 50)
    assert.equal(usage.agent.outputTokens, 20)
    assert.equal(usage.agent.costUsd, 1.5)
    assert.equal(usage.agent.costApprox, false)

    assert.equal(usage.total.sessions, 3)
    assert.equal(usage.total.turns, 3)
    assert.equal(usage.total.inputTokens, 180)
    assert.equal(usage.hosts.map((h) => h.hostKey).join(','), 'claude,vav')
  })

  it('remaps VAV usage onto a vendor and sorts by the provider list', () => {
    const usage = aggregateAnalysisUsage(
      [
        {
          cliHost: null,
          accountId: 'acc-1',
          tokenHistory: [snap({ turnIndex: 1, newInputTokens: 20, outputTokens: 8, estimatedCost: 0.1 })],
          tokensUsed: 28
        },
        {
          cliHost: 'claude',
          tokenHistory: [snap({ turnIndex: 1, newInputTokens: 10, outputTokens: 4, estimatedCost: 0.05 })],
          reportedSessionCostUsd: 0.4
        }
      ],
      {
        remapHost: (hostKey, accountId) =>
          hostKey === 'vav' && accountId === 'acc-1' ? 'deepseek' : hostKey,
        order: ['claude', 'deepseek']
      }
    )
    assert.deepEqual(
      usage.hosts.map((host) => host.hostKey),
      ['claude', 'deepseek']
    )
    assert.equal(usage.hosts[1]?.kind, 'api')
    assert.equal(usage.api.sessions, 1)
    assert.equal(usage.agent.sessions, 1)
  })

  it('uses a turn accountId when the conversation has none', () => {
    const usage = aggregateAnalysisUsage(
      [
        {
          cliHost: null,
          tokenHistory: [
            snap({ turnIndex: 1, newInputTokens: 10, outputTokens: 2, accountId: 'acc-2' })
          ]
        }
      ],
      {
        remapHost: (hostKey, accountId) =>
          hostKey === 'vav' && accountId === 'acc-2' ? 'openrouter' : hostKey
      }
    )
    assert.equal(usage.hosts[0]?.hostKey, 'openrouter')
  })

  it('ignores empty conversations and empty parked buckets', () => {
    const usage = aggregateAnalysisUsage([
      { cliHost: null, tokenHistory: [], tokensUsed: 0 },
      {
        cliHost: 'codex',
        tokenHistory: [],
        hostTranscripts: { vav: { tokenHistory: [], tokensUsed: 0 } }
      }
    ])
    assert.equal(usage.total.sessions, 0)
    assert.deepEqual(usage.hosts, [])
  })

  it('counts a session from tokensUsed when history is missing', () => {
    const usage = aggregateAnalysisUsage([{ cliHost: null, tokenHistory: [], tokensUsed: 800 }])
    assert.equal(usage.api.sessions, 1)
    assert.equal(usage.api.inputTokens, 800)
    assert.equal(usage.api.turns, 0)
  })
})

describe('snapshotWithFreshUsage', () => {
  it('keeps provider cards and replaces usage from live conversations', () => {
    const prev = {
      usage: aggregateAnalysisUsage([]),
      providers: [
        {
          hostKey: 'vav',
          hostName: 'VAV',
          kind: 'api' as const,
          signedIn: true,
          accountId: null,
          plan: null,
          authKind: 'api-key' as const,
          windows: []
        }
      ],
      now: 1
    }
    const next = snapshotWithFreshUsage(prev, [
      { cliHost: null, tokenHistory: [], tokensUsed: 40 }
    ])
    assert.equal(next.providers, prev.providers)
    assert.equal(next.usage.api.sessions, 1)
    assert.equal(next.usage.api.inputTokens, 40)
    assert.ok(next.now >= prev.now)
  })
})

describe('applyApiBalanceToSnapshot', () => {
  it('writes a DeepSeek wallet onto the VAV card', () => {
    const prev = {
      usage: aggregateAnalysisUsage([]),
      providers: stubAnalysisProviders([{ id: 'vav', name: 'VAV' }], true),
      now: 1
    }
    const next = applyApiBalanceToSnapshot(
      prev,
      {
        supported: true,
        balance: {
          source: 'deepseek',
          currency: 'CNY',
          total: 69.73,
          granted: 0,
          toppedUp: 69.73,
          available: true
        }
      },
      true
    )
    assert.equal(next.providers[0]?.balanceState, 'ready')
    assert.equal(next.providers[0]?.balance?.total, 69.73)
  })

  it('does not write a DeepSeek wallet onto other vendor cards', () => {
    const prev = {
      usage: aggregateAnalysisUsage([]),
      providers: stubAnalysisProviders(
        [
          { id: 'deepseek', name: 'DeepSeek' },
          { id: 'openrouter', name: 'OpenRouter' }
        ],
        true,
        { apiBalanceSupported: true }
      ),
      now: 1
    }
    const next = applyApiBalanceToSnapshot(
      prev,
      {
        supported: true,
        balance: {
          source: 'deepseek',
          currency: 'CNY',
          total: 1,
          granted: 0,
          toppedUp: 1,
          available: true
        }
      },
      true
    )
    assert.equal(next.providers[0]?.balanceState, 'ready')
    assert.equal(next.providers[1]?.balance, null)
    assert.notEqual(next.providers[1]?.balanceState, 'ready')
  })

  it('writes an OpenRouter wallet onto the matching vendor card', () => {
    const prev = {
      usage: aggregateAnalysisUsage([]),
      providers: stubAnalysisProviders(
        [
          { id: 'deepseek', name: 'DeepSeek' },
          { id: 'openrouter', name: 'OpenRouter' }
        ],
        true
      ),
      now: 1
    }
    const next = applyApiBalanceToSnapshot(
      prev,
      {
        supported: true,
        balance: {
          source: 'openrouter',
          currency: 'USD',
          total: 12.5,
          granted: 0,
          toppedUp: 20,
          available: true
        }
      },
      true,
      'openrouter'
    )
    assert.equal(next.providers[0]?.balance, null)
    assert.notEqual(next.providers[0]?.balanceState, 'ready')
    assert.equal(next.providers[1]?.balanceState, 'ready')
    assert.equal(next.providers[1]?.balance?.total, 12.5)
  })
})

describe('localAnalysisProviders', () => {
  const catalogue = [
    { id: 'claude', name: 'Claude Code' },
    { id: 'codex', name: 'Codex' }
  ]

  it('lists every local binary, not only the settings list', () => {
    const list = localAnalysisProviders(
      [{ id: 'grok', name: 'Grok build' }],
      catalogue,
      ['claude', 'codex', 'grok']
    )
    assert.deepEqual(list, [
      { id: 'vav', name: 'VAV' },
      { id: 'claude', name: 'Claude Code' },
      { id: 'codex', name: 'Codex' },
      { id: 'grok', name: 'Grok build' }
    ])
  })

  it('keeps settings rows and custom agents even when a binary is missing', () => {
    const list = localAnalysisProviders(
      [
        { id: 'grok', name: 'Grok build' },
        { id: 'custom-1', name: 'Mine' }
      ],
      catalogue,
      ['claude']
    )
    assert.deepEqual(
      list.map((row) => row.id),
      ['vav', 'claude', 'grok', 'custom-1']
    )
  })

  it('lists the full catalogue when presence has not been probed', () => {
    const list = localAnalysisProviders([{ id: 'grok', name: 'Grok build' }], catalogue)
    assert.deepEqual(
      list.map((row) => row.id),
      ['vav', 'claude', 'codex', 'grok']
    )
  })

  it('replaces the VAV seed with vendor rows and honors the provider list order', () => {
    const list = localAnalysisProviders(
      [{ id: 'claude', name: 'Claude Code' }],
      catalogue,
      ['claude'],
      {
        vendors: [
          { id: 'deepseek', name: 'DeepSeek' },
          { id: 'openrouter', name: 'OpenRouter' }
        ],
        order: ['claude', 'openrouter', 'deepseek']
      }
    )
    assert.deepEqual(
      list.map((row) => row.id),
      ['claude', 'openrouter', 'deepseek']
    )
  })
})

describe('stubAnalysisProviders', () => {
  it('always includes VAV and configured agents', () => {
    const list = stubAnalysisProviders(
      localAnalysisProviders([{ id: 'claude', name: 'Claude Code' }], []),
      true
    )
    assert.equal(list[0]?.hostKey, 'vav')
    assert.equal(list[0]?.authKind, 'api-key')
    assert.equal(list[1]?.hostName, 'Claude Code')
    assert.equal(list.length, 2)
  })
})

describe('analysisHostOrNull', () => {
  it('only returns structured CLI hosts', () => {
    assert.equal(analysisHostOrNull('claude'), 'claude')
    assert.equal(analysisHostOrNull('vav'), null)
    assert.equal(analysisHostOrNull('custom-1'), null)
  })
})
