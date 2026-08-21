import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extensionForImageMime,
  imageInputForChatHost,
  isImageAttachmentPath,
  mergeImageAttachments,
  mimeFromImagePath,
  modelAcceptsImageInput
} from './agentImageInput.ts'

describe('imageInputForChatHost', () => {
  it('gives VAV and known CLI hosts an image cap', () => {
    const vav = imageInputForChatHost(null)
    const claude = imageInputForChatHost('claude')
    assert.ok(vav && vav.maxCount >= 1)
    assert.ok(claude && claude.maxCount >= vav.maxCount)
    assert.equal(imageInputForChatHost('not-a-host'), null)
  })
})

describe('modelAcceptsImageInput', () => {
  it('is false for VAV DeepSeek and unknown VAV models', () => {
    assert.equal(modelAcceptsImageInput(null, 'deepseek-v4-pro'), false)
    assert.equal(modelAcceptsImageInput('vav', 'deepseek-v4-flash'), false)
    assert.equal(modelAcceptsImageInput(null, 'my-local-7b'), false)
  })

  it('is true for DeepSeek vision ids', () => {
    assert.equal(modelAcceptsImageInput(null, 'deepseek-v4-flash-vision-exp'), true)
  })

  it('trusts a live input list over the id heuristic', () => {
    assert.equal(
      modelAcceptsImageInput('vav', 'deepseek-v4-flash', { input: ['text', 'image'] }),
      true
    )
    assert.equal(
      modelAcceptsImageInput('vav', 'deepseek-v4-flash-vision-exp', { input: ['text'] }),
      false
    )
  })

  it('is true for known vision models and default CLI', () => {
    assert.equal(modelAcceptsImageInput(null, 'gpt-4o'), true)
    assert.equal(modelAcceptsImageInput(null, 'claude-sonnet-4-20250514'), true)
    assert.equal(modelAcceptsImageInput('claude', 'sonnet'), true)
    assert.equal(modelAcceptsImageInput('claude', ''), true)
    assert.equal(modelAcceptsImageInput('unknown-cli', 'foo'), false)
  })
})

describe('image path helpers', () => {
  it('detects image extensions case-insensitively', () => {
    assert.equal(isImageAttachmentPath('/tmp/shot.PNG'), true)
    assert.equal(isImageAttachmentPath('C:\\shots\\a.WebP'), true)
    assert.equal(isImageAttachmentPath('/tmp/notes.md'), false)
    assert.equal(mimeFromImagePath('/tmp/a.jpeg'), 'image/jpeg')
    assert.equal(extensionForImageMime('image/png;charset=utf-8'), 'png')
  })
})

describe('mergeImageAttachments', () => {
  it('still keeps images when capability is omitted (preview-only hosts)', () => {
    const plan = mergeImageAttachments({
      existing: ['/a.md', '/b.png'],
      incoming: ['/c.png', '/d.txt'],
      capability: null
    })
    assert.deepEqual(plan.paths, ['/a.md', '/d.txt', '/b.png', '/c.png'])
    assert.equal(plan.rejectedUnsupported, 0)
  })

  it('caps incoming images and keeps earlier ones', () => {
    const plan = mergeImageAttachments({
      existing: ['/1.png', '/2.png'],
      incoming: ['/3.png', '/4.png'],
      capability: { maxCount: 3, maxBytes: 1000, mime: ['image/png'] }
    })
    assert.deepEqual(plan.paths, ['/1.png', '/2.png', '/3.png'])
    assert.equal(plan.droppedForLimit, 1)
  })

  it('rejects oversized incoming images', () => {
    const plan = mergeImageAttachments({
      existing: [],
      incoming: ['/big.png', '/ok.png'],
      capability: { maxCount: 4, maxBytes: 10, mime: ['image/png'] },
      sizes: { '/big.png': 11, '/ok.png': 9 }
    })
    assert.deepEqual(plan.paths, ['/ok.png'])
    assert.equal(plan.rejectedOversize, 1)
  })

  it('rejects disallowed image types', () => {
    const plan = mergeImageAttachments({
      existing: [],
      incoming: ['/a.bmp'],
      capability: { maxCount: 4, maxBytes: 1000, mime: ['image/png'] }
    })
    assert.equal(plan.paths.length, 0)
    assert.equal(plan.rejectedType, 1)
  })

  it('dedupes and does not count an existing image against incoming twice', () => {
    const plan = mergeImageAttachments({
      existing: ['/a.png'],
      incoming: ['/a.png', '/b.png'],
      capability: { maxCount: 2, maxBytes: 1000, mime: ['image/png'] }
    })
    assert.deepEqual(plan.paths, ['/a.png', '/b.png'])
    assert.equal(plan.droppedForLimit, 0)
  })
})
