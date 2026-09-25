import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lookupWorkingCopyKey, stripWorkingCopySlash } from './workingCopyLookup.ts'

describe('lookupWorkingCopyKey', () => {
  it('returns undefined without canonicalize when nothing is registered', () => {
    let calls = 0
    const hit = lookupWorkingCopyKey(
      '/Users/ada/Desktop/brief.pdf',
      new Map(),
      new Map(),
      (path) => path,
      () => {
        calls += 1
        return '/resolved'
      }
    )
    assert.equal(hit, undefined)
    assert.equal(calls, 0)
  })

  it('hits a raw real-path key without canonicalize', () => {
    let calls = 0
    const byReal = new Map<string, string>([['/tmp/note.pdf', 'entry']])
    const hit = lookupWorkingCopyKey('/tmp/note.pdf', byReal, new Map(), (path) => path, () => {
      calls += 1
      return '/tmp/note.pdf'
    })
    assert.equal(hit, 'entry')
    assert.equal(calls, 0)
  })

  it('canonicalizes only after a raw miss', () => {
    let calls = 0
    const real = '/var/folders/x/note.pdf'
    const byReal = new Map<string, string>([[real, 'sandboxed']])
    const hit = lookupWorkingCopyKey(
      '/tmp/note.pdf',
      byReal,
      new Map(),
      (path) => path,
      (path) => {
        calls += 1
        return path === '/tmp/note.pdf' ? real : path
      }
    )
    assert.equal(hit, 'sandboxed')
    assert.equal(calls, 1)
  })

  it('strips a trailing slash before lookup', () => {
    assert.equal(stripWorkingCopySlash('/tmp/dir/'), '/tmp/dir')
    const byCopy = new Map<string, string>([['/tmp/copy', 'c']])
    assert.equal(
      lookupWorkingCopyKey('/tmp/copy/', new Map(), byCopy, (path) => path, (path) => path),
      'c'
    )
  })
})
