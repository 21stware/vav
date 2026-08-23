import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loginArgv, logoutArgv } from './hostLoginArgv.ts'

describe('host OAuth login argv', () => {
  it('opens Grok via grok login --oauth', () => {
    assert.deepEqual(loginArgv('grok'), ['login', '--oauth'])
    assert.deepEqual(logoutArgv('grok'), ['logout'])
  })

  it('opens Cursor via agent login', () => {
    assert.deepEqual(loginArgv('cursor'), ['login'])
    assert.deepEqual(logoutArgv('cursor'), ['logout'])
  })

  it('does not invent login for key-only hosts', () => {
    assert.equal(loginArgv('claude'), null)
    assert.equal(loginArgv('codex'), null)
    assert.equal(loginArgv('vav'), null)
    assert.equal(logoutArgv('claude'), null)
  })
})
