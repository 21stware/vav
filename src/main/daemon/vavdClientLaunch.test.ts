import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveVavdPairing } from './vavdClientLaunch.ts'

describe('resolveVavdPairing', () => {
  it('reads VAVD_URI', () => {
    assert.equal(resolveVavdPairing({ VAVD_URI: 'vav-daemon://secret' }, []), 'vav-daemon://secret')
  })

  it('prefers --vavd-uri over the environment', () => {
    assert.equal(
      resolveVavdPairing({ VAVD_URI: 'from-env' }, ['node', 'app', '--vavd-uri', 'from-arg']),
      'from-arg'
    )
  })

  it('accepts --vavd= and ignores empty values', () => {
    assert.equal(resolveVavdPairing({}, ['--vavd=vav-daemon://x']), 'vav-daemon://x')
    assert.equal(resolveVavdPairing({ VAVD_URI: '  ' }, ['--vavd-uri=']), null)
    assert.equal(resolveVavdPairing({}, []), null)
  })
})
