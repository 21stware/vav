import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_TRAY_MIN_WORK_MS,
  AGENT_TRAY_QUIET_MS,
  collapseTrayActivity,
  collapseTrayPanesByConversation,
  groupTrayPanes,
  isAgentTrayRunning,
  mergeLiveAndUnseenTrayPanes,
  shouldInferAgentTrayFinish,
  shouldRecordPtyCompletion,
  trayIndentedLabel,
  trayItemLabel,
  trayPaneKey,
  traySessionLabel,
  trayStatusRowLabel,
  trayTitleCounts,
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
  it('groups by workdir and keeps Running / Done on the rows', () => {
    const groups = groupTrayPanes([
      pane({
        tabId: 'b1',
        kind: 'bash',
        status: 'running',
        sessionTitle: 'Term',
        dirKey: '/tmp/b',
        dirLabel: '~/b',
        createdAt: 1
      }),
      pane({
        tabId: 'd1',
        kind: 'chat',
        status: 'done',
        sessionTitle: 'Done',
        dirKey: '/tmp/a',
        dirLabel: '~/a',
        createdAt: 2
      }),
      pane({
        tabId: 'a1',
        kind: 'agent',
        status: 'running',
        sessionTitle: 'Swarm',
        dirKey: '/tmp/a',
        dirLabel: '~/a',
        createdAt: 3
      })
    ])
    assert.deepEqual(
      groups.map((g) => [g.dirLabel, g.panes.map((p) => `${p.status}:${p.sessionTitle}`)]),
      [
        ['~/b', ['running:Term']],
        ['~/a', ['running:Swarm', 'done:Done']]
      ]
    )
  })
})

describe('collapseTrayPanesByConversation', () => {
  it('keeps one thread/swarm row per conversation and leaves running terminals', () => {
    const collapsed = collapseTrayPanesByConversation([
      pane({ tabId: 'b1', kind: 'bash', status: 'running', conversationId: 'c1', paneTitle: 'serve :9989' }),
      pane({ tabId: '', kind: 'chat', status: 'running', conversationId: 'c1' }),
      pane({ tabId: 'a1', kind: 'agent', status: 'done', conversationId: 'c2', sessionTitle: 'Other' })
    ])
    assert.deepEqual(
      collapsed.map((p) => [p.conversationId, p.kind, p.status, p.paneTitle]),
      [
        ['c1', 'chat', 'running', 'VAV'],
        ['c2', 'agent', 'done', 'Grok'],
        ['c1', 'bash', 'running', 'serve :9989']
      ]
    )
  })
})

describe('collapseTrayActivity', () => {
  it('running terminal lifts the conversation LED over a done thread', () => {
    const rows = collapseTrayActivity([
      { conversationId: 'c1', status: 'done' },
      { conversationId: 'c1', status: 'running' }
    ])
    assert.deepEqual(rows, [{ conversationId: 'c1', status: 'running' }])
  })
})

describe('mergeLiveAndUnseenTrayPanes', () => {
  it('keeps live rows and appends unseen completions that are not already listed', () => {
    const live = [pane({ tabId: 'a1', kind: 'agent', status: 'running' })]
    const unseen = [
      pane({ tabId: 'a1', kind: 'agent' }),
      pane({ tabId: '', kind: 'chat', sessionTitle: 'Done' }),
      pane({ tabId: 'b1', kind: 'bash', sessionTitle: 'Term' })
    ]
    const merged = mergeLiveAndUnseenTrayPanes(live, unseen)
    assert.deepEqual(
      merged.map((p) => trayPaneKey(p)),
      ['c1:agent:a1', 'c1:chat:']
    )
    assert.equal(merged[1]!.status, 'done')
  })
})

describe('tray labels', () => {
  it('puts status on the name and keeps the History label', () => {
    const agent = pane({ tabId: 'a1', kind: 'agent', paneTitle: 'Grok', sessionTitle: 'Hello' })
    assert.equal(trayItemLabel(agent), 'Hello - Grok')
    assert.equal(
      trayItemLabel(pane({ tabId: 'b1', kind: 'bash', sessionTitle: 'Hello', paneTitle: 'serve :9989' })),
      'serve :9989'
    )
    assert.equal(traySessionLabel(agent), 'Hello')
    assert.equal(trayStatusRowLabel('Hello', 'running', { running: 'Running', done: 'Done' }), 'Running · Hello')
    assert.equal(trayStatusRowLabel('Hello', 'done', { running: 'Running', done: 'Done' }), 'Done · Hello')
    assert.equal(trayIndentedLabel('Hello'), '\u2003\u2003Hello')
  })

  it('splits the menu-bar title into running·done', () => {
    assert.equal(trayTitleCounts(0, 0), '')
    assert.equal(trayTitleCounts(3, 2), '3·2')
    assert.equal(trayTitleCounts(3, 0), '3·0')
    assert.equal(trayTitleCounts(0, 2), '0·2')
  })
})

describe('isAgentTrayRunning', () => {
  it('treats the first cycle as running while the PTY says so', () => {
    assert.equal(
      isAgentTrayRunning({
        finishedTurn: false,
        ptyStatus: 'running',
        lastDataAt: 0,
        runningSince: 1,
        now: 2
      }),
      true
    )
  })

  it('after a finish, ignores a quiet host process and short TUI redraws', () => {
    assert.equal(
      isAgentTrayRunning({
        finishedTurn: true,
        ptyStatus: 'running',
        lastDataAt: 1000,
        runningSince: 1000,
        now: 5000
      }),
      false
    )
    assert.equal(
      isAgentTrayRunning({
        finishedTurn: true,
        ptyStatus: 'running',
        lastDataAt: 4900,
        runningSince: 4800,
        now: 5000
      }),
      false
    )
  })

  it('after a finish, a sustained new run is Running again', () => {
    assert.equal(
      isAgentTrayRunning({
        finishedTurn: true,
        ptyStatus: 'running',
        lastDataAt: 4900,
        runningSince: 3000,
        now: 5000
      }),
      true
    )
  })

  it('stops counting leftover process-alive after a quiet work window', () => {
    const runningSince = 1_000
    const lastDataAt = runningSince + AGENT_TRAY_MIN_WORK_MS
    assert.equal(
      isAgentTrayRunning({
        finishedTurn: false,
        ptyStatus: 'running',
        lastDataAt,
        runningSince,
        createdAt: runningSince,
        now: lastDataAt + AGENT_TRAY_QUIET_MS
      }),
      false
    )
  })

  it('hides an idle host sitting at the prompt with no real work', () => {
    assert.equal(
      isAgentTrayRunning({
        finishedTurn: false,
        ptyStatus: 'running',
        lastDataAt: 1_200,
        runningSince: 1_000,
        createdAt: 1_000,
        now: 1_200 + AGENT_TRAY_QUIET_MS
      }),
      false
    )
  })
})

describe('shouldInferAgentTrayFinish', () => {
  it('does not finish a spawn paint that then goes quiet', () => {
    assert.equal(
      shouldInferAgentTrayFinish({
        finishedTurn: false,
        lastDataAt: 1_200,
        runningSince: 1_000,
        createdAt: 1_000,
        now: 1_200 + AGENT_TRAY_QUIET_MS
      }),
      false
    )
  })

  it('finishes after a real work window and a quiet gap', () => {
    const runningSince = 1_000
    const lastDataAt = runningSince + AGENT_TRAY_MIN_WORK_MS
    assert.equal(
      shouldInferAgentTrayFinish({
        finishedTurn: false,
        lastDataAt,
        runningSince,
        createdAt: runningSince,
        now: lastDataAt + AGENT_TRAY_QUIET_MS
      }),
      true
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
