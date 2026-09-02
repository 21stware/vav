import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { omitLiveUsage } from './sessionUsage.ts'
import {
  buildQueuedMessage,
  composerSendDisposition,
  composerClearedPatch,
  isEmptyComposerSend,
  mergePreviewAndCommentRefs,
  MESSAGE_QUEUE_MAX,
  shouldDrainMessageQueue
} from './sessionQueue.ts'

describe('omitLiveUsage', () => {
  it('drops one conversation without allocating when the id is missing', () => {
    const live = { a: { tokensUsed: 1 }, b: { tokensUsed: 2 } }
    assert.equal(omitLiveUsage(live, 'missing'), live)
    assert.deepEqual(omitLiveUsage(live, 'a'), { b: { tokensUsed: 2 } })
  })
})

describe('MESSAGE_QUEUE_MAX', () => {
  it('caps pending composer sends at 20', () => {
    assert.equal(MESSAGE_QUEUE_MAX, 20)
  })
})

describe('composer send helpers', () => {
  it('treats whitespace-only composer input as empty', () => {
    assert.equal(isEmptyComposerSend('  ', [], [], []), true)
    assert.equal(isEmptyComposerSend('', ['/a.png'], [], []), false)
    assert.equal(isEmptyComposerSend('', [], [{ id: 'r' }], []), false)
    assert.equal(isEmptyComposerSend('', [], [], [{ ref: { id: 'c' } }]), false)
  })

  it('lets commented refs replace chips with the same id', () => {
    const chip = { id: 'a', filePath: '/a.ts', label: 'chip', startLine: 1, endLine: 1, text: 'x' }
    const cardRef = { ...chip, label: 'card' }
    const merged = mergePreviewAndCommentRefs([chip], [{ ref: cardRef, comment: ' note ' }])
    assert.equal(merged.length, 1)
    assert.equal(merged[0]?.comment, 'note')
    assert.equal(merged[0]?.label, 'card')
  })

  it('snapshots queue items so later composer edits cannot mutate them', () => {
    const attachments = ['/a.png']
    const item = buildQueuedMessage({
      text: '  hi  ',
      attachments,
      previewRefs: [],
      commentCards: [],
      quote: null,
      contextFile: '/a.ts',
      now: 1,
      id: 'q-fixed'
    })
    attachments.push('/b.png')
    assert.equal(item.id, 'q-fixed')
    assert.equal(item.text, 'hi')
    assert.deepEqual(item.attachments, ['/a.png'])
    assert.equal(item.createdAt, 1)
  })

  it('classifies empty / parked / key / queue / send', () => {
    const base = {
      empty: false,
      awaitingTool: false,
      needsApiKey: false,
      isRunning: false,
      queueLength: 0
    }
    assert.equal(composerSendDisposition({ ...base, empty: true }), 'empty')
    assert.equal(composerSendDisposition({ ...base, awaitingTool: true }), 'awaiting')
    assert.equal(composerSendDisposition({ ...base, needsApiKey: true }), 'need-key')
    assert.equal(composerSendDisposition({ ...base, isRunning: true, queueLength: 0 }), 'enqueue')
    assert.equal(
      composerSendDisposition({ ...base, isRunning: true, queueLength: MESSAGE_QUEUE_MAX }),
      'full'
    )
    assert.equal(composerSendDisposition(base), 'send')
  })

  it('drains FIFO only when idle, queued, and send-now is not in flight', () => {
    assert.equal(
      shouldDrainMessageQueue({ sendNowInFlight: true, queueLength: 1 }),
      false
    )
    assert.equal(
      shouldDrainMessageQueue({ sendNowInFlight: false, isRunning: true, queueLength: 1 }),
      false
    )
    assert.equal(
      shouldDrainMessageQueue({
        sendNowInFlight: false,
        awaitingToolCallId: 't1',
        queueLength: 1
      }),
      false
    )
    assert.equal(
      shouldDrainMessageQueue({ sendNowInFlight: false, queueLength: 0 }),
      false
    )
    assert.equal(
      shouldDrainMessageQueue({ sendNowInFlight: false, queueLength: 1 }),
      true
    )
  })

  it('clears composer fields for one conversation without dropping others', () => {
    const patch = composerClearedPatch(
      {
        drafts: { a: 'hello', b: 'keep' },
        attachments: { a: ['/x'] },
        quotes: { a: { messageId: 'm', summary: 'q' } },
        previewRefs: { a: [{ id: 'r', filePath: '/a.ts' }] },
        commentCards: { a: [{ ref: { id: 'c', filePath: '/a.ts' }, comment: 'n' }] }
      },
      'a'
    )
    assert.equal(patch.drafts.a, '')
    assert.equal(patch.drafts.b, 'keep')
    assert.deepEqual(patch.attachments.a, [])
    assert.equal(patch.quotes.a, null)
    assert.deepEqual(patch.previewRefs.a, [])
    assert.deepEqual(patch.commentCards.a, [])
    assert.equal(patch.errorBanner, null)
  })
})
