import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groupTrayPanes, trayItemLabel, type TrayPane } from './traySessions.ts'

function pane(partial: Partial<TrayPane> & Pick<TrayPane, 'tabId' | 'kind'>): TrayPane {
  return {
    conversationId: 'c1',
    sessionTitle: 'New Session',
    paneTitle: partial.kind === 'agent' ? 'Grok' : 'bash-1',
    dirKey: '/tmp/a',
    dirLabel: '~/a',
    createdAt: 1,
    ...partial
  }
}

describe('groupTrayPanes', () => {
  it('puts agents above bash inside a directory', () => {
    const groups = groupTrayPanes([
      pane({ tabId: 'b1', kind: 'bash', paneTitle: 'bash-1', createdAt: 1 }),
      pane({ tabId: 'a1', kind: 'agent', paneTitle: 'Grok', createdAt: 2 }),
      pane({ tabId: 'b2', kind: 'bash', paneTitle: 'bash-2', createdAt: 3 })
    ])
    assert.equal(groups.length, 1)
    assert.deepEqual(
      groups[0]!.panes.map((p) => p.tabId),
      ['a1', 'b1', 'b2']
    )
  })

  it('keeps directory order and labels items without repeating the path', () => {
    const groups = groupTrayPanes([
      pane({ tabId: 'a1', kind: 'agent', dirKey: '/tmp/a', dirLabel: '~/a', paneTitle: 'Grok' }),
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
    assert.equal(trayItemLabel(groups[1]!.panes[0]!), 'Other · bash-1')
  })
})
