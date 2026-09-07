import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import type { HostAccountQuota } from '@shared/ipc'
import {
  applyUsageQuota,
  peekUsageCache,
  refreshUsage,
  resetUsageCacheForTests,
  setUsageQuotaReader,
  usageCacheKey
} from './usageCache.ts'

function quota(partial?: Partial<HostAccountQuota>): HostAccountQuota {
  return {
    host: 'cursor',
    hostName: 'Cursor',
    signedIn: true,
    accountId: 'ada@cursor.com',
    plan: 'Pro',
    authKind: 'oauth',
    windows: [
      {
        id: 'cursor_api',
        kind: 'cursor_api',
        usedPercent: 39,
        resetsAt: null,
        updatedAt: 1
      }
    ],
    ...partial
  }
}

describe('usageCache', () => {
  beforeEach(() => resetUsageCacheForTests())

  it('keeps host + account keys independent', () => {
    applyUsageQuota('cursor', 'ada', quota({ accountId: 'ada' }))
    applyUsageQuota('cursor', 'bob', quota({ accountId: 'bob', windows: [] }))
    assert.equal(peekUsageCache('cursor', 'ada')?.accountId, 'ada')
    assert.equal(peekUsageCache('cursor', 'bob')?.windows.length, 0)
    assert.equal(usageCacheKey('cursor', ' ada '), 'cursor:ada')
  })

  it('serves the cached snap while a refresh is in flight', async () => {
    applyUsageQuota('cursor', 'ada', quota())
    let resolveFetch: ((value: HostAccountQuota) => void) | null = null
    setUsageQuotaReader(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )

    const run = refreshUsage({ conversationId: 'c1', host: 'cursor', accountId: 'ada' })
    await Promise.resolve()
    const cached = peekUsageCache('cursor', 'ada')
    assert.equal(cached?.windows[0]?.usedPercent, 39)
    assert.equal(cached?.authKind, 'oauth')

    resolveFetch?.(quota({ windows: [{ ...quota().windows[0]!, usedPercent: 41 }] }))
    await run
    assert.equal(peekUsageCache('cursor', 'ada')?.windows[0]?.usedPercent, 41)
  })

  it('does not drop a cached snap when a refresh fails', async () => {
    applyUsageQuota('cursor', 'ada', quota())
    setUsageQuotaReader(async () => {
      throw new Error('offline')
    })
    await refreshUsage({ conversationId: 'c1', host: 'cursor', accountId: 'ada' })
    assert.equal(peekUsageCache('cursor', 'ada')?.windows[0]?.usedPercent, 39)
  })
})
