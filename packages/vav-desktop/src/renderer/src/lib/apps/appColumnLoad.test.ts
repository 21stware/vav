import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appColumnSurface,
  appObjectListKey,
  dataRowsNeedingSchema,
  fileSessionListKey,
  knowledgeNoteIdsForPreview
} from './appColumnLoad.ts'

describe('appColumnSurface', () => {
  it('mounts list or detail, never both', () => {
    assert.equal(appColumnSurface(false), 'list')
    assert.equal(appColumnSurface(true), 'detail')
  })
})

describe('knowledgeNoteIdsForPreview', () => {
  it('keeps notes for visible conversations only', () => {
    assert.deepEqual(
      knowledgeNoteIdsForPreview(
        [
          { id: 'n1', kind: 'note', conversationId: 'c1' },
          { id: 'n2', kind: 'note', conversationId: 'c2' },
          { id: 'd1', kind: 'document', conversationId: 'c1' },
          { id: 'n3', kind: 'note', conversationId: null }
        ],
        ['c1']
      ),
      ['n1']
    )
  })
})

describe('dataRowsNeedingSchema', () => {
  it('skips rows without a file and rows already loaded', () => {
    const rows = [
      { id: 'a', dataFilePath: '/tmp/a.csv' },
      { id: 'b', dataFilePath: '/tmp/b.csv' },
      { id: 'c', dataFilePath: null }
    ]
    assert.deepEqual(
      dataRowsNeedingSchema(rows, new Set(['a'])).map((row) => row.id),
      ['b']
    )
  })
})

describe('list keys', () => {
  it('ignores conversations that are not file sessions', () => {
    assert.equal(
      fileSessionListKey([
        { id: 'chat', updatedAt: 1 },
        { id: 'file', fileId: 'f1', updatedAt: 2 }
      ]),
      'file:2'
    )
  })

  it('stays stable when an excluded row is the only change', () => {
    const include = (row: { archived?: boolean }): boolean => !row.archived
    const before = appObjectListKey(
      [
        { id: 'a', updatedAt: 1, title: 'A' },
        { id: 'b', archived: true, updatedAt: 9, title: 'B' }
      ],
      include
    )
    const after = appObjectListKey(
      [
        { id: 'a', updatedAt: 1, title: 'A' },
        { id: 'b', archived: true, updatedAt: 10, title: 'B-renamed' }
      ],
      include
    )
    assert.equal(before, after)
  })
})
