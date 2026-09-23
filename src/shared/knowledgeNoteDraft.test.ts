import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { noteMarkdownWithTitle } from './knowledge.ts'
import { knowledgeNoteDraft, knowledgeNoteTitle } from './knowledgeNoteDraft.ts'

describe('knowledgeNoteTitle', () => {
  it('reads the first heading and prefers an explicit title', () => {
    assert.equal(knowledgeNoteTitle('# Launch plan\n\nbody'), 'Launch plan')
    assert.equal(knowledgeNoteTitle('# ignored', 'Roadmap'), 'Roadmap')
    assert.equal(knowledgeNoteTitle('no heading'), null)
  })
})

describe('noteMarkdownWithTitle', () => {
  it('rewrites the leading heading and keeps the body', () => {
    assert.equal(
      noteMarkdownWithTitle('# Untitled note\n\nhello', 'Launch plan'),
      '# Launch plan\n\nhello'
    )
    assert.equal(
      noteMarkdownWithTitle('# Old\n\n# Later\n\nbody', 'New'),
      '# New\n\n# Later\n\nbody'
    )
  })

  it('inserts a heading when the note has none', () => {
    assert.equal(noteMarkdownWithTitle('just body', 'Notes'), '# Notes\n\njust body')
    assert.equal(noteMarkdownWithTitle('', 'Notes'), '# Notes\n\n')
    assert.equal(noteMarkdownWithTitle('# Keep', '  '), '# Keep')
  })

  it('does not treat $ in the title as a replacement pattern', () => {
    assert.equal(noteMarkdownWithTitle('# Old', 'Cost $1'), '# Cost $1')
  })
})

describe('knowledgeNoteDraft', () => {
  it('streams a knowledge_write into the addressed note', () => {
    const draft = knowledgeNoteDraft('knowledge_write', {
      host_id: 'host-1',
      markdown: '# Launch plan\n\nShip the editor.'
    })
    assert.deepEqual(draft, {
      hostId: 'host-1',
      markdown: '# Launch plan\n\nShip the editor.',
      title: 'Launch plan'
    })
  })

  it('uses the focused note when app write omits a url', () => {
    const draft = knowledgeNoteDraft(
      'app',
      { op: 'write', content: '# Notes\n\nhello' },
      { focusedHostId: 'host-9' }
    )
    assert.equal(draft?.hostId, 'host-9')
    assert.equal(draft?.title, 'Notes')
  })

  it('does not treat a storage write as a note', () => {
    assert.equal(
      knowledgeNoteDraft(
        'app',
        { op: 'write', kind: 'storage', content: '# no', path: '/tmp/a.md' },
        { focusedHostId: 'host-9' }
      ),
      null
    )
  })

  it('does not treat a file write as a note', () => {
    assert.equal(
      knowledgeNoteDraft('fs_write', {
        path: '/notes/a.md',
        content: '# From the file tool\n\nok'
      }),
      null
    )
  })

  it('streams note_edit into the open note when host_id is omitted', () => {
    const draft = knowledgeNoteDraft(
      'note_edit',
      { markdown: '# Meeting\n\nUpdated.' },
      { focusedHostId: 'host-4' }
    )
    assert.equal(draft?.hostId, 'host-4')
    assert.equal(draft?.title, 'Meeting')
  })
})
