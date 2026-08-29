import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyLiveDelta, compactLiveBlocks } from './remoteLiveLog.ts'

describe('remoteLiveLog', () => {
  it('keeps thinking, tools, and answer in slot order', () => {
    const slots = new Map()
    applyLiveDelta(slots, 0, 'reasoning', 'look at ')
    applyLiveDelta(slots, 0, 'reasoning', 'the folder')
    slots.set(1, {
      kind: 'tool',
      id: 't1',
      tool: 'fs_read',
      name: '读取文件',
      summary: 'src/index.ts',
      status: 'done'
    })
    applyLiveDelta(slots, 2, 'text', 'here is the file')
    assert.deepEqual(
      compactLiveBlocks(slots).map((block) => block.kind),
      ['reasoning', 'tool', 'text']
    )
    const reasoning = compactLiveBlocks(slots)[0]
    assert.equal(reasoning && 'text' in reasoning ? reasoning.text : '', 'look at the folder')
  })

  it('reopens an earlier text slot after a tool instead of appending a new one', () => {
    const slots = new Map()
    applyLiveDelta(slots, 0, 'text', 'before ')
    slots.set(1, {
      kind: 'tool',
      id: 't1',
      tool: 'terminal',
      name: '终端',
      summary: 'ls',
      status: 'done'
    })
    applyLiveDelta(slots, 0, 'text', 'after')
    const blocks = compactLiveBlocks(slots)
    assert.equal(blocks[0]?.kind, 'text')
    assert.equal(blocks[0] && 'text' in blocks[0] ? blocks[0].text : '', 'before after')
  })
})
