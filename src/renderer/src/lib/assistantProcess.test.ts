import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock } from '@shared/types'
import {
  previewProcessText,
  processThoughtMs,
  splitAssistantProcess,
  splitLiveAssistantProcess
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

  it('peels trailing think off the answer', () => {
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

  it('groups everything before the post-tool answer', () => {
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
      ['reasoning', 'text', 'toolCall', 'text', 'toolCall']
    )
    assert.equal(split.conclusion.length, 1)
    assert.equal(split.conclusion[0]?.block.kind, 'text')
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

  it('peels leftover think after a post-tool answer', () => {
    const split = splitAssistantProcess([tool('a'), text('Gold is up.'), think('leftover')])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['toolCall', 'reasoning']
    )
    assert.equal(split.conclusion.length, 1)
    assert.equal(split.conclusion[0]?.block.kind, 'text')
  })

  it('does not hide a turn that ended on a tool', () => {
    const blocks = [text('Looking.'), tool('a')]
    const split = splitAssistantProcess(blocks)
    assert.equal(split.process.length, 0)
    assert.equal(split.conclusion.length, 2)
  })
})

describe('splitLiveAssistantProcess', () => {
  it('folds the trail as soon as post-tool text starts', () => {
    const split = splitLiveAssistantProcess([
      think('plan'),
      tool('a'),
      text('Gold is up.')
    ])
    assert.deepEqual(
      split.process.map((item) => item.block.kind),
      ['reasoning', 'toolCall']
    )
    assert.equal(split.live.length, 1)
    assert.equal(split.live[0]?.block.kind, 'text')
  })

  it('keeps the process folded when a later tool starts', () => {
    const split = splitLiveAssistantProcess([
      think('plan'),
      tool('a'),
      text('Let me fetch.'),
      tool('b')
    ])
    assert.ok(split.process.length >= 3)
    assert.equal(split.live.length, 1)
    assert.equal(split.live[0]?.block.kind, 'toolCall')
  })

  it('stays live before any post-tool answer', () => {
    const split = splitLiveAssistantProcess([think('plan'), text('Looking.'), tool('a')])
    assert.equal(split.process.length, 0)
    assert.equal(split.live.length, 3)
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
