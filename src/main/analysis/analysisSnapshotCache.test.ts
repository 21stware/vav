import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  configureAnalysisCache,
  resetAnalysisCacheForTests,
  serveAnalysisSnapshot
} from './analysisSnapshotCache.ts'
import type { AnalysisSnapshot } from '../../shared/analysis.ts'

function emptySnap(now: number, sessions = 0): AnalysisSnapshot {
  return {
    usage: {
      total: {
        sessions,
        turns: 0,
        inputTokens: sessions * 10,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        costApprox: false
      },
      api: {
        sessions,
        turns: 0,
        inputTokens: sessions * 10,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        costApprox: false
      },
      agent: {
        sessions: 0,
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        costApprox: false
      },
      hosts: []
    },
    providers: [
      {
        hostKey: 'vav',
        hostName: 'VAV',
        kind: 'api',
        signedIn: true,
        accountId: null,
        plan: null,
        authKind: 'api-key',
        windows: []
      }
    ],
    now
  }
}

describe('analysisSnapshotCache', () => {
  it('returns the cached providers immediately and rebuilds in the background', async () => {
    resetAnalysisCacheForTests()
    let builds = 0
    let resolveBuild: ((snap: AnalysisSnapshot) => void) | null = null
    configureAnalysisCache({
      conversations: () => [{ cliHost: null, tokenHistory: [], tokensUsed: 40 }],
      build: () => {
        builds += 1
        return new Promise((resolve) => {
          resolveBuild = resolve
        })
      }
    })

    const first = serveAnalysisSnapshot()
    const preview = await first
    assert.equal(preview.usage.api.sessions, 1)
    assert.equal(preview.usage.api.inputTokens, 40)
    resolveBuild?.(emptySnap(1, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(builds, 1)

    let background = 0
    configureAnalysisCache({
      conversations: () => [{ cliHost: null, tokenHistory: [], tokensUsed: 40 }],
      build: async () => {
        background += 1
        return emptySnap(2, 0)
      }
    })

    const quick = await serveAnalysisSnapshot()
    assert.equal(quick.usage.api.sessions, 1)
    assert.equal(quick.usage.api.inputTokens, 40)
    assert.equal(quick.providers[0]?.hostKey, 'vav')
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(background, 1)
  })

  it('awaits a full rebuild when refresh is requested', async () => {
    resetAnalysisCacheForTests()
    let builds = 0
    let lastForce = false
    configureAnalysisCache({
      conversations: () => [],
      build: async (force) => {
        builds += 1
        lastForce = force
        return emptySnap(3, 0)
      }
    })
    await serveAnalysisSnapshot()
    await serveAnalysisSnapshot({ refresh: true })
    assert.equal(lastForce, true)
    assert.equal(builds, 2)
  })
})
