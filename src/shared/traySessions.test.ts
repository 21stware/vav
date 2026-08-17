import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  groupTrayPanes,
  mergeLiveAndUnseenTrayPanes,
  shouldRecordPtyCompletion,
  trayIndentedLabel,
  trayItemLabel,
  trayPaneKey,
  type TrayPane
} from './traySessions.ts'

function pane(partial: Partial<TrayPane> & Pick<TrayPane, 'tabId' | 'kind'>): TrayPane {
  return {
    conversationId: 'c1',
    sessionTitle: 'New Session',
    paneTitle: partial.kind === 'agent' ? 'Grok' : partial.kind === 'chat' ? 'VAV' : 'bash-1',
    dirKey: '/tmp/a',
    dirLabel: '~/a',
    createdAt: 1,
    ...partial
  }
}

describe('groupTrayPanes', () => {
  it('puts agents, then chats, then bash inside a directory', () => {
    const groups = groupTrayPanes([
      pane({ tabId: 'b1', kind: 'bash', paneTitle: 'bash-1', createdAt: 1 }),
      pane({ tabId: 'c1', kind: 'chat', paneTitle: 'VAV', createdAt: 2 }),
      pane({ tabId: 'a1', kind: 'agent', paneTitle: 'Grok', createdAt: 3 }),
      pane({ tabId: 'b2', kind: 'bash', paneTitle: 'bash-2', createdAt: 4 })
    ])
    assert.equal(groups.length, 1)
    assert.deepEqual(
      groups[0]!.panes.map((p) => p.tabId),
      ['a1', 'c1', 'b1', 'b2']
    )
  })

  it('keeps directory order and labels items without repeating the path', () => {
    const groups = groupTrayPanes([
      pane({ tabId: 'a1', kind: 'agent', dirKey: '/tmp/a', dirLabel: '~/a', paneTitle: 'Grok' }),
      pane({
        tabId: 'c1',
        kind: 'chat',
        dirKey: '/tmp/a',
        dirLabel: '~/a',
        sessionTitle: 'Hello'
      }),
      pane({
        tabId: 'b1',
        kind: 'bash',
        dirKey: '/tmp/b',
        dirLabel: '~/b',
        paneTitle: 'bash-1',
        sessionTitle: 'Other'
      })
    ])
    assert.deepEqual(
      groups.map((g) => g.dirLabel),
      ['~/a', '~/b']
    )
    assert.equal(trayItemLabel(groups[0]!.panes[0]!), 'New Session - Grok')
    assert.equal(trayItemLabel(groups[0]!.panes[1]!), 'Hello')
    assert.equal(trayItemLabel(groups[1]!.panes[0]!), 'Other · bash-1')
    assert.equal(trayIndentedLabel(trayItemLabel(groups[0]!.panes[1]!)), '\u2003\u2003Hello')
  })

  it('sorts chats newest first inside a directory', () => {
    const groups = groupTrayPanes([
      pane({ tabId: 'old', kind: 'chat', sessionTitle: 'Old', createdAt: 1 }),
      pane({ tabId: 'new', kind: 'chat', sessionTitle: 'New', createdAt: 9 })
    ])
    assert.deepEqual(
      groups[0]!.panes.map((p) => p.tabId),
      ['new', 'old']
    )
  })
})

describe('mergeLiveAndUnseenTrayPanes', () => {
  it('keeps live rows and appends unseen completions that are not already listed', () => {
    const live = [pane({ tabId: 'a1', kind: 'agent' })]
    const unseen = [
      pane({ tabId: 'a1', kind: 'agent' }),
      pane({ tabId: '', kind: 'chat', sessionTitle: 'Done' })
    ]
    const merged = mergeLiveAndUnseenTrayPanes(live, unseen)
    assert.deepEqual(
      merged.map((p) => trayPaneKey(p)),
      ['c1:agent:a1', 'c1:chat:']
    )
  })
})

describe('shouldRecordPtyCompletion', () => {
  it('ignores the first short idle after spawn', () => {
    assert.equal(
      shouldRecordPtyCompletion({ primed: false, runningSince: 1000, now: 1500 }),
      false
    )
  })

  it('records a later running-to-idle as a completed result', () => {
    assert.equal(
      shouldRecordPtyCompletion({ primed: true, runningSince: 8000, now: 8100 }),
      true
    )
  })

  it('records a long first run (command started before first idle)', () => {
    assert.equal(
      shouldRecordPtyCompletion({ primed: false, runningSince: 1000, now: 3000 }),
      true
    )
  })
})
