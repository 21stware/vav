import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AGENT_MIN,
  PREVIEW_MIN,
  defaultPreviewForShell,
  maxPreviewForShell,
  previewWidthAfterShellChange,
  shouldOpenStandaloneFilePreview
} from './workspacePreviewFit.ts'

describe('maxPreviewForShell', () => {
  it('leaves the conversation at AGENT_MIN', () => {
    assert.equal(maxPreviewForShell(1000), 1000 - AGENT_MIN)
  })
})

describe('defaultPreviewForShell', () => {
  it('opens at ~42% without starving the conversation', () => {
    const total = 1000
    const next = defaultPreviewForShell(total)
    assert.ok(next >= PREVIEW_MIN)
    assert.ok(next <= total - AGENT_MIN)
    assert.equal(next, 420)
  })
})

describe('previewWidthAfterShellChange', () => {
  it('gives extra shell width to the preview', () => {
    assert.equal(
      previewWidthAfterShellChange({ preview: 420, prevTotal: 1000, nextTotal: 1400 }),
      820
    )
  })

  it('takes width from the preview first when the shell shrinks', () => {
    assert.equal(
      previewWidthAfterShellChange({ preview: 820, prevTotal: 1400, nextTotal: 1000 }),
      420
    )
  })

  it('never shrinks the conversation below AGENT_MIN', () => {
    assert.equal(
      previewWidthAfterShellChange({ preview: 800, prevTotal: 1000, nextTotal: 900 }),
      900 - AGENT_MIN
    )
  })

  it('does not apply a delta until the previous shell width is known', () => {
    assert.equal(
      previewWidthAfterShellChange({ preview: 380, prevTotal: 0, nextTotal: 1600 }),
      380
    )
  })
})

describe('shouldOpenStandaloneFilePreview', () => {
  it('opens a window when the session has no preview column', () => {
    assert.equal(
      shouldOpenStandaloneFilePreview({ conversationId: 'c1', filePreviewHost: false }),
      true
    )
  })

  it('uses the in-session drawer on the main surface', () => {
    assert.equal(
      shouldOpenStandaloneFilePreview({ conversationId: 'c1', filePreviewHost: true }),
      false
    )
  })

  it('opens a window when there is no active session', () => {
    assert.equal(
      shouldOpenStandaloneFilePreview({ conversationId: null, filePreviewHost: false }),
      true
    )
  })
})
