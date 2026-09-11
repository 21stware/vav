import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ConversationMeta } from '@shared/types.ts'
import { listedSidebarGroups } from './grouping.ts'

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
    const databases = listedSidebarGroups(rows, { ...opts, databasesView: true }).flatMap((g) =>
      g.conversations.map((c) => c.id)
    )
    assert.deepEqual(databases, ['db'])
  })
})
