import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appColumnFocusEqual,
  appColumnResourceUrl,
  formatAppColumnCapabilitiesForPrompt,
  formatAppColumnFocusBrief,
  formatAppColumnFocusForPrompt,
  formatAppColumnSendContext,
  parseAppColumnFocus,
  resolveAgentAppBindings,
  type AppColumnFocus
} from './appColumnFocus.ts'

const dataItem: AppColumnFocus = {
  kind: 'data',
  level: 'item',
  title: 'sakila.db · actor',
  path: '/tmp/sakila.db',
  objectId: 'db1',
  url: 'vav://app/data?id=db1&path=%2Ftmp%2Fsakila.db',
  table: 'actor'
}

describe('parseAppColumnFocus', () => {
  it('accepts a valid snapshot and rejects unknown kinds', () => {
    assert.deepEqual(parseAppColumnFocus(dataItem), dataItem)
    assert.equal(parseAppColumnFocus({ ...dataItem, kind: 'notes' }), null)
    assert.equal(parseAppColumnFocus(null), null)
  })
})

describe('formatAppColumnFocusForPrompt', () => {
  it('grounds "this dataset" on an open data table', () => {
    const text = formatAppColumnFocusForPrompt(dataItem)
    assert.match(text, /Current app column: Data/)
    assert.match(text, /sakila\.db/)
    assert.match(text, /`actor`/)
    assert.match(text, /当前这个数据集/)
    assert.match(text, /sql_query/)
    assert.match(text, /Do not search the working directory/)
    assert.match(text, /vav:\/\/app\/data/)
  })

  it('tells the model a catalog is not a hidden workdir file', () => {
    const text = formatAppColumnFocusForPrompt({
      kind: 'data',
      level: 'list',
      title: '',
      path: null,
      objectId: null,
      url: 'vav://app/data'
    })
    assert.match(text, /catalog/)
    assert.match(text, /`app` tool/)
    assert.match(text, /op: "create"/)
    assert.doesNotMatch(text, /sql_query on this resource/)
  })

  it('names the open note and host id so the model does not list first', () => {
    const text = formatAppColumnFocusForPrompt({
      kind: 'knowledge',
      level: 'item',
      title: 'Meeting notes',
      path: '/tmp/notes/kh1.md',
      objectId: 'n1',
      url: 'vav://app/knowledge?id=kh1&path=%2Ftmp%2Fnotes%2Fkh1.md'
    })
    assert.match(text, /Current app column: Knowledge/)
    assert.match(text, /这篇笔记/)
    assert.match(text, /Meeting notes/)
    assert.match(text, /Knowledge host id: kh1/)
    assert.match(text, /knowledge_fetch/)
    assert.match(text, /host_id: "kh1"/)
    assert.match(text, /Do not `app list`/)
  })

  it('mentions a highlighted catalog row that is not open', () => {
    const text = formatAppColumnFocusForPrompt({
      kind: 'knowledge',
      level: 'list',
      title: 'Meeting notes',
      path: null,
      objectId: 'n1',
      url: 'vav://app/knowledge'
    })
    assert.match(text, /highlighted but not open/)
    assert.match(text, /Meeting notes/)
  })
})

describe('formatAppColumnCapabilitiesForPrompt', () => {
  it('always names create/list for data, notes, and schedules', () => {
    const text = formatAppColumnCapabilitiesForPrompt()
    assert.match(text, /## App column/)
    assert.match(text, /analysis_write/)
    assert.match(text, /schedule_write/)
    assert.match(text, /storage_write/)
    assert.match(text, /not `fs_write`/)
    assert.match(text, /op: create/)
    assert.match(text, /Knowledge/)
    assert.match(text, /Scheduled/)
    assert.match(text, /connection_url/)
    assert.doesNotMatch(text, /You are on the/)
  })

  it('emphasizes the focused catalog', () => {
    const text = formatAppColumnCapabilitiesForPrompt({
      kind: 'knowledge',
      level: 'list',
      title: '',
      path: null,
      objectId: null,
      url: 'vav://app/knowledge'
    })
    assert.match(text, /You are on the Knowledge page/)
    assert.doesNotMatch(text, /Current app column block/)
  })

  it('tells the model not to rediscover an open item', () => {
    const text = formatAppColumnCapabilitiesForPrompt({
      kind: 'knowledge',
      level: 'item',
      title: 'Meeting notes',
      path: '/tmp/notes/kh1.md',
      objectId: 'n1',
      url: 'vav://app/knowledge?id=kh1'
    })
    assert.match(text, /You are on the Knowledge page/)
    assert.match(text, /live for this turn/)
    assert.match(text, /Do not list catalogs/)
  })
})

describe('formatAppColumnSendContext', () => {
  it('names the selected VAV note and rules out other notes apps', () => {
    const text = formatAppColumnSendContext({
      kind: 'knowledge',
      level: 'item',
      title: 'Meeting notes',
      path: '/tmp/notes/kh1.md',
      objectId: 'n1',
      url: 'vav://app/knowledge?id=kh1'
    })
    assert.match(text, /## VAV app context/)
    assert.match(text, /not Apple Notes, MacVise/)
    assert.match(text, /Meeting notes/)
    assert.match(text, /Knowledge host id: kh1/)
  })
})

describe('formatAppColumnFocusBrief', () => {
  it('names the open dataset', () => {
    const text = formatAppColumnFocusBrief(dataItem)
    assert.match(text, /\[VAV\] App · Data/)
    assert.match(text, /sakila\.db/)
    assert.match(text, /\/tmp\/sakila\.db/)
  })
})

describe('appColumnFocusEqual', () => {
  it('treats missing optional fields as null', () => {
    assert.equal(
      appColumnFocusEqual({ ...dataItem, table: undefined }, { ...dataItem, table: null }),
      true
    )
    assert.equal(appColumnFocusEqual(dataItem, { ...dataItem, table: 'film' }), false)
  })
})

describe('appColumnResourceUrl', () => {
  it('keeps data file paths off the table suffix', () => {
    assert.equal(
      appColumnResourceUrl({
        kind: 'data',
        level: 'item',
        objectId: 'db1',
        path: '/tmp/sakila.db'
      }),
      'vav://app/data?id=db1&path=%2Ftmp%2Fsakila.db'
    )
  })
})

describe('resolveAgentAppBindings', () => {
  it('inherits the open data object onto a workspace agent', () => {
    const bound = resolveAgentAppBindings(
      {
        id: 'agent',
        sessionKind: 'workspace',
        focusedFilePath: '/tmp/sakila.db',
        appColumnFocus: dataItem
      },
      (id) =>
        id === 'db1'
          ? {
              id: 'db1',
              sessionKind: 'db',
              dbConnectionId: 'conn-1',
              dataFilePath: '/tmp/sakila.db',
              focusedDbTable: 'actor'
            }
          : undefined
    )
    assert.equal(bound.dbSession, true)
    assert.equal(bound.dbConnectionId, 'conn-1')
    assert.equal(bound.dataFilePath, '/tmp/sakila.db')
    assert.equal(bound.dbTable, 'actor')
    assert.equal(bound.openFilePath, '/tmp/sakila.db')
  })

  it('does not pin a highlighted list row as the live dataset', () => {
    const bound = resolveAgentAppBindings(
      {
        id: 'agent',
        sessionKind: 'workspace',
        appColumnFocus: { ...dataItem, level: 'list', table: null, title: 'sakila.db' }
      },
      (id) =>
        id === 'db1'
          ? { id: 'db1', sessionKind: 'db', dbConnectionId: 'conn-1', dataFilePath: '/tmp/sakila.db' }
          : undefined
    )
    assert.equal(bound.dbSession, false)
    assert.equal(bound.dbConnectionId, null)
    assert.equal(bound.dataFilePath, null)
  })
})
