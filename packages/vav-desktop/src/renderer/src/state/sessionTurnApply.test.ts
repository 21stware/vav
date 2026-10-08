import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { ChatMessage, ConversationMeta, TurnEvent } from '@shared/types.ts'
import { applySessionTurnEvent, IDLE_TURN, type TurnApplyState } from './sessionTurnApply.ts'
import { disposeProjection, getProjection } from './StreamProjection.ts'

const ID = 'c-recovery'

function emptyState(): TurnApplyState {
  return {
    conversations: [{ id: ID, model: 'grok-4.6', cliHost: 'cursor' } as ConversationMeta],
    turns: {},
    liveUsage: {},
    messages: {},
    activeLeaf: {},
    tokenHistories: {},
    cacheCreatedAt: {},
    cacheExpiresAt: {},
    pendingReviewByConversation: {},
    changeSetsById: {},
    changeSet: null,
    changeReviewId: null,
    errorBanner: null,
    errorBannerKind: null,
    errorBannerDetail: null
  }
}

function harness() {
  let state = emptyState()
  const get = (): TurnApplyState => state
  const set = (
    partial: Partial<TurnApplyState> | ((s: TurnApplyState) => Partial<TurnApplyState>)
  ): void => {
    const next = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...next }
  }
  return {
    get,
    set,
    refreshConversations: (): void => {},
    drainQueue: (): void => {},
    openChangeReview: (): void => {},
    resyncMessages: undefined as ((id: string) => void) | undefined
  }
}

function apply(event: TurnEvent, ctx = harness()) {
  applySessionTurnEvent(event, ctx)
  return ctx
}

function assistant(partial: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'asst-1',
    parentId: 'user-1',
    role: 'assistant',
    content: partial.content ?? '',
    blocks: partial.blocks ?? [],
    createdAt: 1,
    ...partial
  }
}

afterEach(() => {
  disposeProjection(ID)
})

describe('applySessionTurnEvent recovery chrome', () => {
  it('start clears recovery and previous error banner', () => {
    const ctx = harness()
    ctx.set({
      turns: {
        [ID]: {
          ...IDLE_TURN,
          isRunning: true,
          phase: 'reconnecting',
          recovery: { kind: 'reconnecting', attempt: 2, limit: 3 }
        }
      },
      errorBanner: 'old',
      errorBannerKind: 'network',
      errorBannerDetail: 'ECONNRESET'
    })
    apply({ type: 'start', conversationId: ID }, ctx)
    const turn = ctx.get().turns[ID]
    assert.equal(turn?.isRunning, true)
    assert.equal(turn?.phase, 'thinking')
    assert.equal(turn?.recovery, null)
    assert.equal(ctx.get().errorBanner, null)
    assert.equal(ctx.get().errorBannerKind, null)
    const snap = getProjection(ID).getSnapshot()
    assert.equal(snap.active, true)
    assert.equal(snap.phase, 'thinking')
    assert.equal(snap.recovery, null)
  })

  it('phase events copy retrying / reconnecting / healing onto turn and projection', () => {
    const ctx = apply({ type: 'start', conversationId: ID })
    apply(
      {
        type: 'phase',
        conversationId: ID,
        phase: 'reconnecting',
        recovery: { kind: 'reconnecting', attempt: 1, limit: 3 }
      },
      ctx
    )
    assert.equal(ctx.get().turns[ID]?.phase, 'reconnecting')
    assert.deepEqual(ctx.get().turns[ID]?.recovery, {
      kind: 'reconnecting',
      attempt: 1,
      limit: 3
    })
    assert.equal(getProjection(ID).getSnapshot().phase, 'reconnecting')
    assert.deepEqual(getProjection(ID).getSnapshot().recovery, {
      kind: 'reconnecting',
      attempt: 1,
      limit: 3
    })

    apply(
      {
        type: 'phase',
        conversationId: ID,
        phase: 'healing',
        recovery: { kind: 'healing', attempt: 1, limit: 3 }
      },
      ctx
    )
    assert.equal(ctx.get().turns[ID]?.phase, 'healing')
    assert.equal(getProjection(ID).getSnapshot().phase, 'healing')

    apply({ type: 'phase', conversationId: ID, phase: 'outputting' }, ctx)
    assert.equal(ctx.get().turns[ID]?.phase, 'outputting')
    assert.equal(ctx.get().turns[ID]?.recovery, null)
    assert.equal(getProjection(ID).getSnapshot().recovery, null)
  })

  it('end returns the turn to idle and keeps a friendly network error on the message', () => {
    const ctx = apply({ type: 'start', conversationId: ID })
    apply(
      {
        type: 'phase',
        conversationId: ID,
        phase: 'retrying',
        recovery: { kind: 'retrying', attempt: 3, limit: 3 }
      },
      ctx
    )
    const message = assistant({
      content: '',
      errorText: 'A network error interrupted this turn.',
      errorDetail: 'ECONNRESET'
    })
    apply(
      {
        type: 'end',
        conversationId: ID,
        message,
        tokensUsed: 12,
        error: 'A network error interrupted this turn.',
        errorKind: 'network',
        errorDetail: 'ECONNRESET'
      },
      ctx
    )
    assert.deepEqual(ctx.get().turns[ID], IDLE_TURN)
    assert.equal(getProjection(ID).getSnapshot().active, false)
    const stored = ctx.get().messages[ID]?.at(-1)
    assert.equal(stored?.errorText, 'A network error interrupted this turn.')
    // Message already carries the error — do not also raise a banner.
    assert.equal(ctx.get().errorBanner, null)
  })

  it('keeps the live reply when the control plane sends an empty done frame', () => {
    const ctx = apply({ type: 'start', conversationId: ID })
    getProjection(ID).appendReasoning(0, '查一下金价')
    getProjection(ID).getSnapshot()
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({ id: `remote-end-${ID}`, parentId: null, content: '', blocks: [] }),
        tokensUsed: 0
      },
      ctx
    )
    // Settled: still on screen (no live chrome), never inserted as a root.
    assert.equal(getProjection(ID).getSnapshot().active, false)
    assert.equal(getProjection(ID).getSnapshot().settled, true)
    assert.equal(getProjection(ID).getSnapshot().blocks.length, 1)
    assert.equal(ctx.get().messages[ID], undefined)
    assert.equal(ctx.get().activeLeaf[ID], undefined)
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({
          content: '金价这周在涨。',
          blocks: [{ kind: 'text', text: '金价这周在涨。' }]
        }),
        tokensUsed: 3
      },
      ctx
    )
    assert.equal(getProjection(ID).getSnapshot().active, false)
    assert.equal(getProjection(ID).getSnapshot().settled, false)
    assert.equal(ctx.get().messages[ID]?.at(-1)?.content, '金价这周在涨。')
    assert.equal(ctx.get().activeLeaf[ID], 'asst-1')
  })

  it('end does not persist an empty cancelled leaf', () => {
    const ctx = apply({ type: 'start', conversationId: ID })
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({ content: '', cancelled: true }),
        tokensUsed: 0,
        cancelled: true
      },
      ctx
    )
    assert.deepEqual(ctx.get().turns[ID], IDLE_TURN)
    assert.equal(getProjection(ID).getSnapshot().active, false)
    assert.equal(ctx.get().messages[ID], undefined)
  })

  it('keeps the streamed output on screen when Stop seals nothing', () => {
    const ctx = apply({ type: 'start', conversationId: ID })
    getProjection(ID).appendText(0, 'half an answer')
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({ content: '', cancelled: true }),
        tokensUsed: 0,
        cancelled: true
      },
      ctx
    )
    const snap = getProjection(ID).getSnapshot()
    assert.equal(snap.settled, true)
    assert.equal(snap.phase, 'idle')
    assert.equal(snap.blocks[0]?.kind, 'text')
    assert.deepEqual(ctx.get().turns[ID], IDLE_TURN)
    assert.equal(ctx.get().messages[ID], undefined)
    // The next prompt clears the stand-in.
    apply({ type: 'user', conversationId: ID, message: { ...assistant(), id: 'u2', role: 'user', parentId: null } }, ctx)
    assert.equal(getProjection(ID).getSnapshot().settled, false)
  })

  it('never inserts a synthetic control-plane error frame as a second root', () => {
    const ctx = harness()
    let resynced = 0
    ctx.resyncMessages = () => {
      resynced += 1
    }
    const user: ChatMessage = { ...assistant(), id: 'user-1', role: 'user', parentId: null, content: 'hi' }
    apply({ type: 'user', conversationId: ID, message: user }, ctx)
    apply({ type: 'start', conversationId: ID }, ctx)
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({ id: `remote-end-${ID}`, parentId: null, errorText: 'boom' }),
        tokensUsed: 0,
        error: 'boom',
        errorKind: 'generic'
      },
      ctx
    )
    assert.deepEqual(ctx.get().messages[ID]?.map((m) => m.id), ['user-1'])
    assert.equal(ctx.get().activeLeaf[ID], 'user-1')
    assert.equal(ctx.get().errorBanner, 'boom')
    assert.equal(resynced, 1)
  })

  it('asks for a resync when a reply arrives whose prompt this window never saw', () => {
    const ctx = harness()
    let resynced = 0
    ctx.resyncMessages = () => {
      resynced += 1
    }
    apply({ type: 'start', conversationId: ID }, ctx)
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({ content: 'done', blocks: [{ kind: 'text', text: 'done' }] }),
        tokensUsed: 1
      },
      ctx
    )
    assert.equal(resynced, 1)
  })

  it('hangs an optimistic phone prompt off the thread and swaps it for the real one', () => {
    const ctx = harness()
    const first: ChatMessage = { ...assistant(), id: 'user-1', role: 'user', parentId: null, content: 'q1' }
    apply({ type: 'user', conversationId: ID, message: first }, ctx)
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({ content: 'a1', blocks: [{ kind: 'text', text: 'a1' }] }),
        tokensUsed: 1
      },
      ctx
    )
    const optimistic: ChatMessage = { ...first, id: 'local-user-9', content: 'q2', parentId: null }
    apply({ type: 'user', conversationId: ID, message: optimistic }, ctx)
    assert.equal(ctx.get().messages[ID]?.find((m) => m.id === 'local-user-9')?.parentId, 'asst-1')
    apply({ type: 'user', conversationId: ID, message: { ...optimistic, id: 'user-2', parentId: 'asst-1' } }, ctx)
    assert.deepEqual(ctx.get().messages[ID]?.map((m) => m.id), ['user-1', 'asst-1', 'user-2'])
  })

  it('end without message.errorText raises a technical banner', () => {
    const ctx = apply({ type: 'start', conversationId: ID })
    apply(
      {
        type: 'end',
        conversationId: ID,
        message: assistant({ content: '' }),
        tokensUsed: 0,
        error: 'Temporary fault. Please send again.',
        errorKind: 'technical',
        errorDetail: 'WritableIterable is closed'
      },
      ctx
    )
    assert.equal(ctx.get().errorBanner, 'Temporary fault. Please send again.')
    assert.equal(ctx.get().errorBannerKind, 'technical')
    assert.equal(ctx.get().errorBannerDetail, 'WritableIterable is closed')
  })
})
