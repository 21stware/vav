import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appColumnContextEqual,
  appColumnFilePath,
  appColumnFocusForSend,
  appColumnFocusFromContext,
  appColumnFocusPath,
  commentCardsForAppItem,
  resolveAppColumnContext,
  selectAppColumnContext,
  selectionLabelOf,
  type AppColumnContextState
} from './appColumnContext.ts'

const AGENT = 'agent-1'

function state(partial: Partial<AppColumnContextState> = {}): AppColumnContextState {
  return {
    applicationsVisible: true,
    applicationsMode: 'storage',
    applicationsDetailOpen: false,
    focusedAppObjectId: null,
    storageBrowsePath: null,
    filesSource: 'recent',
    filePreviewOpen: false,
    activeDbTable: null,
    activeId: AGENT,
    conversations: [
      { id: AGENT, title: 'E2E session', sessionKind: 'workspace' }
    ],
    commentCards: {},
    ...partial
  }
}

describe('resolveAppColumnContext', () => {
  it('hides context when the app column is collapsed', () => {
    assert.equal(
      resolveAppColumnContext(
        state({
          applicationsVisible: false,
          applicationsDetailOpen: true,
          focusedAppObjectId: 'f1',
          conversations: [
            { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
            {
              id: 'f1',
              title: 'hello.md',
              fileId: 'file-1',
              sessionKind: 'file',
              workingDirectory: '/tmp/hello.md'
            }
          ]
        })
      ),
      null
    )
  })

  it('expresses a catalog as list', () => {
    const ctx = resolveAppColumnContext(state({ applicationsMode: 'knowledge' }))
    assert.equal(ctx?.level, 'list')
    assert.equal(ctx?.kind, 'knowledge')
    assert.equal(ctx?.title, '')
    assert.equal(appColumnFocusPath(ctx), null)
  })

  it('expresses a browsed folder as list detail, not an open file', () => {
    const ctx = resolveAppColumnContext(
      state({ filesSource: 'thisMac', storageBrowsePath: '/Users/me/Documents' })
    )
    assert.equal(ctx?.level, 'list')
    assert.equal(ctx?.title, 'Documents')
    assert.equal(ctx?.path, '/Users/me/Documents')
    assert.equal(ctx?.storageSource, 'thisMac')
    assert.equal(appColumnFocusPath(ctx), null)
  })

  it('keeps Recents from inheriting a leftover browse path', () => {
    const ctx = resolveAppColumnContext(
      state({ filesSource: 'recent', storageBrowsePath: '/Users/me/Documents' })
    )
    assert.equal(ctx?.level, 'list')
    assert.equal(ctx?.title, '')
    assert.equal(ctx?.path, null)
    assert.equal(ctx?.storageSource, 'recent')
  })

  it('expresses an opened note as item with title and path', () => {
    const ctx = resolveAppColumnContext(
      state({
        applicationsMode: 'knowledge',
        applicationsDetailOpen: true,
        focusedAppObjectId: 'n1',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'n1',
            title: 'Meeting notes',
            sessionKind: 'knowledge',
            knowledgeHostId: 'kh1',
            focusedFilePath: '/tmp/notes/kh1.md'
          }
        ]
      })
    )
    assert.equal(ctx?.level, 'item')
    assert.equal(ctx?.title, 'Meeting notes')
    assert.equal(ctx?.path, '/tmp/notes/kh1.md')
    assert.equal(appColumnFocusPath(ctx), '/tmp/notes/kh1.md')
  })

  it('expresses a highlighted list row as list, not item', () => {
    const ctx = resolveAppColumnContext(
      state({
        applicationsMode: 'data',
        focusedAppObjectId: 'db1',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'db1',
            title: 'notes.db',
            sessionKind: 'db',
            dataFilePath: '/tmp/notes.db'
          }
        ]
      })
    )
    assert.equal(ctx?.level, 'list')
    assert.equal(ctx?.title, 'notes.db')
    assert.equal(ctx?.objectId, 'db1')
    assert.equal(appColumnFocusPath(ctx), null)
    const send = appColumnFocusForSend(ctx, {
      id: 'db1',
      title: 'notes.db',
      sessionKind: 'db',
      dataFilePath: '/tmp/notes.db'
    })
    assert.equal(send?.level, 'item')
    assert.equal(send?.path, '/tmp/notes.db')
  })

  it('promotes a highlighted knowledge note to the send target', () => {
    const ctx = resolveAppColumnContext(
      state({
        applicationsMode: 'knowledge',
        focusedAppObjectId: 'n1',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'n1',
            title: 'Meeting notes',
            sessionKind: 'knowledge',
            knowledgeHostId: 'kh1',
            focusedFilePath: '/tmp/notes/kh1.md'
          }
        ]
      })
    )
    assert.equal(ctx?.level, 'list')
    const send = appColumnFocusForSend(ctx, {
      id: 'n1',
      title: 'Meeting notes',
      sessionKind: 'knowledge',
      knowledgeHostId: 'kh1',
      focusedFilePath: '/tmp/notes/kh1.md'
    })
    assert.equal(send?.kind, 'knowledge')
    assert.equal(send?.level, 'item')
    assert.equal(send?.title, 'Meeting notes')
    assert.match(send?.url ?? '', /id=kh1/)
  })

  it('expresses an opened object as item', () => {
    const ctx = resolveAppColumnContext(
      state({
        applicationsDetailOpen: true,
        focusedAppObjectId: 'f1',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'f1',
            title: 'hello.md',
            fileId: 'file-1',
            sessionKind: 'file',
            workingDirectory: '/tmp/hello.md'
          }
        ]
      })
    )
    assert.equal(ctx?.level, 'item')
    assert.equal(ctx?.title, 'hello.md')
    assert.equal(ctx?.path, '/tmp/hello.md')
    assert.equal(appColumnFocusPath(ctx), '/tmp/hello.md')
  })

  it('advertises the open document, not its enclosing folder, for a file session', () => {
    const ctx = resolveAppColumnContext(
      state({
        applicationsMode: 'storage',
        applicationsDetailOpen: true,
        focusedAppObjectId: 'f1',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'f1',
            title: 'workspace',
            fileId: 'file-1',
            sessionKind: 'file',
            // Real file sessions carry the enclosing folder here …
            workingDirectory: '/tmp/ws',
            // … and the actually-open document here.
            focusedFilePath: '/tmp/ws/report.pdf'
          }
        ]
      })
    )
    assert.equal(ctx?.level, 'item')
    assert.equal(ctx?.title, 'report.pdf')
    assert.equal(ctx?.path, '/tmp/ws/report.pdf')
    assert.equal(appColumnFocusPath(ctx), '/tmp/ws/report.pdf')
    const send = appColumnFocusForSend(ctx, {
      id: 'f1',
      title: 'workspace',
      fileId: 'file-1',
      sessionKind: 'file',
      workingDirectory: '/tmp/ws',
      focusedFilePath: '/tmp/ws/report.pdf'
    })
    assert.equal(send?.kind, 'storage')
    assert.equal(send?.path, '/tmp/ws/report.pdf')
  })

  it('includes the focused table on a data item', () => {
    const ctx = resolveAppColumnContext(
      state({
        applicationsMode: 'data',
        applicationsDetailOpen: true,
        focusedAppObjectId: 'db1',
        activeDbTable: 'items',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'db1',
            title: 'notes.db',
            sessionKind: 'db',
            dataFilePath: '/tmp/notes.db'
          }
        ]
      })
    )
    assert.equal(ctx?.level, 'item')
    assert.equal(ctx?.title, 'notes.db · items')
    assert.equal(ctx?.path, '/tmp/notes.db/items')
    assert.equal(ctx?.table, 'items')
    const object = {
      id: 'db1',
      title: 'notes.db',
      sessionKind: 'db' as const,
      dataFilePath: '/tmp/notes.db'
    }
    assert.equal(appColumnFilePath(ctx, object), '/tmp/notes.db')
    const focus = appColumnFocusFromContext(ctx, object)
    assert.equal(focus?.kind, 'data')
    assert.equal(focus?.path, '/tmp/notes.db')
    assert.equal(focus?.table, 'items')
    assert.match(focus?.url ?? '', /vav:\/\/app\/data/)
  })

  it('expresses matching block picks as selected', () => {
    const ctx = resolveAppColumnContext(
      state({
        applicationsDetailOpen: true,
        focusedAppObjectId: 'f1',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'f1',
            title: 'hello.md',
            fileId: 'file-1',
            sessionKind: 'file',
            workingDirectory: '/tmp/hello.md'
          }
        ],
        commentCards: {
          [AGENT]: [
            {
              ref: {
                id: 'b1',
                filePath: '/tmp/hello.md',
                label: 'Heading',
                startLine: 1,
                endLine: 1,
                text: '#'
              },
              comment: ''
            }
          ]
        }
      })
    )
    assert.equal(ctx?.level, 'selected')
    assert.equal(ctx?.title, 'hello.md')
    assert.equal(ctx?.selectionLabel, 'Heading')
    assert.equal(ctx?.selectionCount, 1)
  })

  it('stays on list when leftover picks belong to a closed item', () => {
    const ctx = resolveAppColumnContext(
      state({
        focusedAppObjectId: 'f1',
        conversations: [
          { id: AGENT, title: 'E2E session', sessionKind: 'workspace' },
          {
            id: 'f1',
            title: 'hello.md',
            fileId: 'file-1',
            sessionKind: 'file',
            workingDirectory: '/tmp/hello.md'
          }
        ],
        commentCards: {
          [AGENT]: [
            {
              ref: {
                id: 'b1',
                filePath: '/tmp/hello.md',
                label: 'Heading',
                startLine: 1,
                endLine: 1,
                text: '#'
              },
              comment: ''
            }
          ]
        }
      })
    )
    assert.equal(ctx?.level, 'list')
    assert.equal(ctx?.title, 'hello.md')
  })
})

describe('commentCardsForAppItem', () => {
  it('keeps picks on the open file and drops other documents', () => {
    const cards = commentCardsForAppItem(
      [
        { ref: { filePath: '/tmp/hello.md' } },
        { ref: { filePath: '/tmp/other.md' } },
        { ref: { filePath: '/tmp/hello.md/cell' } }
      ],
      '/tmp/hello.md'
    )
    assert.deepEqual(
      cards.map((card) => card.ref.filePath),
      ['/tmp/hello.md', '/tmp/hello.md/cell']
    )
  })
})

describe('appColumnContextEqual', () => {
  it('treats two list snapshots with the same fields as equal', () => {
    const a = resolveAppColumnContext(state())
    const b = resolveAppColumnContext(state())
    assert.notEqual(a, b)
    assert.equal(appColumnContextEqual(a, b), true)
    assert.equal(appColumnContextEqual(a, resolveAppColumnContext(state({ applicationsMode: 'data' }))), false)
  })
})

describe('selectAppColumnContext', () => {
  it('reuses the snapshot when fields are unchanged', () => {
    const a = selectAppColumnContext(state())
    const b = selectAppColumnContext(state())
    assert.equal(a, b)
    const c = selectAppColumnContext(state({ applicationsMode: 'data' }))
    assert.notEqual(a, c)
    assert.equal(c?.kind, 'data')
  })
})

describe('selectionLabelOf', () => {
  it('prefers the block label, then a line range', () => {
    assert.equal(selectionLabelOf([{ ref: { label: 'Pens', startLine: 2, endLine: 2 } }]), 'Pens')
    assert.equal(selectionLabelOf([{ ref: { startLine: 3, endLine: 5 } }]), 'L3–5')
    assert.equal(
      selectionLabelOf([
        { ref: { label: 'a' } },
        { ref: { label: 'b' } }
      ]),
      ''
    )
  })
})
