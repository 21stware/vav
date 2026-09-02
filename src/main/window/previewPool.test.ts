import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clampPreviewWidth, nextUnfocusedPreviewPath, PREVIEW_MAX_OPEN, previewCloseDisposition, previewPathKey, previewQuery, shouldParkIdlePreview } from './previewPool.ts'

describe('previewPool', () => {
  it('clamps to the display and picks the first unfocused other path', () => {
    assert.equal(clampPreviewWidth(880, 800), 760)
    assert.equal(PREVIEW_MAX_OPEN, 6)
    const win = (focused: boolean, destroyed = false) => ({
      isDestroyed: () => destroyed,
      isFocused: () => focused
    })
    const entries: [string, ReturnType<typeof win>][] = [
      ['/keep.ts', win(true)],
      ['/gone.ts', win(false, true)],
      ['/old.ts', win(false)]
    ]
    assert.equal(nextUnfocusedPreviewPath(entries, '/keep.ts'), '/old.ts')
    assert.equal(nextUnfocusedPreviewPath([['/keep.ts', win(true)]], '/keep.ts'), null)
    assert.deepEqual(previewQuery('/tmp/a.ts', { conversationId: 'c1', requestedAt: 9 }), {
      view: 'file-preview',
      path: '/tmp/a.ts',
      origin: 'session',
      conversationId: 'c1',
      requestedAt: '9'
    })
    assert.equal(
      previewPathKey(' /tmp/a.ts ', {
        exists: (p) => p === '/tmp/a.ts',
        realpath: () => '/real/a.ts'
      }),
      '/real/a.ts'
    )
    assert.equal(previewPathKey('  ', { exists: () => true, realpath: () => '/x' }), '')
  })

  it('parks unfocused unguarded previews and classifies close', () => {
    assert.equal(
      shouldParkIdlePreview({ destroyed: false, focused: false, guarded: false }),
      true
    )
    assert.equal(
      shouldParkIdlePreview({ destroyed: false, focused: true, guarded: false }),
      false
    )
    assert.equal(
      shouldParkIdlePreview({ destroyed: false, focused: false, guarded: true }),
      false
    )
    assert.equal(
      previewCloseDisposition({
        quitting: true,
        fullscreenCloseAllowed: false,
        hasUnsavedGuard: true
      }),
      'destroy'
    )
    assert.equal(
      previewCloseDisposition({
        quitting: false,
        fullscreenCloseAllowed: true,
        hasUnsavedGuard: false
      }),
      'destroy'
    )
    assert.equal(
      previewCloseDisposition({
        quitting: false,
        fullscreenCloseAllowed: false,
        hasUnsavedGuard: true
      }),
      'guard'
    )
    assert.equal(
      previewCloseDisposition({
        quitting: false,
        fullscreenCloseAllowed: false,
        hasUnsavedGuard: false
      }),
      'park'
    )
  })
})
