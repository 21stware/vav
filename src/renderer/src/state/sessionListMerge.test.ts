import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeConversationList, nextConversationSelection, patchConversationById, isArchivedConversation, regenerateActiveLeaf, canMutateActiveSession, compactRefusalReason, genericErrorBanner, shouldSkipSessionDeleteConfirm, fallbackConversationIdAfterDelete, sessionDeleteDialogCopy, prependConversationIfMissing, upsertConversationMeta, listedConversationIdsForSelect, fileSessionHydrateOnDemandPatch, deleteMessageHydratePatch, renameConversationPatch, type ConversationListItem } from './sessionListMerge.ts'

function row(
  partial: Partial<ConversationListItem> & { id: string }
): ConversationListItem {
  return {
    updatedAt: 1,
    pinned: false,
    pinTime: null,
    archived: false,
    archivedAt: null,
    ...partial
  }
}

describe('mergeConversationList', () => {
  it('keeps previous order when only titles change', () => {
    const prev = [row({ id: 'a', updatedAt: 2 }), row({ id: 'b', updatedAt: 1 })]
    const next = [row({ id: 'b', updatedAt: 1 }), row({ id: 'a', updatedAt: 2 })]
    assert.deepEqual(
      mergeConversationList(prev, next).map((c) => c.id),
      ['a', 'b']
    )
  })

  it('re-sorts when updatedAt changes and keeps hydrated file sessions', () => {
    const prev = [
      row({ id: 'old', updatedAt: 3 }),
      row({ id: 'file', updatedAt: 0, fileId: 'f1' })
    ]
    const next = [row({ id: 'old', updatedAt: 4 }), row({ id: 'new', updatedAt: 5 })]
    assert.deepEqual(
      mergeConversationList(prev, next).map((c) => c.id),
      ['new', 'old', 'file']
    )
  })
})

describe('patchConversationById', () => {
  it('patches one row in place and supports an updater', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', pinned: true })]
    const patched = patchConversationById(rows, 'b', { pinned: false })
    assert.equal(patched[0], rows[0])
    assert.equal(patched[1]?.pinned, false)
    const updated = patchConversationById(rows, 'a', (c) => ({ ...c, archived: true }))
    assert.equal(updated[0]?.archived, true)
    assert.equal(updated[1], rows[1])
  })
})

describe('nextConversationSelection', () => {
  it('toggles additive, never empties, and fills a shift-range', () => {
    assert.deepEqual(
      nextConversationSelection({
        id: 'b',
        selectedIds: ['a'],
        activeId: 'a',
        additive: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['a', 'b']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'a',
        selectedIds: ['a'],
        activeId: 'a',
        additive: true,
        listedIds: ['a', 'b']
      }),
      ['a']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'c',
        selectedIds: ['a'],
        activeId: 'a',
        range: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['a', 'b', 'c']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'c',
        selectedIds: ['b'],
        activeId: 'gone',
        range: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['b', 'c']
    )
    assert.deepEqual(
      nextConversationSelection({
        id: 'c',
        selectedIds: ['x'],
        activeId: 'gone',
        range: true,
        listedIds: ['a', 'b', 'c']
      }),
      ['c']
    )
  })
})

describe('isArchivedConversation', () => {
  it('is true only for a matching archived id', () => {
    const rows = [row({ id: 'a', archived: true }), row({ id: 'b' })]
    assert.equal(isArchivedConversation(rows, 'a'), true)
    assert.equal(isArchivedConversation(rows, 'b'), false)
    assert.equal(isArchivedConversation(rows, 'missing'), false)
    assert.equal(isArchivedConversation(rows, null), false)
    assert.equal(isArchivedConversation(rows, ''), false)
  })
})

describe('regenerateActiveLeaf', () => {
  it('drops an assistant reply to its parent and keeps a user message', () => {
    assert.equal(
      regenerateActiveLeaf({ role: 'assistant', id: 'a1', parentId: 'u1' }),
      'u1'
    )
    assert.equal(
      regenerateActiveLeaf({ role: 'user', id: 'u1', parentId: null }),
      'u1'
    )
  })
})

describe('canMutateActiveSession', () => {
  it('rejects missing, archived, and running sessions', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', archived: true })]
    assert.equal(canMutateActiveSession(null, rows), false)
    assert.equal(canMutateActiveSession('b', rows), false)
    assert.equal(canMutateActiveSession('a', rows, { isRunning: true }), false)
    assert.equal(canMutateActiveSession('a', rows), true)
  })

  it('allows a running session when idle is not required', () => {
    const rows = [row({ id: 'a' })]
    assert.equal(canMutateActiveSession('a', rows, { isRunning: true, requireIdle: false }), true)
  })
})

describe('compactRefusalReason', () => {
  it('refuses busy before CLI-hosted, and skips busy when clearing compaction', () => {
    assert.equal(compactRefusalReason({ isRunning: true, cliHost: 'cursor' }), 'busy')
    assert.equal(compactRefusalReason({ cliHost: 'cursor' }), 'cli-host')
    assert.equal(
      compactRefusalReason({ isRunning: true, cliHost: 'cursor', requireIdle: false }),
      'cli-host'
    )
    assert.equal(compactRefusalReason({}), null)
  })
})

describe('shouldSkipSessionDeleteConfirm', () => {
  it('skips only a lone empty chat', () => {
    assert.equal(shouldSkipSessionDeleteConfirm(1, 1), true)
    assert.equal(shouldSkipSessionDeleteConfirm(2, 2), false)
    assert.equal(shouldSkipSessionDeleteConfirm(1, 0), false)
  })
})

describe('genericErrorBanner', () => {
  it('mirrors the message into kind and detail', () => {
    assert.deepEqual(genericErrorBanner('nope'), {
      errorBanner: 'nope',
      errorBannerKind: 'generic',
      errorBannerDetail: 'nope'
    })
  })
})

describe('fallbackConversationIdAfterDelete', () => {
  it('prefers a live chat over archived and file rows', () => {
    assert.equal(
      fallbackConversationIdAfterDelete([
        { id: 'arch', archived: true },
        { id: 'file', fileId: 'f1' },
        { id: 'live' }
      ]),
      'live'
    )
    assert.equal(fallbackConversationIdAfterDelete([{ id: 'only', archived: true }]), 'only')
    assert.equal(fallbackConversationIdAfterDelete([]), undefined)
  })
})

describe('sessionDeleteDialogCopy', () => {
  it('uses the session title for one target and a count for many', () => {
    const t = (key: string, params?: { count?: number; name?: string }) =>
      params ? `${key}:${params.name ?? params.count}` : key
    assert.deepEqual(sessionDeleteDialogCopy(['a'], [{ id: 'a', title: 'Alpha' }], t), {
      title: 'dialog.deleteSession',
      body: 'dialog.deleteConfirmSingle:Alpha'
    })
    assert.deepEqual(sessionDeleteDialogCopy(['a', 'b'], [{ id: 'a', title: 'Alpha' }], t), {
      title: 'dialog.deleteSessions:2',
      body: 'dialog.deleteConfirmMultiple:2'
    })
  })
})

describe('prependConversationIfMissing / upsertConversationMeta', () => {
  it('prepends a new id and merges an existing one', () => {
    const a = row({ id: 'a', updatedAt: 1 })
    const b = row({ id: 'b', updatedAt: 2 })
    assert.deepEqual(
      prependConversationIfMissing([a], b).map((c) => c.id),
      ['b', 'a']
    )
    assert.equal(prependConversationIfMissing([a], a)[0], a)
    const merged = upsertConversationMeta([a], { ...a, updatedAt: 9 })
    assert.equal(merged[0]?.updatedAt, 9)
    assert.deepEqual(
      upsertConversationMeta([a], b).map((c) => c.id),
      ['b', 'a']
    )
  })
})

describe('listedConversationIdsForSelect', () => {
  it('returns live chat ids, or archive ids when the target is archived', () => {
    const rows = [
      row({ id: 'live' }),
      row({ id: 'arch', archived: true }),
      row({ id: 'file', fileId: 'f1' }),
      row({ id: 'arch-file', archived: true, fileId: 'f2' })
    ]
    assert.deepEqual(listedConversationIdsForSelect(rows, false), ['live'])
    assert.deepEqual(listedConversationIdsForSelect(rows, undefined), ['live'])
    assert.deepEqual(listedConversationIdsForSelect(rows, true), ['arch'])
  })
})

describe('fileSessionHydrateOnDemandPatch', () => {
  it('prepends meta and fills maps without touching cacheCreatedAt', () => {
    const existing = row({ id: 'live' })
    const meta = row({ id: 'file', fileId: 'f1' })
    const state = {
      conversations: [existing],
      messages: { live: [{ id: 'm1' }] },
      messagesHydrated: { live: true },
      activeLeaf: { live: 'leaf-1' },
      compactions: { live: [{ id: 'c1' }] },
      tokenHistories: { live: [{ n: 1 }] },
      cacheExpiresAt: { live: 9 },
      cacheCreatedAt: { live: 1 }
    }
    const next = fileSessionHydrateOnDemandPatch(state, 'file', {
      meta,
      messages: [{ id: 'm2' }],
      activeLeafId: 'leaf-2',
      compactions: [{ id: 'c2' }],
      tokenHistory: [{ n: 2 }],
      cacheExpiresAt: 11
    })
    assert.deepEqual(
      next.conversations.map((c) => c.id),
      ['file', 'live']
    )
    assert.deepEqual(next.messages.file, [{ id: 'm2' }])
    assert.equal(next.messagesHydrated.file, true)
    assert.equal(next.activeLeaf.file, 'leaf-2')
    assert.deepEqual(next.compactions.file, [{ id: 'c2' }])
    assert.deepEqual(next.tokenHistories.file, [{ n: 2 }])
    assert.equal(next.cacheExpiresAt.file, 11)
    assert.equal('cacheCreatedAt' in next, false)
    assert.equal(
      fileSessionHydrateOnDemandPatch(state, 'live', {
        meta: existing,
        messages: [{ id: 'keep' }],
        activeLeafId: 'leaf-1'
      }).conversations[0],
      existing
    )
  })
})

describe('deleteMessageHydratePatch', () => {
  it('stamps the surviving tree and marks the session hydrated', () => {
    const live = row({ id: 'live', updatedAt: 2 })
    const next = deleteMessageHydratePatch(
      {
        conversations: [row({ id: 'live', updatedAt: 1 })],
        messages: { live: [{ id: 'old' }] },
        messagesHydrated: { live: false },
        activeLeaf: { live: 'old' }
      },
      'live',
      {
        conversations: [live],
        messages: [{ id: 'kept' }],
        activeLeafId: 'kept'
      }
    )
    assert.equal(next.conversations[0]?.updatedAt, 2)
    assert.deepEqual(next.messages.live, [{ id: 'kept' }])
    assert.equal(next.messagesHydrated.live, true)
    assert.equal(next.activeLeaf.live, 'kept')
  })
})

describe('renameConversationPatch', () => {
  it('merges listMeta and clears renamingId', () => {
    const next = renameConversationPatch(
      { conversations: [row({ id: 'a', updatedAt: 1 })] },
      [row({ id: 'a', updatedAt: 2 })]
    )
    assert.equal(next.conversations[0]?.updatedAt, 2)
    assert.equal(next.renamingId, null)
  })
})
