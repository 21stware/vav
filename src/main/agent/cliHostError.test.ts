import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { t as translate } from '../../shared/i18n/index.ts'
import { describeCliHostError } from './cliHostError.ts'

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate('en', key, params)

describe('describeCliHostError', () => {
  it('maps cancelled, auth, network, and bare internal errors', () => {
    assert.equal(describeCliHostError('Cancelled', [], null, null, t, 'en').kind, 'cancelled')
    assert.equal(describeCliHostError('authentication required', [], null, null, t, 'en').kind, 'auth')
    assert.equal(describeCliHostError('ECONNRESET', [], null, null, t, 'en').kind, 'network')
    const internal = describeCliHostError('Internal error', [], null, null, t, 'en')
    assert.equal(internal.kind, 'generic')
    assert.equal(internal.message, t('error.agentInternal'))
  })

  it('formats an exhausted quota window', () => {
    const described = describeCliHostError(
      'quota exceeded',
      [{ id: 'five_hour', kind: 'five_hour', usedPercent: 100, resetsAt: null, updatedAt: 1 }],
      null,
      null,
      t,
      'en'
    )
    assert.equal(described.kind, 'quota')
    assert.match(described.message, /100/)
  })
})
