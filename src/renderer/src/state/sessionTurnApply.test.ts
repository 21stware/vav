import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { ChatMessage, ConversationMeta, TurnEvent } from '../../../shared/types.ts'
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
    openChangeReview: (): void => {}
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
