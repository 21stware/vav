import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldReplaceCliRuntime, spawnResumeCursor } from './cliWorkspaceRestart.ts'

describe('shouldReplaceCliRuntime', () => {
  it('keeps a live driver whose cwd still matches', () => {
    assert.equal(shouldReplaceCliRuntime('/a', '/a', false), false)
  })

  it('replaces when the conversation root moved', () => {
    assert.equal(shouldReplaceCliRuntime('/a', '/b', false), true)
  })

  it('replaces a spawn still in flight (cwd may already be stale)', () => {
    assert.equal(shouldReplaceCliRuntime('/a', '/a', true), true)
    assert.equal(shouldReplaceCliRuntime(undefined, '/b', true), true)
  })

  it('replaces when there is no live process (fresh session in the new cwd)', () => {
    assert.equal(shouldReplaceCliRuntime(undefined, '/b', false), true)
  })
})

describe('spawnResumeCursor', () => {
  const identityOf = (cursor: { provider: string; auth?: string }) => cursor.auth ?? null

  it('drops a foreign provider without a transcript handoff', () => {
    assert.deepEqual(
      spawnResumeCursor({ provider: 'claude', auth: 'a' }, 'cursor', 'a', identityOf),
      { cursor: null, dropIdentity: false }
    )
  })

  it('drops a matching host whose stored auth is a different account', () => {
    assert.deepEqual(
      spawnResumeCursor({ provider: 'cursor', auth: 'old' }, 'cursor', 'new', identityOf),
      { cursor: null, dropIdentity: true }
    )
  })

  it('keeps a matching host and identity', () => {
    const cursor = { provider: 'cursor', auth: 'a' }
    assert.deepEqual(spawnResumeCursor(cursor, 'cursor', 'a', identityOf), {
      cursor,
      dropIdentity: false
    })
    assert.deepEqual(spawnResumeCursor(cursor, 'cursor', null, identityOf), {
      cursor,
      dropIdentity: false
    })
  })
})
