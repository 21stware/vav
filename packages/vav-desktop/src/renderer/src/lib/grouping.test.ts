import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ConversationMeta } from '@shared/types.ts'
import {
  listedSidebarGroups,
  mergeConnectedDbConversations,
  stableDatabaseTitle
} from './grouping.ts'

function conv(partial: Partial<ConversationMeta> & Pick<ConversationMeta, 'id'>): ConversationMeta {
  return {
    title: partial.title ?? partial.id,
    createdAt: 0,
    updatedAt: 1,
    workingDirectory: '/tmp/ws',
    model: 'x',
    tokensUsed: 0,
    tokenLimit: 0,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    ...partial
  }
}

describe('stableDatabaseTitle', () => {
  it('ignores draft and default session titles', () => {
    const row = {
      title: '新对话',
      database: 'pfmegrnargs',
      host: 'hh-pgsql-public.ebi.ac.uk',
      driver: 'postgres' as const,
      user: 'reader'
    }
    assert.equal(
      stableDatabaseTitle(row, 'Untitled-db-connection'),
      'pfmegrnargs@hh-pgsql-public.ebi.ac.uk'
    )
    assert.equal(
      stableDatabaseTitle({ ...row, title: 'Analytics' }, 'Untitled-db-connection'),
      'Analytics'
    )
  })
})

const opts = {
  fileSessionsView: false,
  archiveView: false,
  query: '',
  windowMachineId: null,
  sessionFilter: { kind: 'none' as const },
  running: () => false,
  unread: () => false,
  favoriteIds: new Set<string>(),
  searching: false,
  groupingMode: 'none' as const,
  tmp: '/tmp',
  pinnedWorkspaces: []
}

describe('listedSidebarGroups', () => {
  it('keeps timer sessions out of the main project list and archive', () => {
    const rows = [
      conv({ id: 'live', title: 'Chat' }),
      conv({ id: 'timer', title: 'Run', sessionKind: 'timer', timerJobId: 'j', timerRunId: 'r' }),
      conv({ id: 'arch-timer', title: 'Old', sessionKind: 'timer', archived: true, archivedAt: 2 }),
      conv({ id: 'db', title: 'Prod', sessionKind: 'db' })
    ]
    const main = listedSidebarGroups(rows, opts).flatMap((g) => g.conversations.map((c) => c.id))
    assert.deepEqual(main, ['live'])
    const archived = listedSidebarGroups(rows, { ...opts, archiveView: true }).flatMap((g) =>
      g.conversations.map((c) => c.id)
    )
    assert.deepEqual(archived, [])
    const hidden = listedSidebarGroups(rows, { ...opts, databasesView: true })
    assert.deepEqual(hidden, [])
    const databases = listedSidebarGroups(rows, {
      ...opts,
      databasesView: true,
      connectedConversationIds: new Set(['db'])
    })
    assert.deepEqual(
      databases.map((g) => ({ key: g.key, kind: g.kind, ids: g.conversations.map((c) => c.id) })),
      [{ key: 'db:db', kind: 'database', ids: ['db'] }]
    )
  })

  it('pins database groups like workspace folders', () => {
    const rows = [
      conv({ id: 'a', title: 'Analytics', sessionKind: 'db', pinned: true, pinTime: 2, updatedAt: 1 }),
      conv({ id: 'b', title: 'Billing', sessionKind: 'db', updatedAt: 9 })
    ]
    const groups = listedSidebarGroups(rows, {
      ...opts,
      databasesView: true,
      connectedConversationIds: new Set(['a', 'b'])
    })
    assert.deepEqual(
      groups.map((g) => ({ key: g.key, pinned: !!g.pinned, label: g.label })),
      [
        { key: 'db:a', pinned: true, label: 'Analytics' },
        { key: 'db:b', pinned: false, label: 'Billing' }
      ]
    )
  })

  it('keeps a database group visible when a table name matches the query', () => {
    const rows = [
      conv({
        id: 'db',
        title: 'RNAcentral',
        sessionKind: 'db',
        dbConnectionId: 'conn-1'
      })
    ]
    const miss = listedSidebarGroups(rows, {
      ...opts,
      databasesView: true,
      connectedConversationIds: new Set(['db']),
      query: 'xref'
    })
    assert.deepEqual(miss, [])
    const hit = listedSidebarGroups(rows, {
      ...opts,
      databasesView: true,
      connectedConversationIds: new Set(['db']),
      query: 'xref',
      dbTableNames: { 'conn-1': ['rnc_database', 'xref'] }
    })
    assert.deepEqual(hit.map((g) => g.key), ['db:db'])
  })

  it('synthesizes a connected db row when listMeta omitted the session', () => {
    const merged = mergeConnectedDbConversations([], [
      {
        id: 'conn',
        title: '',
        conversationId: 'db-1',
        driver: 'postgres',
        host: 'hh-pgsql-public.ebi.ac.uk',
        port: 5432,
        database: 'pfmegrnargs',
        user: 'reader',
        ssl: false,
        useUrl: true,
        url: 'postgres://reader@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs',
        hasPassword: true,
        createdAt: 1,
        updatedAt: 2,
        lastConnectedAt: 2,
        lastStatus: 'ok',
        lastError: null
      }
    ])
    assert.equal(merged[0]?.id, 'db-1')
    assert.equal(merged[0]?.sessionKind, 'db')
    assert.equal(merged[0]?.dbConnectionId, 'conn')
    assert.equal(merged[0]?.title, 'pfmegrnargs@hh-pgsql-public.ebi.ac.uk')
    const groups = listedSidebarGroups(merged, {
      ...opts,
      databasesView: true,
      connectedConversationIds: new Set(['db-1']),
      dbConnectionIds: { 'db-1': 'conn' }
    })
    assert.deepEqual(
      groups.map((g) => ({ key: g.key, connectionId: g.connectionId })),
      [{ key: 'db:db-1', connectionId: 'conn' }]
    )
  })

  it('prefers the connection title over an auto-titled chat', () => {
    const rows = [
      conv({
        id: 'db',
        title: 'what tables mention rna',
        sessionKind: 'db',
        dbConnectionId: 'conn-1'
      })
    ]
    const groups = listedSidebarGroups(rows, {
      ...opts,
      databasesView: true,
      connectedConversationIds: new Set(['db']),
      dbTitles: { db: 'pfmegrnargs@hh-pgsql-public.ebi.ac.uk' }
    })
    assert.equal(groups[0]?.label, 'pfmegrnargs@hh-pgsql-public.ebi.ac.uk')
  })
})
