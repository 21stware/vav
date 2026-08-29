import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { conversationIdForWatchedPath } from './conversationPath.ts'

describe('conversationIdForWatchedPath', () => {
  it('prefers an explicit conversation id', () => {
    const roots = new Map([['a', '/tmp/a']])
    assert.equal(conversationIdForWatchedPath(roots, '/tmp/a/x', 'b'), 'b')
  })

  it('matches the longest watched root', () => {
    const roots = new Map([
      ['wide', '/tmp/proj'],
      ['nested', '/tmp/proj/pkg']
    ])
    assert.equal(conversationIdForWatchedPath(roots, '/tmp/proj/pkg/src/a.ts'), 'nested')
    assert.equal(conversationIdForWatchedPath(roots, '/tmp/proj/readme.md'), 'wide')
  })

  it('returns undefined when nothing matches', () => {
    const roots = new Map([['a', '/tmp/a']])
    assert.equal(conversationIdForWatchedPath(roots, '/elsewhere'), undefined)
    assert.equal(conversationIdForWatchedPath(roots, ''), undefined)
  })
})
