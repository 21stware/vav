import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TOOL_LABELS, type ToolName } from '@shared/types'
import { iconForTool, TOOL_ICONS } from './toolGlyph.ts'

describe('TOOL_ICONS', () => {
  it('covers every ToolName', () => {
    const names = Object.keys(TOOL_LABELS) as ToolName[]
    for (const name of names) {
      assert.ok(TOOL_ICONS[name], name)
    }
    assert.equal(Object.keys(TOOL_ICONS).length, names.length)
  })

  it('falls back to the wrench for an unknown id', () => {
    assert.equal(iconForTool('not-a-tool'), TOOL_ICONS.external)
    assert.equal(iconForTool('web_search'), TOOL_ICONS.web_search)
  })
})
