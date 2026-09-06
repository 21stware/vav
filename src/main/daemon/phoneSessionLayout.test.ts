import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertDesktopSessionLayout, type PhoneSessionLayout } from './phoneSessionLayout.ts'

function layout(partial: Partial<PhoneSessionLayout> = {}): PhoneSessionLayout {
  return {
    composerWidth: 400,
    composerHeight: 80,
    composerTop: 500,
    viewportWidth: 420,
    viewportHeight: 800,
    agentWidth: 400,
    previewWidth: 0,
    previewCollapsed: true,
    selectFileVisible: false,
    pageChipOverlapsComposer: false,
    ...partial
  }
}

describe('assertDesktopSessionLayout', () => {
  it('accepts a bottom-docked composer with the preview closed', () => {
    assertDesktopSessionLayout(layout(), 280)
  })

  it('rejects a crushed or vertical composer', () => {
    assert.throws(() => assertDesktopSessionLayout(layout({ composerWidth: 120 }), 280), /crushed/)
    assert.throws(
      () => assertDesktopSessionLayout(layout({ composerWidth: 80, composerHeight: 200 }), 40),
      /vertical strip/
    )
  })

  it('rejects a composer that is not the bottom dock', () => {
    assert.throws(() => assertDesktopSessionLayout(layout({ composerTop: 20 }), 280), /bottom dock/)
  })

  it('rejects an open file preview covering the session', () => {
    assert.throws(
      () => assertDesktopSessionLayout(layout({ previewCollapsed: false, previewWidth: 200 }), 280),
      /preview drawer/
    )
    assert.throws(
      () => assertDesktopSessionLayout(layout({ selectFileVisible: true }), 280),
      /empty state/
    )
  })

  it('rejects a page chip over the composer', () => {
    assert.throws(
      () => assertDesktopSessionLayout(layout({ pageChipOverlapsComposer: true }), 280),
      /covering the composer/
    )
  })
})
