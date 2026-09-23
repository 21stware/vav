import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appObjectContextTargets,
  appObjectListKeyAction,
  appObjectPointerHandlers,
  appObjectRowClassName,
  appObjectSelectionMods,
  applyAppObjectList,
  compareAppListRows,
  menuPoint,
  textMatchesQuery
} from './appObjectList.ts'

describe('textMatchesQuery', () => {
  it('matches any field, case-insensitive', () => {
    assert.equal(textMatchesQuery('  NOTE  ', 'Daily notes', '/tmp/book.pdf'), true)
    assert.equal(textMatchesQuery('book', 'Daily notes', '/tmp/book.pdf'), true)
    assert.equal(textMatchesQuery('xyz', 'Daily notes'), false)
    assert.equal(textMatchesQuery('  ', 'anything'), true)
  })
})

describe('compareAppListRows', () => {
  const older = { title: 'Beta', updatedAt: 2, createdAt: 1 }
  const newer = { title: 'Alpha', updatedAt: 9, createdAt: 8 }

  it('sorts by last update, name, or created', () => {
    assert.equal(compareAppListRows(older, newer, 'updated') > 0, true)
    assert.equal(compareAppListRows(older, newer, 'name') > 0, true)
    assert.equal(compareAppListRows(older, newer, 'created') > 0, true)
  })
})

describe('applyAppObjectList', () => {
  const rows = [
    { title: 'Sales db', kind: 'database', updatedAt: 3, createdAt: 1 },
    { title: 'Metrics.csv', kind: 'file', updatedAt: 8, createdAt: 2 },
    { title: 'Archive', kind: 'database', updatedAt: 1, createdAt: 9 }
  ]

  it('filters, searches, and sorts in one pass', () => {
    const listed = applyAppObjectList(rows, {
      query: 'a',
      sort: 'name',
      fields: (row) => [row.title, row.kind],
      meta: (row) => row,
      include: (row) => row.kind === 'database'
    })
    assert.deepEqual(
      listed.map((row) => row.title),
      ['Archive', 'Sales db']
    )
  })
})

function mouse(
  partial: { detail?: number; clientX?: number; clientY?: number; metaKey?: boolean; shiftKey?: boolean } = {}
) {
  return {
    detail: 1,
    clientX: 12,
    clientY: 34,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    ...partial
  } as unknown as Parameters<ReturnType<typeof appObjectPointerHandlers>['onClick']>[0]
}

describe('appObjectPointerHandlers', () => {
  it('selects on click, opens on double-click, and menus without collapsing first', () => {
    const calls: string[] = []
    const handlers = appObjectPointerHandlers({
      onSelect: (event) => calls.push(event.metaKey ? 'add' : 'select'),
      onOpen: () => calls.push('open'),
      onMenu: () => calls.push('menu')
    })

    handlers.onClick(mouse())
    handlers.onClick(mouse({ metaKey: true }))
    handlers.onClick(mouse({ detail: 2 }))
    handlers.onDoubleClick(mouse({ detail: 2 }))
    handlers.onContextMenu(mouse())

    assert.deepEqual(calls, ['select', 'add', 'open', 'menu'])
  })
})

describe('appObjectContextTargets', () => {
  it('keeps a multi-selection when the row is already picked', () => {
    assert.deepEqual(appObjectContextTargets('b', ['a', 'b', 'c']), {
      ids: ['a', 'b', 'c'],
      collapse: false
    })
    assert.deepEqual(appObjectContextTargets('z', ['a', 'b']), { ids: ['z'], collapse: true })
    assert.deepEqual(appObjectContextTargets('a', ['a']), { ids: ['a'], collapse: false })
  })
})

describe('appObjectRowClassName', () => {
  it('adds contiguous-run chrome only for a multi-selection', () => {
    assert.equal(appObjectSelectionMods('b', ['b'], ['a', 'b', 'c']), '')
    assert.equal(appObjectRowClassName('b', ['b'], ['a', 'b', 'c']), 'applications-object-row')
    assert.equal(appObjectSelectionMods('b', ['a', 'b', 'c'], ['a', 'b', 'c']), 'multi run-middle')
    assert.equal(
      appObjectRowClassName('b', ['a', 'b', 'c'], ['a', 'b', 'c']),
      'applications-object-row multi run-middle'
    )
  })
})

describe('appObjectListKeyAction', () => {
  it('moves, ranges, deletes, and selects all', () => {
    assert.deepEqual(
      appObjectListKeyAction({ key: 'ArrowDown', metaKey: false, ctrlKey: false, shiftKey: false }, ['a', 'b'], 'a'),
      { type: 'move', id: 'b', range: false }
    )
    assert.deepEqual(
      appObjectListKeyAction({ key: 'ArrowUp', metaKey: false, ctrlKey: false, shiftKey: true }, ['a', 'b'], 'b'),
      { type: 'move', id: 'a', range: true }
    )
    assert.deepEqual(
      appObjectListKeyAction({ key: 'Delete', metaKey: false, ctrlKey: false, shiftKey: false }, ['a'], 'a'),
      { type: 'delete' }
    )
    assert.deepEqual(
      appObjectListKeyAction({ key: 'a', metaKey: true, ctrlKey: false, shiftKey: false }, ['a', 'b'], 'a'),
      { type: 'selectAll' }
    )
    assert.equal(
      appObjectListKeyAction({ key: 'ArrowDown', metaKey: false, ctrlKey: false, shiftKey: false }, ['a'], 'a'),
      null
    )
  })
})

describe('menuPoint', () => {
  it('uses the pointer coordinates', () => {
    assert.deepEqual(menuPoint(mouse({ clientX: 8, clientY: 9 })), { x: 8, y: 9 })
  })
})
