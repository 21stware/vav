import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { acpLoginSpec, canHostLogin, loginArgv, logoutArgv } from './hostLoginArgv.ts'

describe('host OAuth login argv', () => {
  it('opens Grok via grok login --oauth', () => {
    assert.deepEqual(loginArgv('grok'), ['login', '--oauth'])
    assert.deepEqual(logoutArgv('grok'), ['logout'])
  })

  it('opens Cursor via agent login', () => {
    assert.deepEqual(loginArgv('cursor'), ['login'])
    assert.deepEqual(logoutArgv('cursor'), ['logout'])
  })

  it('signs Droid in over ACP device pairing', () => {
    assert.equal(loginArgv('droid'), null)
    assert.deepEqual(acpLoginSpec('droid'), {
      argv: ['exec', '--output-format', 'acp'],
      methodId: 'device-pairing'
    })
    assert.equal(canHostLogin('droid'), true)
    assert.equal(canHostLogin('grok'), true)
  })

  it('does not invent login for key-only hosts', () => {
    assert.equal(loginArgv('claude'), null)
    assert.equal(loginArgv('codex'), null)
    assert.equal(loginArgv('vav'), null)
    assert.equal(logoutArgv('claude'), null)
    assert.equal(acpLoginSpec('cursor'), null)
    assert.equal(canHostLogin('codex'), false)
  })
})
