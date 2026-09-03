import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TrayPane } from '../../shared/traySessions.ts'
import {
  applyUnseenResultToMap,
  deleteUnseenForConversation,
  persistTrayResultUnseen,
  shouldHydratePersistedUnseen
} from './trayUnseen.ts'

function pane(id: string, extra: Partial<TrayPane> = {}): TrayPane {
  return {
    conversationId: id,
    tabId: 't',
    kind: 'chat',
    sessionTitle: id,
    paneTitle: 'VAV',
    dirKey: '/tmp',
    dirLabel: '~/tmp',
    createdAt: 1,
    ...extra
  }
}

describe('deleteUnseenForConversation', () => {
  it('removes every pane for that conversation', () => {
    const unseen = new Map<string, TrayPane>([
      ['a', pane('c1', { tabId: '1' })],
      ['b', pane('c2')],
      ['c', pane('c1', { tabId: '2' })]
    ])
    assert.equal(deleteUnseenForConversation(unseen, 'c1'), true)
    assert.equal(unseen.size, 1)
    assert.equal([...unseen.values()][0]?.conversationId, 'c2')
  })
})

describe('persistTrayResultUnseen', () => {
  it('skips missing conversations and no-ops when unchanged', () => {
    let broadcasts = 0
    assert.equal(
      persistTrayResultUnseen({
        conversationId: 'c1',
        unseen: true,
        getConversation: () => null,
        updateMeta: () => {},
        broadcast: () => {
          broadcasts++
        }
      }),
      false
    )
    assert.equal(
      persistTrayResultUnseen({
        conversationId: 'c1',
        unseen: true,
        getConversation: () => ({ resultUnseen: true }),
        updateMeta: () => {},
        broadcast: () => {
          broadcasts++
        }
      }),
      false
    )
    assert.equal(broadcasts, 0)
  })

  it('updates meta and broadcasts when the flag flips', () => {
    let patch: { resultUnseen: boolean } | null = null
    let broadcasts = 0
    assert.equal(
      persistTrayResultUnseen({
        conversationId: 'c1',
        unseen: true,
        getConversation: () => ({ resultUnseen: false }),
        updateMeta: (_id, next) => {
          patch = next
        },
        broadcast: () => {
          broadcasts++
        }
      }),
      true
    )
    assert.deepEqual(patch, { resultUnseen: true })
    assert.equal(broadcasts, 1)
  })
})

describe('applyUnseenResultToMap', () => {
  it('ignores ephemeral panes', () => {
    const unseen = new Map<string, TrayPane>()
    const out = applyUnseenResultToMap({
      pane: pane('c1'),
      unseen,
      ephemeral: true,
      isForeground: false
    })
    assert.deepEqual(out, { notifyComplete: false })
    assert.equal(unseen.size, 0)
  })

  it('clears the map when the conversation is foreground', () => {
    const unseen = new Map<string, TrayPane>([['k', pane('c1')]])
    const out = applyUnseenResultToMap({
      pane: pane('c1'),
      unseen,
      ephemeral: false,
      isForeground: true
    })
    assert.deepEqual(out, { persist: false, notifyComplete: false })
    assert.equal(unseen.size, 0)
  })

  it('records background completions', () => {
    const unseen = new Map<string, TrayPane>()
    const p = pane('c1')
    const out = applyUnseenResultToMap({
      pane: p,
      unseen,
      ephemeral: false,
      isForeground: false
    })
    assert.deepEqual(out, { persist: true, notifyComplete: true })
    assert.equal(unseen.size, 1)
  })
})

describe('shouldHydratePersistedUnseen', () => {
  it('hydrates only unseen, unarchived, non-ephemeral rows not already listed', () => {
    assert.equal(
      shouldHydratePersistedUnseen({
        resultUnseen: true,
        archived: false,
        ephemeral: false,
        alreadyListed: false
      }),
      true
    )
    assert.equal(
      shouldHydratePersistedUnseen({
        resultUnseen: true,
        archived: true,
        ephemeral: false,
        alreadyListed: false
      }),
      false
    )
    assert.equal(
      shouldHydratePersistedUnseen({
        resultUnseen: true,
        archived: false,
        ephemeral: false,
        alreadyListed: true
      }),
      false
    )
  })
})
