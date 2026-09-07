import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHTML } from 'linkedom'
import {
  chromeBoxesEqual,
  chromeMutationRelevant,
  intersects,
  isRowLikeId,
  projectNatural,
  projectToHost,
  readDocZoom,
  snapScreen,
  unionRects,
  unprojectVisual,
  visualXTopCenter,
  writeDocZoom,
  type ChromeBox
} from './selectionChrome.ts'

describe('projectToHost', () => {
  const host = { left: 100, top: 50, right: 500, bottom: 350, width: 400, height: 300 }

  it('maps a content rect into host-local screen pixels', () => {
    assert.deepEqual(projectToHost(host, { left: 150, top: 80, right: 250, bottom: 140 }, 1), {
      left: 50,
      top: 30,
      width: 100,
      height: 60
    })
  })

  it('grows the box when the subject is larger, without changing origin math', () => {
    const zoomed = projectToHost(host, { left: 150, top: 80, right: 350, bottom: 200 }, 1)
    const fit = projectToHost(host, { left: 150, top: 80, right: 250, bottom: 140 }, 1)
    assert.equal(zoomed.left, fit.left)
    assert.equal(zoomed.top, fit.top)
    assert.ok(zoomed.width > fit.width)
    assert.ok(zoomed.height > fit.height)
  })

  it('snaps to device pixels so a 1px stroke stays crisp', () => {
    const box = projectToHost(host, { left: 100.4, top: 50.6, right: 180.2, bottom: 90.1 }, 2)
    assert.equal(box.left, 0.5)
    assert.equal(box.top, 0.5)
    assert.equal(box.width, 80)
    assert.equal(box.height, 39.5)
  })
})

describe('snapScreen', () => {
  it('rounds to the nearest device pixel', () => {
    assert.equal(snapScreen(10.24, 2), 10)
    assert.equal(snapScreen(10.26, 2), 10.5)
  })
})

describe('intersects', () => {
  it('rejects a box that has scrolled fully out of the stage', () => {
    const host = { left: 0, top: 0, right: 200, bottom: 200 }
    assert.equal(intersects(host, { left: 0, top: -80, right: 40, bottom: -10 }), false)
    assert.equal(intersects(host, { left: 20, top: 20, right: 40, bottom: 40 }), true)
    assert.equal(intersects(host, { left: 180, top: 180, right: 240, bottom: 240 }), true)
  })
})

describe('unionRects', () => {
  it('unions two paint boxes and skips dust', () => {
    const box = unionRects([
      { left: 10, top: 10, right: 40, bottom: 30 },
      { left: 35, top: 20, right: 80, bottom: 60 },
      { left: 0, top: 0, right: 1, bottom: 1 }
    ])
    assert.deepEqual(box, { left: 10, top: 10, right: 80, bottom: 60 })
  })

  it('returns null when every rect is too small', () => {
    assert.equal(unionRects([{ left: 0, top: 0, right: 1, bottom: 1 }]), null)
  })
})

describe('chromeBoxesEqual', () => {
  const a: ChromeBox = {
    id: 'cell-1',
    left: 8,
    top: 12,
    width: 40,
    height: 20,
    kind: 'selected',
    media: false
  }

  it('treats an identical list as unchanged', () => {
    assert.equal(chromeBoxesEqual([a], [{ ...a }]), true)
  })

  it('notices a one-pixel drift (zoom / scroll)', () => {
    assert.equal(chromeBoxesEqual([a], [{ ...a, left: 9 }]), false)
  })
})

describe('projectNatural', () => {
  it('scales a natural box without reading the DOM', () => {
    assert.deepEqual(projectNatural({ x: 10, y: 20, w: 40, h: 16 }, 2), {
      left: 20,
      top: 40,
      width: 80,
      height: 32
    })
  })
})

describe('unprojectVisual', () => {
  it('divides a visual rect by the current scale back into natural space', () => {
    assert.deepEqual(
      unprojectVisual({ left: 200, top: 80, width: 80, height: 40 }, { left: 100, top: 40 }, 2),
      { x: 50, y: 20, w: 40, h: 20 }
    )
  })

  it('rejects dust boxes', () => {
    assert.equal(
      unprojectVisual({ left: 0, top: 0, width: 1, height: 1 }, { left: 0, top: 0 }, 1),
      null
    )
  })
})

describe('visualXTopCenter', () => {
  it('collapses to n·scale when the frame is the visual page', () => {
    const nx = 120
    const naturalW = 816
    const scale = 1.75
    assert.equal(visualXTopCenter(nx, naturalW, scale), nx * scale)
  })
})

describe('writeDocZoom', () => {
  it('stores scale on the frame dataset and only on the HUD node', () => {
    const { document } = parseHTML(
      '<div id="frame"><div class="page"></div><div class="selection-hud"></div></div>'
    )
    const frame = document.querySelector('#frame') as HTMLElement
    const page = document.querySelector('.page') as HTMLElement
    const hud = document.querySelector('.selection-hud') as HTMLElement
    frame.style.setProperty('--doc-zoom', '9')
    writeDocZoom(frame, 1.5)
    assert.equal(frame.dataset.docZoom, '1.5')
    assert.equal(frame.style.getPropertyValue('--doc-zoom'), '')
    assert.equal(hud.style.getPropertyValue('--doc-zoom'), '1.5')
    assert.equal(page.style.getPropertyValue('--doc-zoom'), '')
    assert.equal(readDocZoom(frame), 1.5)
  })
})

describe('chromeMutationRelevant', () => {
  it('ignores virtualized line mounts that are not selected', () => {
    const { document } = parseHTML('<div class="preview-code-line"></div>')
    const line = document.querySelector('.preview-code-line')!
    assert.equal(
      chromeMutationRelevant(
        { type: 'childList', target: document.body, addedNodes: [line], removedNodes: [] },
        new Set(['cell-1'])
      ),
      false
    )
  })

  it('reacts when a selected cell remounts', () => {
    const { document } = parseHTML('<td class="preview-select-region selected" data-block-id="c1"></td>')
    const cell = document.querySelector('td')!
    assert.equal(
      chromeMutationRelevant(
        { type: 'childList', target: document.body, addedNodes: [cell], removedNodes: [] },
        new Set(['c1'])
      ),
      true
    )
  })

  it('ignores the HUD layer itself', () => {
    const { document } = parseHTML('<div class="selection-hud"><div class="selection-hud-box selected"></div></div>')
    const hud = document.querySelector('.selection-hud')!
    assert.equal(
      chromeMutationRelevant(
        { type: 'childList', target: document.body, addedNodes: [hud], removedNodes: [] },
        new Set()
      ),
      false
    )
  })
})

describe('isRowLikeId', () => {
  it('recognizes sheet row ids', () => {
    assert.equal(isRowLikeId('row-12'), true)
    assert.equal(isRowLikeId('sheet-row-3'), true)
    assert.equal(isRowLikeId('cell-r2-c4'), false)
  })
})
