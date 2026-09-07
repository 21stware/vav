import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isMediaPreviewKind,
  isMediaPreviewPath,
  shouldArmUnsavedFromExternalChange
} from './previewDirty.ts'

describe('isMediaPreviewPath', () => {
  it('matches common image and media extensions', () => {
    assert.equal(isMediaPreviewPath('/tmp/shot.png'), true)
    assert.equal(isMediaPreviewPath('/tmp/clip.mov'), true)
    assert.equal(isMediaPreviewPath('/tmp/notes.md'), false)
    assert.equal(isMediaPreviewPath('/tmp/deck.pptx'), false)
  })
})

describe('isMediaPreviewKind', () => {
  it('covers image/audio/video only', () => {
    assert.equal(isMediaPreviewKind('image'), true)
    assert.equal(isMediaPreviewKind('audio'), true)
    assert.equal(isMediaPreviewKind('video'), true)
    assert.equal(isMediaPreviewKind('text'), false)
    assert.equal(isMediaPreviewKind('docx'), false)
    assert.equal(isMediaPreviewKind(null), false)
  })
})

describe('shouldArmUnsavedFromExternalChange', () => {
  it('does not dirty a media preview from watcher noise', () => {
    assert.equal(
      shouldArmUnsavedFromExternalChange({
        kind: 'image',
        hadPriorIdentity: false,
        identityChanged: true,
        namedSource: false,
        workingCopyDirty: false
      }),
      false
    )
    assert.equal(
      shouldArmUnsavedFromExternalChange({
        kind: 'image',
        hadPriorIdentity: true,
        identityChanged: true,
        namedSource: true,
        workingCopyDirty: false
      }),
      false
    )
  })

  it('dirties media only when the sandbox copy is actually dirty', () => {
    assert.equal(
      shouldArmUnsavedFromExternalChange({
        kind: 'image',
        hadPriorIdentity: true,
        identityChanged: false,
        namedSource: true,
        workingCopyDirty: true
      }),
      true
    )
  })

  it('ignores first-sighting and same-identity watcher pings for text', () => {
    assert.equal(
      shouldArmUnsavedFromExternalChange({
        kind: 'text',
        hadPriorIdentity: false,
        identityChanged: true,
        namedSource: false,
        workingCopyDirty: false
      }),
      false
    )
    assert.equal(
      shouldArmUnsavedFromExternalChange({
        kind: 'text',
        hadPriorIdentity: true,
        identityChanged: false,
        namedSource: false,
        workingCopyDirty: false
      }),
      false
    )
  })

  it('arms text/office when the agent names the path or bytes moved', () => {
    assert.equal(
      shouldArmUnsavedFromExternalChange({
        kind: 'docx',
        hadPriorIdentity: true,
        identityChanged: false,
        namedSource: true,
        workingCopyDirty: false
      }),
      true
    )
    assert.equal(
      shouldArmUnsavedFromExternalChange({
        kind: 'text',
        hadPriorIdentity: true,
        identityChanged: true,
        namedSource: false,
        workingCopyDirty: false
      }),
      true
    )
  })
})
