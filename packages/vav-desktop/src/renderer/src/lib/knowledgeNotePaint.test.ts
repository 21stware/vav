import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideKnowledgeNotePaint } from './knowledgeNotePaint.ts'

const ready = {
  phase: 'ready' as const,
  source: 'disk' as const
}

describe('decideKnowledgeNotePaint', () => {
  it('ignores a disk echo of the body we just saved', () => {
    assert.equal(
      decideKnowledgeNotePaint({
        ...ready,
        incoming: '# Note\n\nhello',
        current: '# Note\n\nhello world',
        lastSaved: '# Note\n\nhello',
        localDirty: true
      }),
      'ignore'
    )
  })

  it('does not conflict when the user has typed past an in-flight save', () => {
    assert.equal(
      decideKnowledgeNotePaint({
        ...ready,
        incoming: 'ab',
        current: 'abc',
        lastSaved: 'ab',
        localDirty: true
      }),
      'ignore'
    )
  })

  it('applies a real remote write when the local editor is clean', () => {
    assert.equal(
      decideKnowledgeNotePaint({
        ...ready,
        incoming: '# Remote\n\nfrom agent',
        current: '# Local\n\n',
        lastSaved: '# Local\n\n',
        localDirty: false
      }),
      'apply'
    )
  })

  it('conflicts when disk moved and the user has unsaved edits', () => {
    assert.equal(
      decideKnowledgeNotePaint({
        ...ready,
        incoming: '# Remote\n\nfrom agent',
        current: '# Local\n\ntyped',
        lastSaved: '# Local\n\n',
        localDirty: true
      }),
      'conflict'
    )
  })

  it('acks when the editor already shows the incoming body', () => {
    assert.equal(
      decideKnowledgeNotePaint({
        ...ready,
        incoming: '# Note\n\nhello',
        current: '# Note\n\nhello',
        lastSaved: '# Note\n\n',
        localDirty: true
      }),
      'ack'
    )
  })

  it('does not auto-take disk while already conflicted', () => {
    assert.equal(
      decideKnowledgeNotePaint({
        phase: 'conflicted',
        source: 'disk',
        incoming: '# Remote\n\nlater',
        current: '# Local\n\ntyped',
        lastSaved: '# Local\n\n',
        localDirty: true
      }),
      'ignore'
    )
  })

  it('lets a later agent write replace a conflict', () => {
    assert.equal(
      decideKnowledgeNotePaint({
        phase: 'conflicted',
        source: 'agent',
        incoming: '# Remote\n\nstreamed',
        current: '# Local\n\ntyped',
        lastSaved: '# Local\n\n',
        localDirty: true
      }),
      'apply'
    )
  })
})
