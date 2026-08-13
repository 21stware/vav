import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FileDraftCoalescer, writeToolDraft } from './writeToolDraft.ts'

describe('writeToolDraft', () => {
  it('streams fs_write content as it grows', () => {
    const draft = writeToolDraft('fs_write', {
      path: '/tmp/note.md',
      content: '# Hello world from the agent'
    })
    assert.deepEqual(draft, {
      path: '/tmp/note.md',
      content: '# Hello world from the agent'
    })
  })

  it('accepts Claude Write contents + file_path', () => {
    const draft = writeToolDraft('Write', {
      file_path: '/tmp/a.md',
      contents: 'enough text here'
    })
    assert.equal(draft?.path, '/tmp/a.md')
    assert.equal(draft?.content, 'enough text here')
  })

  it('skips incomplete Office binaries', () => {
    assert.equal(
      writeToolDraft('fs_write', { path: '/tmp/a.docx', content: 'PK\x03\x04....' }),
      null
    )
  })

  it('skips short or missing bodies', () => {
    assert.equal(writeToolDraft('fs_write', { path: '/tmp/a.md', content: 'hi' }), null)
    assert.equal(writeToolDraft('terminal', { command: 'echo hi' }), null)
  })
})

describe('FileDraftCoalescer', () => {
  it('sends a snapshot then appends while the body grows', () => {
    const c = new FileDraftCoalescer()
    assert.deepEqual(c.next('/tmp/a.md', 'hello world from agent', 0), {
      filePath: '/tmp/a.md',
      content: 'hello world from agent'
    })
    assert.equal(c.next('/tmp/a.md', 'hello world from agent!', 10), null)
    assert.deepEqual(c.next('/tmp/a.md', 'hello world from agent more', 80), {
      filePath: '/tmp/a.md',
      append: ' more',
      baseLen: 22
    })
  })

  it('resyncs with a full snapshot after 1s', () => {
    const c = new FileDraftCoalescer()
    c.next('/tmp/a.md', 'hello world from agent', 0)
    const later = c.next('/tmp/a.md', 'hello world from agent and more', 1000)
    assert.deepEqual(later, {
      filePath: '/tmp/a.md',
      content: 'hello world from agent and more'
    })
  })

  it('throttles per path independently', () => {
    const c = new FileDraftCoalescer()
    assert.ok(c.next('/a.md', 'hello world from aaaa', 0))
    assert.ok(c.next('/b.md', 'hello world from bbbb', 10))
  })

  it('replaces with a snapshot when the body is rewritten', () => {
    const c = new FileDraftCoalescer()
    c.next('/tmp/a.md', 'hello world from agent', 0)
    assert.deepEqual(c.next('/tmp/a.md', '# a different document starts', 80), {
      filePath: '/tmp/a.md',
      content: '# a different document starts'
    })
  })
})
