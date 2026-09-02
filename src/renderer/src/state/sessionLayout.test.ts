import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_SESSION_TOOLS,
  parseGlobalLayout,
  parseSessionToolsMap,
  patchActiveTools,
  toolsFor
} from './sessionLayout.ts'

describe('sessionLayout parse', () => {
  it('defaults a missing sidebar and merges partial tools maps', () => {
    assert.deepEqual(parseGlobalLayout(null), { sidebarVisible: true })
    assert.deepEqual(parseGlobalLayout('{'), { sidebarVisible: true })
    assert.equal(parseGlobalLayout('{"sidebarVisible":false}').sidebarVisible, false)
    const map = parseSessionToolsMap('{"c1":{"toolsCollapsed":false,"panelHeight":400}}')
    assert.equal(map.c1?.toolsCollapsed, false)
    assert.equal(map.c1?.panelHeight, 400)
    assert.equal(map.c1?.panelSegment, DEFAULT_SESSION_TOOLS.panelSegment)
    assert.equal(toolsFor({ toolsLayouts: {} }, 'missing').panelHeight, 240)
  })

  it('patches the active tools layout and ignores a missing conversation', () => {
    const empty = patchActiveTools({ activeId: '', toolsLayouts: {} }, { toolsCollapsed: false })
    assert.deepEqual(empty, {})
    const patched = patchActiveTools(
      { activeId: 'c1', toolsLayouts: {} },
      { toolsCollapsed: false, panelHeight: 300 }
    )
    assert.equal(patched.toolsCollapsed, false)
    assert.equal(patched.panelHeight, 300)
    assert.equal(patched.toolsLayouts?.c1?.panelHeight, 300)
  })
})
