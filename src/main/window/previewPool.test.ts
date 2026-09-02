import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clampPreviewWidth, nextUnfocusedPreviewPath, PREVIEW_MAX_OPEN } from './previewPool.ts'

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
  })
})
