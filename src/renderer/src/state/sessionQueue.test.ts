import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { omitLiveUsage } from './sessionUsage.ts'
import {
  buildQueuedMessage,
  isEmptyComposerSend,
  mergePreviewAndCommentRefs,
  MESSAGE_QUEUE_MAX
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
})
