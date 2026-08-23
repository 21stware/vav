import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { QuotaWindow } from '../../shared/types.ts'
import { QuotaService } from './QuotaService.ts'

function windowOf(percent: number): QuotaWindow {
  return {
    id: 'cursor_api',
    kind: 'cursor_api',
    usedPercent: percent,
    resetsAt: null,
    updatedAt: 1
  }
}

describe('QuotaService multi-identity fetch', () => {
  it('keeps live-slot and snapshot-token fetches in separate namespaces', async () => {
    const calls: Array<string | undefined> = []
    const service = new QuotaService({
      identityOf: async () => 'ada@cursor.com',
      identitiesOf: async () => [
        { identity: 'ada@cursor.com', token: 'SHOULD-NOT-USE' },
        { identity: 'bob@cursor.com', token: 'BOB' }
      ],
      fetchers: {
        cursor: async (ctx) => {
          calls.push(ctx?.token)
          return [windowOf(ctx?.token === 'BOB' ? 20 : 10)]
        }
      }
    })
    await service.forceRefresh('cursor')
    assert.equal(calls.length, 2)
    assert.ok(calls.includes(undefined))
    assert.ok(calls.includes('BOB'))
    assert.equal(service.get('cursor', 'ada@cursor.com')[0]?.usedPercent, 10)
    assert.equal(service.get('cursor', 'bob@cursor.com')[0]?.usedPercent, 20)
    assert.equal(service.identity('cursor'), 'ada@cursor.com')
  })
})
