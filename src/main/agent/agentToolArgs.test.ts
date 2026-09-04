import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyEditedArgs, leanToolArgs } from './agentToolArgs.ts'

describe('leanToolArgs / applyEditedArgs', () => {
  it('keeps identity fields and elides bulky fs_write contents', () => {
    assert.deepEqual(leanToolArgs('fs_write', { path: '/a.ts', contents: 'huge', extra: 1 }), {
      path: '/a.ts',
      contents: '…'
    })
    assert.deepEqual(leanToolArgs('fs_read', { path: '/a.ts', extra: true }), { path: '/a.ts' })
    assert.deepEqual(leanToolArgs('terminal', { command: 'ls', background: true, cwd: '/' }), {
      command: 'ls',
      background: true
    })
    assert.deepEqual(leanToolArgs('web_search', { query: 'vav', num_results: 3 }), {
      query: 'vav',
      num_results: 3
    })
  })

  it('merges edited approval payloads back into tool args', () => {
    assert.deepEqual(applyEditedArgs('terminal', { command: 'ls', background: true }, 'pwd'), {
      command: 'pwd',
      background: true
    })
    assert.deepEqual(applyEditedArgs('fs_write', { path: '/a.ts' }, '/b.ts'), { path: '/b.ts' })
    assert.deepEqual(applyEditedArgs('web_fetch', { url: 'https://a' }, 'https://b'), {
      url: 'https://b'
    })
    assert.deepEqual(applyEditedArgs('plan', { title: 'x' }, '{"title":"y"}'), { title: 'y' })
    assert.equal(applyEditedArgs('plan', {}, 'not-json'), null)
  })
})
