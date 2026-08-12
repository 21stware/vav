import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findNeighborPane, type PaneRect } from './cliPaneNavigate.ts'

/** 2×2 grid of equal panes. */
function grid2x2(): PaneRect[] {
  return [
    { tabId: 'tl', left: 0, top: 0, right: 100, bottom: 100 },
    { tabId: 'tr', left: 100, top: 0, right: 200, bottom: 100 },
    { tabId: 'bl', left: 0, top: 100, right: 100, bottom: 200 },
    { tabId: 'br', left: 100, top: 100, right: 200, bottom: 200 }
  ]
}

describe('findNeighborPane', () => {
  it('moves along a row split', () => {
    const panes: PaneRect[] = [
      { tabId: 'a', left: 0, top: 0, right: 100, bottom: 100 },
      { tabId: 'b', left: 100, top: 0, right: 200, bottom: 100 }
    ]
    assert.equal(findNeighborPane('a', 'right', panes), 'b')
    assert.equal(findNeighborPane('b', 'left', panes), 'a')
    assert.equal(findNeighborPane('a', 'left', panes), null)
    assert.equal(findNeighborPane('a', 'up', panes), null)
  })

  it('prefers edge-aligned neighbor over diagonal', () => {
    const panes = grid2x2()
    assert.equal(findNeighborPane('tl', 'right', panes), 'tr')
    assert.equal(findNeighborPane('tl', 'down', panes), 'bl')
    assert.equal(findNeighborPane('tl', 'right', panes), 'tr')
    // From TL, up/left dead-end.
    assert.equal(findNeighborPane('tl', 'up', panes), null)
    assert.equal(findNeighborPane('br', 'left', panes), 'bl')
    assert.equal(findNeighborPane('br', 'up', panes), 'tr')
  })

  it('crosses nested column then row like a T layout', () => {
    //   [  A  |  B  ]
    //   [     C     ]
    const panes: PaneRect[] = [
      { tabId: 'a', left: 0, top: 0, right: 100, bottom: 80 },
      { tabId: 'b', left: 100, top: 0, right: 200, bottom: 80 },
      { tabId: 'c', left: 0, top: 80, right: 200, bottom: 200 }
    ]
    assert.equal(findNeighborPane('a', 'down', panes), 'c')
    assert.equal(findNeighborPane('b', 'down', panes), 'c')
    // From C up: prefer the more center-aligned of A/B — both overlap; closer
    // primary distance is equal (same top edge), pick by orthogonal center.
    // C centerX=100; A centerX=50 (delta 50); B centerX=150 (delta 50).
    // Stable fallback: reading order → A (top then left).
    const up = findNeighborPane('c', 'up', panes)
    assert.ok(up === 'a' || up === 'b')
    assert.equal(findNeighborPane('a', 'right', panes), 'b')
  })

  it('ignores self and empty sets', () => {
    assert.equal(findNeighborPane('a', 'right', []), null)
    assert.equal(
      findNeighborPane('a', 'right', [
        { tabId: 'a', left: 0, top: 0, right: 10, bottom: 10 }
      ]),
      null
    )
  })

  it('falls back to reading order when a direction has no spatial neighbor', () => {
    // Vertical stack — Cmd+Right has no pane to the right; step to next below.
    const panes: PaneRect[] = [
      { tabId: 'a', left: 0, top: 0, right: 200, bottom: 100 },
      { tabId: 'b', left: 0, top: 100, right: 200, bottom: 200 }
    ]
    assert.equal(findNeighborPane('a', 'down', panes), 'b')
    assert.equal(findNeighborPane('a', 'right', panes), 'b')
    assert.equal(findNeighborPane('b', 'left', panes), 'a')
    assert.equal(findNeighborPane('b', 'up', panes), 'a')
  })
})
