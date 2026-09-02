import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { imageAttachToast, imageAttachToastState, trimAttachmentPathsForHost } from './sessionAttach.ts'

const clean = {
  paths: ['/a.png'],
  maxCount: 8,
  maxBytes: 5 * 1024 * 1024,
  rejectedUnsupported: 0,
  droppedForLimit: 0,
  rejectedOversize: 0,
  rejectedType: 0
}

describe('sessionAttach', () => {
  it('stays quiet when every image was kept', () => {
    assert.equal(imageAttachToast(clean), null)
  })

  it('prefers oversize, then count, then type', () => {
    assert.deepEqual(
      imageAttachToast({ ...clean, rejectedOversize: 1, droppedForLimit: 2, rejectedType: 1 }),
      { kind: 'info', titleKey: 'composer.imageTooLarge', mb: 5 }
    )
    assert.deepEqual(imageAttachToast({ ...clean, droppedForLimit: 2 }), {
      kind: 'info',
      titleKey: 'composer.imagesTooMany',
      max: 8
    })
    assert.deepEqual(imageAttachToast({ ...clean, rejectedType: 1 }), {
      kind: 'info',
      titleKey: 'composer.imageTypeUnsupported'
    })
    assert.deepEqual(
      imageAttachToastState({ ...clean, droppedForLimit: 2 }, (key, params) =>
        params ? `${key}:${params.max}` : key
      ),
      { kind: 'info', title: 'composer.imagesTooMany:8' }
    )
  })

  it('trims existing attachments when the host cap is lower', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/img-${i}.png`)
    assert.equal(trimAttachmentPathsForHost(paths.slice(0, 2), 'vav'), null)
    const trimmed = trimAttachmentPathsForHost(paths, 'vav')
    assert.equal(trimmed?.paths.length, 8)
    assert.equal(trimmed?.plan.droppedForLimit, 4)
  })
})
