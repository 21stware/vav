import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage, MessageBlock, ToolCallBlock } from '@shared/types'
import {
  CliHistoryReplayGate,
  createCliHistoryReplayGate
} from './cliHistoryReplay.ts'

function tool(id: string, children?: MessageBlock[]): ToolCallBlock {
  return {
    kind: 'toolCall',
    id,
    tool: 'fs_read',
    summary: id,
    input: '{}',
    output: '',
    status: 'completed',
    ...(children ? { children } : {})
  }
}

function assistant(blocks: MessageBlock[], id = 'a1'): ChatMessage {
  return {
    id,
    parentId: 'u1',
    role: 'assistant',
    content: blocks
      .filter((b): b is Extract<MessageBlock, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join(''),
    blocks,
    createdAt: 1
  }
}

describe('CliHistoryReplayGate', () => {
  it('records the first turn with no history to strip', () => {
    const gate = createCliHistoryReplayGate([])
    assert.equal(gate.isLive, true)
    assert.equal(gate.tool('call-1'), 'take')
    assert.equal(gate.text('hello'), 'take')
  })

  it('skips a dump of the previous turn then records new work', () => {
    const gate = createCliHistoryReplayGate([
      assistant([
        { kind: 'reasoning', text: 'plan it' },
        { kind: 'text', text: '先读取完整需求。' },
        tool('call-old-1'),
        tool('call-old-2'),
        { kind: 'text', text: '已经改成偏临床仪器感。' }
      ])
    ])
    assert.equal(gate.isLive, false)
    assert.equal(gate.reasoning('plan it'), 'skip')
    assert.equal(gate.text('先读取完整需求。'), 'skip')
    assert.equal(gate.tool('call-old-1'), 'skip')
    assert.equal(gate.tool('call-old-2'), 'skip')
    assert.equal(gate.text('已经改成偏临床仪器感。'), 'skip')
    assert.equal(gate.isLive, false)

    assert.equal(gate.tool('call-new-1'), 'take')
    assert.equal(gate.isLive, true)
    assert.equal(gate.text('改成 Airbnb 风格，保留浅绿色。'), 'take')
    assert.equal(gate.tool('call-old-1'), 'take')
  })

  it('opens on the first text that is not a prefix of the previous answer', () => {
    const gate = createCliHistoryReplayGate([
      assistant([{ kind: 'text', text: '已经改成偏临床仪器感。' }])
    ])
    assert.equal(gate.text('已经改成偏临床仪器感。'), 'skip')
    assert.equal(gate.text('改成 Airbnb 风格。'), 'take')
    assert.equal(gate.isLive, true)
  })

  it('streams historical text in chunks without opening', () => {
    const gate = createCliHistoryReplayGate([
      assistant([{ kind: 'text', text: 'hello world' }])
    ])
    assert.equal(gate.text('hel'), 'skip')
    assert.equal(gate.text('lo '), 'skip')
    assert.equal(gate.text('world'), 'skip')
    assert.equal(gate.text('!'), 'take')
  })

  it('skips nested historical tools via parent id', () => {
    const gate = createCliHistoryReplayGate([
      assistant([tool('parent', [tool('child')])])
    ])
    assert.equal(gate.tool('child', 'parent'), 'skip')
    assert.equal(gate.tool('fresh', 'parent'), 'skip')
    assert.equal(gate.tool('fresh-root'), 'take')
  })

  it('uses the newest assistant as the text/reasoning prefix', () => {
    const gate = createCliHistoryReplayGate([
      assistant([{ kind: 'text', text: 'first turn' }], 'a1'),
      assistant([{ kind: 'text', text: 'medical restyle' }, tool('t2')], 'a2')
    ])
    assert.equal(gate.text('medical restyle'), 'skip')
    assert.equal(gate.tool('t2'), 'skip')
    assert.equal(gate.isLive, false)
  })

  it('still skips older tool ids after a later assistant is stored', () => {
    const gate = createCliHistoryReplayGate([
      assistant([tool('t1'), { kind: 'text', text: 'first turn' }], 'a1'),
      assistant([tool('t2'), { kind: 'text', text: 'medical restyle' }], 'a2')
    ])
    assert.equal(gate.tool('t1'), 'skip')
    assert.equal(gate.tool('t2'), 'skip')
    assert.equal(gate.isLive, false)
  })

  it('does not treat a follow-up dump of the last answer as a new reply', () => {
    const previous = assistant([
      { kind: 'reasoning', text: 'look at index.html' },
      { kind: 'text', text: '把整套视觉改成冷纸、墨蓝与手术青绿。' },
      tool('call-72b4a6ad-6a34-452b-b44a-e0724619a6e1-184'),
      {
        kind: 'text',
        text: '已经改成偏临床仪器感的专业医疗风格，刷新 index.html 即可看到。'
      }
    ])
    const gate = createCliHistoryReplayGate([previous])
    assert.equal(gate.reasoning('look at index.html'), 'skip')
    assert.equal(gate.text('把整套视觉改成冷纸、墨蓝与手术青绿。'), 'skip')
    assert.equal(gate.tool('call-72b4a6ad-6a34-452b-b44a-e0724619a6e1-184'), 'skip')
    assert.equal(
      gate.text('已经改成偏临床仪器感的专业医疗风格，刷新 index.html 即可看到。'),
      'skip'
    )
    assert.equal(gate.isLive, false)
    assert.equal(gate.text('改成 Airbnb 风格，浅绿色主题保留。'), 'take')
  })

  it('open() drops the filter for a fresh-session retry', () => {
    const gate = createCliHistoryReplayGate([
      assistant([{ kind: 'text', text: 'old' }, tool('t1')])
    ])
    gate.open()
    assert.equal(gate.text('old'), 'take')
    assert.equal(gate.tool('t1'), 'take')
  })
})
