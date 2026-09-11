import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ConversationMeta } from '@shared/types.ts'
import {
  DEFAULT_SIDEBAR_VISIBLE_CATEGORIES,
  isSidebarCategoryVisible,
  parseSidebarVisibleCategories,
  toggleSidebarVisibleCategory
} from '@shared/types.ts'
import { t as translate } from '@shared/i18n/index.ts'
import {
  agentTypeLabel,
  conversationSubtitle,
  filterValueLabel,
  groupingOptions,
  modelLabel,
  flattenSessionTitle,
  conversationSelectionRunClass,
  adjacentRunClass,
  hostMachineLabel,
  incomingConnectLabels,
  pinnableWorkspaceDir,
  nextVisibleSelectionAfterArchive,
  filterFileSessionRows,
  uniqueRecentFileRows,
  sidebarListModeOfConversation,
  conversationFitsListMode,
  nextConversationForListMode,
  shouldReconcileSidebarSelection
} from './sidebarList.ts'

function conv(partial: Partial<ConversationMeta> & Pick<ConversationMeta, 'id'>): ConversationMeta {
  return {
    title: partial.title ?? partial.id,
    createdAt: 0,
    updatedAt: 0,
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

describe('sidebarList', () => {
  it('resolves model and CLI agent labels', () => {
    assert.equal(agentTypeLabel(conv({ id: 'c1', cliHost: 'vav' }), [{ id: 'claude', name: 'Claude' }]), null)
    assert.equal(
      agentTypeLabel(conv({ id: 'c1', cliHost: 'claude' }), [{ id: 'claude', name: 'Claude' }]),
      'Claude'
    )
    assert.equal(agentTypeLabel(conv({ id: 'c1', cliHost: 'grok' }), []), 'grok')
    assert.ok(modelLabel('unknown-model-xyz') === 'unknown-model-xyz')
  })

  it('lists grouping options and filter labels', () => {
    const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      translate('en', key, params)
    assert.deepEqual(
      groupingOptions(t).map((row) => row.value),
      ['none', 'workspace', 'provider']
    )
    assert.equal(filterValueLabel({ kind: 'none' }, t), t('sidebar.filter.none'))
    assert.equal(filterValueLabel({ kind: 'favorite' }, t), t('sidebar.filter.favorite'))
    assert.equal(filterValueLabel({ kind: 'workspace', path: '/Users/me/repo' }, t), 'repo')
  })

  it('picks running status copy then idle meta, and hides a brand-new session', () => {
    const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      translate('en', key, params)
    const format = {
      relativeTime: (timestamp: number) => `t${timestamp}`,
      isTemporaryWorkspace: (path: string | null, tmp: string) => !!path && path.startsWith(tmp),
      workdirShortLabel: (path: string | null) => (path ? path.split('/').pop()! : 'default')
    }
    const live = conv({ id: 'c1', model: 'opus', updatedAt: 9, createdAt: 1, tokensUsed: 12, workingDirectory: '/proj/vav' })
    assert.deepEqual(
      conversationSubtitle({
        conversation: live,
        turn: { isRunning: true, toolCount: 3 },
        isActive: true,
        tmp: '/tmp',
        t,
        agentLabel: 'Claude',
        ...format
      }),
      { kind: 'status', text: `Claude · ${t('sidebar.streaming', { model: modelLabel('opus') })}` }
    )
    assert.deepEqual(
      conversationSubtitle({
        conversation: live,
        turn: undefined,
        isActive: false,
        tmp: '/tmp',
        t,
        agentLabel: null,
        ...format
      }),
      { kind: 'meta', age: 't9', dir: 'vav' }
    )
    assert.equal(
      conversationSubtitle({
        conversation: conv({ id: 'new', updatedAt: 1, createdAt: 1, tokensUsed: 0 }),
        turn: undefined,
        isActive: false,
        tmp: '/tmp',
        t,
        agentLabel: null,
        ...format
      }),
      null
    )
    assert.deepEqual(
      conversationSubtitle({
        conversation: live,
        turn: { awaitingToolCallId: 't1', isRunning: true },
        isActive: false,
        tmp: '/tmp',
        t,
        agentLabel: null,
        ...format
      }),
      { kind: 'status', text: t('sidebar.awaitingAnswer') }
    )
  })
})

describe('flattenSessionTitle / adjacentRunClass', () => {
  it('strips markdown hashes and falls back', () => {
    assert.equal(flattenSessionTitle('##  Hello'), 'Hello')
    assert.equal(flattenSessionTitle('   '), 'New session')
    assert.equal(flattenSessionTitle('##  ', ''), '##')
  })

  it('names multi-select run chrome from neighbors', () => {
    assert.equal(adjacentRunClass(false, false), 'run-only')
    assert.equal(adjacentRunClass(false, true), 'run-start')
    assert.equal(adjacentRunClass(true, true), 'run-middle')
    assert.equal(adjacentRunClass(true, false), 'run-end')
    assert.equal(conversationSelectionRunClass('b', ['a'], ['a', 'b']), '')
    assert.equal(conversationSelectionRunClass('b', ['a', 'b', 'c'], ['a', 'b', 'c']), 'run-middle')
    assert.equal(conversationSelectionRunClass('a', ['a', 'c'], ['a', 'b', 'c']), 'run-only')
  })
})

describe('hostMachineLabel / incomingConnectLabels', () => {
  it('uses This Mac for the local machine and host names otherwise', () => {
    assert.equal(hostMachineLabel('local', [], 'local', 'This Mac'), 'This Mac')
    assert.equal(
      hostMachineLabel('h1', [{ id: 'h1', name: ' Studio ' }], 'local', 'This Mac'),
      'Studio'
    )
    assert.equal(hostMachineLabel('h2', [], 'local', 'This Mac', 'box'), 'box')
  })

  it('lists incoming device names', () => {
    assert.deepEqual(
      incomingConnectLabels([{ device: 'Phone' }, { device: null }, {}], (name) => `via ${name}`),
      ['via Phone']
    )
  })
})

describe('pinnableWorkspaceDir', () => {
  const temp = (path: string | null) => path === '/tmp/ws'

  it('pins a durable workspace path and rejects temp or synthetic groups', () => {
    assert.equal(
      pinnableWorkspaceDir({
        groupKind: 'workspace',
        groupWorkdir: '/proj',
        tmp: '/tmp',
        isTemporaryWorkspace: temp
      }),
      '/proj'
    )
    assert.equal(
      pinnableWorkspaceDir({
        groupKind: 'workspace',
        groupWorkdir: '/tmp/ws',
        tmp: '/tmp',
        isTemporaryWorkspace: temp
      }),
      null
    )
    assert.equal(
      pinnableWorkspaceDir({
        groupKind: 'workspace',
        groupWorkdir: '__none__',
        tmp: '/tmp',
        isTemporaryWorkspace: temp
      }),
      null
    )
    assert.equal(
      pinnableWorkspaceDir({
        groupKind: 'provider',
        groupWorkdir: '/proj',
        tmp: '/tmp',
        isTemporaryWorkspace: temp
      }),
      null
    )
    assert.equal(
      pinnableWorkspaceDir({
        groupKind: 'workspace',
        workspaceSelectable: false,
        groupWorkdir: '/proj',
        tmp: '/tmp',
        isTemporaryWorkspace: temp
      }),
      null
    )
  })
})

describe('nextVisibleSelectionAfterArchive', () => {
  it('prefers the visible row above the archived active session, else below', () => {
    const ids = ['a', 'b', 'c', 'd']
    assert.equal(nextVisibleSelectionAfterArchive(ids, 'c', ['c']), 'b')
    assert.equal(nextVisibleSelectionAfterArchive(ids, 'a', ['a']), 'b')
    assert.equal(nextVisibleSelectionAfterArchive(ids, 'b', ['a', 'b']), 'c')
    assert.equal(nextVisibleSelectionAfterArchive(ids, 'a', ['a', 'b', 'c', 'd']), null)
    assert.equal(nextVisibleSelectionAfterArchive(ids, 'c', ['x']), null)
    assert.equal(nextVisibleSelectionAfterArchive(ids, null, ['c']), null)
  })
})

describe('sidebar category visibility', () => {
  it('defaults to scheduled only and ignores junk', () => {
    assert.deepEqual(parseSidebarVisibleCategories(undefined), ['timers'])
    assert.deepEqual(parseSidebarVisibleCategories(DEFAULT_SIDEBAR_VISIBLE_CATEGORIES), ['timers'])
    assert.deepEqual(parseSidebarVisibleCategories(['fileSessions', 'timers', 'timers', 'nope']), [
      'fileSessions',
      'timers'
    ])
    assert.deepEqual(parseSidebarVisibleCategories([]), [])
  })

  it('keeps Task always visible and toggles the optional chips', () => {
    assert.equal(isSidebarCategoryVisible('main', []), true)
    assert.equal(isSidebarCategoryVisible('timers', ['timers']), true)
    assert.equal(isSidebarCategoryVisible('fileSessions', ['timers']), false)
    assert.deepEqual(toggleSidebarVisibleCategory(['timers'], 'fileSessions'), [
      'timers',
      'fileSessions'
    ])
    assert.deepEqual(toggleSidebarVisibleCategory(['timers', 'archive'], 'timers'), ['archive'])
  })
})

describe('sidebar list mode', () => {
  it('maps file / timer / archived / task rows onto categories', () => {
    assert.equal(sidebarListModeOfConversation(conv({ id: 't', sessionKind: 'timer' })), 'timers')
    assert.equal(sidebarListModeOfConversation(conv({ id: 'db', sessionKind: 'db' })), 'databases')
    assert.equal(sidebarListModeOfConversation(conv({ id: 'f', fileId: 'ino-1' })), 'fileSessions')
    assert.equal(
      sidebarListModeOfConversation(conv({ id: 'a', archived: true, archivedAt: 9 })),
      'archive'
    )
    assert.equal(sidebarListModeOfConversation(conv({ id: 'w' })), 'main')
    assert.equal(
      sidebarListModeOfConversation(conv({ id: 'af', fileId: 'ino-2', archived: true })),
      'fileSessions'
    )
    assert.ok(conversationFitsListMode(conv({ id: 'w' }), 'main'))
    assert.equal(conversationFitsListMode(conv({ id: 'a', archived: true }), 'main'), false)
  })

  it('keeps a matching selection and otherwise picks the newest row on this machine', () => {
    const rows = [
      conv({ id: 'old', updatedAt: 1 }),
      conv({ id: 'live', updatedAt: 8 }),
      conv({ id: 'arch', archived: true, archivedAt: 20, updatedAt: 2 }),
      conv({ id: 'file', fileId: 'ino', updatedAt: 9 }),
      conv({ id: 'job', sessionKind: 'timer', updatedAt: 4 }),
      conv({ id: 'run', sessionKind: 'timer', timerRunId: 'r1', updatedAt: 12 }),
      conv({ id: 'db', sessionKind: 'db', updatedAt: 7 })
    ]
    assert.equal(nextConversationForListMode(rows, 'main', 'live', 'local'), 'live')
    assert.equal(nextConversationForListMode(rows, 'main', 'arch', 'local'), 'live')
    assert.equal(nextConversationForListMode(rows, 'archive', 'live', 'local'), 'arch')
    assert.equal(nextConversationForListMode(rows, 'fileSessions', 'live', 'local'), 'file')
    assert.equal(nextConversationForListMode(rows, 'timers', 'live', 'local'), 'job')
    assert.equal(nextConversationForListMode(rows, 'timers', 'run', 'local'), 'run')
    assert.equal(nextConversationForListMode(rows, 'timers', null, 'local'), 'job')
    assert.equal(
      nextConversationForListMode(
        [
          conv({
            id: 'draft',
            title: 'Untitled-scheduled-task',
            sessionKind: 'timer',
            updatedAt: 20
          }),
          conv({ id: 'named', title: 'Nightly', sessionKind: 'timer', updatedAt: 4 })
        ],
        'timers',
        'live',
        'local'
      ),
      'named'
    )
    assert.equal(nextConversationForListMode(rows, 'databases', 'live', 'local'), 'db')
    assert.equal(
      nextConversationForListMode(
        [conv({ id: 'live', updatedAt: 8 })],
        'timers',
        'live',
        'local'
      ),
      null
    )
  })
})

describe('filterFileSessionRows', () => {
  it('matches title, path, or basename and returns the same array when empty', () => {
    const rows = [
      { title: 'Notes', path: '/tmp/docs/notes.md' },
      { title: 'Other', path: '/tmp/src/app.ts' }
    ]
    assert.equal(filterFileSessionRows(rows, '  '), rows)
    assert.deepEqual(
      filterFileSessionRows(rows, 'NOTES').map((r) => r.path),
      ['/tmp/docs/notes.md']
    )
    assert.deepEqual(
      filterFileSessionRows(rows, 'app.ts').map((r) => r.path),
      ['/tmp/src/app.ts']
    )
  })
})

describe('uniqueRecentFileRows', () => {
  it('keeps the first (newest) row for each path', () => {
    const rows = [
      { path: '/tmp/a.md', sessionId: 'new' },
      { path: '/tmp/b.md', sessionId: 'other' },
      { path: '/tmp/a.md', sessionId: 'old' }
    ]
    assert.deepEqual(
      uniqueRecentFileRows(rows).map((row) => row.sessionId),
      ['new', 'other']
    )
  })
})
