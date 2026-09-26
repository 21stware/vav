import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '@shared/types'
import {
  hasToolResult,
  isGroupableToolBlock,
  isHollowToolCard,
  isVisibleAssistantBlock,
  previewProcessText,
  processThoughtMs,
  segmentAssistantTurn,
  splitAssistantProcess,
  splitLiveAssistantProcess,
  splitSealedAssistantProcess
} from './assistantProcess.ts'

function text(source: string): MessageBlock {
  return { kind: 'text', text: source }
}

function think(source: string): MessageBlock {
  return { kind: 'reasoning', text: source }
}

function tool(id: string): MessageBlock {
  return {
    kind: 'toolCall',
    id,
    tool: 'web_search',
    summary: 'search',
    input: '{}',
    output: '',
    status: 'completed'
  }
}

describe('splitAssistantProcess', () => {
  it('folds leading think on a no-tool reply so it is not left with the answer', () => {
    const blocks = [think('hmm'), text('Here is the answer.')]
    const split = splitAssistantProcess(blocks)
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning']
    )
    assert.deepEqual(
      split.conclusion.map((item) => item.block.kind),
      ['text']
    )
  })

  it('keeps trailing think out of the answer text', () => {
    const blocks = [text('Here is the answer.'), think('leftover')]
    const split = splitAssistantProcess(blocks)
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning']
    )
    assert.deepEqual(
      split.conclusion.map((item) => item.block.kind),
      ['text']
    )
  })

  it('leaves a text-only reply ungrouped', () => {
    const split = splitAssistantProcess([text('Just the answer.')])
    assert.equal(split.process.length, 0)
    assert.equal(split.conclusion.length, 1)
    assert.equal(split.conclusion[0]?.block.kind, 'text')
  })

  it('leaves a think-only reply ungrouped', () => {
    const split = splitAssistantProcess([think('still thinking')])
    assert.equal(split.process.length, 0)
    assert.equal(split.conclusion.length, 1)
    assert.equal(split.conclusion[0]?.block.kind, 'reasoning')
  })

  it('does not fold tools or narration into the thinking well', () => {
    const blocks = [
      think('plan'),
      text('Let me search.'),
      tool('a'),
      text('Let me fetch.'),
      tool('b'),
      text('Gold is up.')
    ]
    const split = splitAssistantProcess(blocks)
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning']
    )
    assert.deepEqual(
      split.conclusion.map((item) => item.block.kind),
      ['text', 'toolCall', 'text', 'toolCall', 'text']
    )
  })

  it('keeps mid-answer think out of the body without hiding earlier prose', () => {
    const split = splitAssistantProcess([
      think('first'),
      text('Start.'),
      think('middle'),
      text('End.')
    ])
    assert.deepEqual(
      split.process.map((item) =>
        item.block.kind === 'reasoning' || item.block.kind === 'text' ? item.block.text : ''
      ),
      ['first', 'middle']
    )
    assert.deepEqual(
      split.conclusion.map((item) => (item.block.kind === 'text' ? item.block.text : '')),
      ['Start.', 'End.']
    )
  })

  it('folds snapshot reprints on the process trail', () => {
    const later =
      '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。用户要求操作日历至12月份。'
    const split = splitAssistantProcess([
      think('用户要求操作日历至12月。'),
      think(later),
      think(later),
      text('已调到 12 月。')
    ])
    assert.equal(split.process.length, 1)
    assert.equal(split.process[0]?.block.kind === 'reasoning' ? split.process[0].block.text : '', later)
    assert.equal(split.conclusion[0]?.block.kind === 'text' ? split.conclusion[0].block.text : '', '已调到 12 月。')
  })

  it('keeps leading and trailing think out of a no-tool answer', () => {
    const split = splitAssistantProcess([
      think('first'),
      text('Here is the answer.'),
      think('leftover')
    ])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning', 'reasoning']
    )
    assert.deepEqual(
      split.conclusion.map((item) => item.block.kind),
      ['text']
    )
  })

  it('keeps leftover think after a post-tool answer out of the body', () => {
    const split = splitAssistantProcess([tool('a'), text('Gold is up.'), think('leftover')])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning']
    )
    assert.deepEqual(
      split.conclusion.map((item) => item.block.kind),
      ['toolCall', 'text']
    )
  })

  it('does not hide a turn that ended on a tool', () => {
    const blocks = [text('Looking.'), tool('a')]
    const split = splitAssistantProcess(blocks)
    assert.equal(split.process.length, 0)
    assert.equal(split.conclusion.length, 2)
  })

  it('ignores a hollow subtask stub so narration is not folded away', () => {
    const hollow: MessageBlock = {
      kind: 'toolCall',
      id: 'task-1',
      tool: 'task',
      summary: 'subtask',
      input: '{}',
      output: '',
      status: 'skipped'
    }
    const blocks = [
      text('The subagent task got interrupted. Let me re-launch the exploration task.'),
      hollow,
      text('Now I have a comprehensive analysis.')
    ]
    const split = splitAssistantProcess(blocks)
    assert.equal(split.process.length, 0)
    assert.deepEqual(
      split.conclusion.map((item) => item.block.kind),
      ['text', 'text']
    )
  })

  it('keeps a plan document visible and does not treat it as the checklist plan', () => {
    const doc: MessageBlock = {
      kind: 'toolCall',
      id: 'plan-1',
      tool: 'plan_doc',
      summary: 'Refactor tabs',
      input: JSON.stringify({ name: 'Refactor tabs', plan: '# Steps' }),
      output: '',
      status: 'completed'
    }
    const checklist: MessageBlock = {
      kind: 'toolCall',
      id: 'plan-todos',
      tool: 'plan',
      summary: 'Plan',
      input: '{}',
      output: '',
      status: 'completed'
    }
    assert.equal(isHollowToolCard(doc), false)
    assert.equal(isVisibleAssistantBlock(doc), true)
    assert.equal(isVisibleAssistantBlock(checklist), false)
  })

  it('treats empty output as no result even when the summary is a query', () => {
    const search: MessageBlock = {
      kind: 'toolCall',
      id: 's1',
      tool: 'web_search',
      summary: 'Web Search: "兆创新"',
      input: '{"query":"兆创新"}',
      output: '',
      status: 'completed'
    }
    assert.equal(isHollowToolCard(search), false)
    assert.equal(hasToolResult(search), false)
    assert.equal(
      hasToolResult({ ...search, output: '1. Example\nhttps://example.com' }),
      true
    )
  })
})

describe('splitSealedAssistantProcess', () => {
  it('keeps a think-only stop inside the thinking well', () => {
    const split = splitSealedAssistantProcess([think('still thinking')])
    assert.equal(split.process.length, 1)
    assert.equal(split.process[0]?.block.kind, 'reasoning')
    assert.equal(split.conclusion.length, 0)
  })

  it('keeps a tool-ended stop inside the thinking well', () => {
    const split = splitSealedAssistantProcess([text('Looking.'), tool('a')])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['text', 'toolCall']
    )
    assert.equal(split.conclusion.length, 0)
  })

  it('leaves a text-only reply as the answer', () => {
    const split = splitSealedAssistantProcess([text('Just the answer.')])
    assert.equal(split.process.length, 0)
    assert.equal(split.conclusion.length, 1)
    assert.equal(split.conclusion[0]?.block.kind, 'text')
  })

  it('does not move a finished answer into the well', () => {
    const split = splitSealedAssistantProcess([think('hmm'), text('Here is the answer.')])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning']
    )
    assert.deepEqual(
      split.conclusion.map((item) => item.block.kind),
      ['text']
    )
  })
})

describe('segmentAssistantTurn', () => {
  it('keeps interleaved think and body in stream order', () => {
    const segments = segmentAssistantTurn([
      think('first'),
      text('Start.'),
      think('middle'),
      text('End.')
    ])
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ['thinking', 'text', 'thinking', 'text']
    )
    assert.equal(
      segments[0]?.kind === 'thinking' ? segments[0].items[0]?.block.kind : '',
      'reasoning'
    )
    assert.equal(segments[1]?.kind === 'text' ? segments[1].item.block.kind : '', 'text')
    assert.equal(
      segments[1]?.kind === 'text' && segments[1].item.block.kind === 'text'
        ? segments[1].item.block.text
        : '',
      'Start.'
    )
    assert.equal(
      segments[3]?.kind === 'text' && segments[3].item.block.kind === 'text'
        ? segments[3].item.block.text
        : '',
      'End.'
    )
  })

  it('keeps tools that ran during thinking inside one well', () => {
    const segments = segmentAssistantTurn([
      think('plan'),
      tool('a'),
      think('next'),
      tool('b'),
      text('Gold is up.')
    ])
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ['thinking', 'text']
    )
    assert.deepEqual(
      segments[0]?.kind === 'thinking'
        ? segments[0].items.map((item) => item.block.kind)
        : [],
      ['reasoning', 'toolCall', 'reasoning', 'toolCall']
    )
  })

  it('leaves tools in place between think and answer', () => {
    const segments = segmentAssistantTurn([think('plan'), tool('a'), text('Gold is up.')])
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ['thinking', 'text']
    )
    assert.deepEqual(
      segments[0]?.kind === 'thinking'
        ? segments[0].items.map((item) => item.block.kind)
        : [],
      ['reasoning', 'toolCall']
    )
  })

  it('packs consecutive line-style tools into one group', () => {
    const segments = segmentAssistantTurn([tool('a'), tool('b'), text('Gold is up.')])
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ['tools', 'text']
    )
    assert.equal(segments[0]?.kind === 'tools' ? segments[0].items.length : 0, 2)
  })

  it('does not pack tools split by narration', () => {
    const segments = segmentAssistantTurn([tool('a'), text('Next.'), tool('b')])
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ['tool', 'text', 'tool']
    )
  })

  it('leaves ask and approval cards outside the group', () => {
    const ask: MessageBlock = {
      kind: 'toolCall',
      id: 'ask',
      tool: 'ask_user_question',
      summary: 'Pick one',
      input: '{}',
      output: '',
      status: 'pending'
    }
    const approval: MessageBlock = {
      kind: 'toolCall',
      id: 'gate',
      tool: 'fs_write',
      summary: 'Write',
      input: '{}',
      output: '',
      status: 'pending',
      choices: ['Approve', 'Deny']
    }
    assert.equal(isGroupableToolBlock(ask), false)
    assert.equal(isGroupableToolBlock(approval), false)
    const segments = segmentAssistantTurn([tool('a'), tool('b'), ask, approval])
    assert.deepEqual(
      segments.map((segment) => segment.kind),
      ['tools', 'tool', 'tool']
    )
  })

  it('folds snapshot reprints inside one thinking run', () => {
    const later =
      '正在检查工作区环境、浏览器自动化技能及历史记录，确定如何操作日历。用户要求操作日历至12月份。'
    const segments = segmentAssistantTurn([
      think('用户要求操作日历至12月。'),
      think(later),
      think(later),
      text('已调到 12 月。')
    ])
    assert.equal(segments.length, 2)
    assert.equal(segments[0]?.kind, 'thinking')
    assert.equal(
      segments[0]?.kind === 'thinking' && segments[0].items[0]?.block.kind === 'reasoning'
        ? segments[0].items[0].block.text
        : '',
      later
    )
  })
})

describe('splitLiveAssistantProcess', () => {
  it('folds leading think as soon as the answer starts', () => {
    const split = splitLiveAssistantProcess([
      think('plan'),
      tool('a'),
      text('Gold is up.')
    ])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning', 'toolCall']
    )
    assert.deepEqual(
      split.live.map((item) => item.block.kind),
      ['text']
    )
  })

  it('keeps later think out of the live body when a tool follows', () => {
    const split = splitLiveAssistantProcess([
      think('plan'),
      tool('a'),
      text('Let me fetch.'),
      tool('b')
    ])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning', 'toolCall']
    )
    assert.deepEqual(
      split.live.map((item) => item.block.kind),
      ['text', 'toolCall']
    )
  })

  it('stays live before any answer when think is the only trail', () => {
    const split = splitLiveAssistantProcess([think('plan')])
    assert.equal(split.process.length, 0)
    assert.equal(split.live.length, 1)
    assert.equal(split.live[0]?.block.kind, 'reasoning')
  })

  it('folds leading think as soon as the no-tool answer starts', () => {
    const split = splitLiveAssistantProcess([think('hmm'), text('Here is the answer.')])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning']
    )
    assert.equal(split.live.length, 1)
    assert.equal(split.live[0]?.block.kind, 'text')
  })
})

describe('previewProcessText', () => {
  it('takes the first prose line and strips markup', () => {
    assert.equal(previewProcessText('# Hello\n\nMore.'), 'Hello')
    assert.equal(previewProcessText('Let me search.'), 'Let me search.')
  })
})

describe('processThoughtMs', () => {
  it('sums sealed reasoning durations', () => {
    assert.equal(
      processThoughtMs([
        { index: 0, block: { kind: 'reasoning', text: 'a', durationMs: 1200 } },
        { index: 1, block: tool('x') },
        { index: 2, block: { kind: 'reasoning', text: 'b', durationMs: 800 } }
      ]),
      2000
    )
  })
})
