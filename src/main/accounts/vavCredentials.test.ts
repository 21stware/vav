import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clearLegacyApiSlotIfNoVavKeys } from './vavCredentials.ts'

describe('clearLegacyApiSlotIfNoVavKeys', () => {
  it('clears the legacy api slot when no VAV keys remain', () => {
    const cleared: string[] = []
    clearLegacyApiSlotIfNoVavKeys(
      { listAll: () => [{ kind: 'oauth' }] },
      { clear: (name) => cleared.push(name) }
    )
    assert.deepEqual(cleared, ['api'])
  })

  it('keeps the legacy slot while a VAV key account still exists', () => {
    const cleared: string[] = []
    clearLegacyApiSlotIfNoVavKeys(
      { listAll: () => [{ kind: 'vav_key' }, { kind: 'oauth' }] },
      { clear: (name) => cleared.push(name) }
    )
    assert.deepEqual(cleared, [])
  })
})
