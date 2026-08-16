import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageBlock, ToolCallBlock } from './types.ts'
import {
  childSessionIdFrom,
  expireOpenTools,
  findToolBlock,
  isTaskToolName,
  snapshotToolBlock,
  topLevelToolIndex
} from './subtask.ts'

describe('isTaskToolName', () => {
  it('matches OpenCode and Claude names', () => {
    assert.equal(isTaskToolName('task'), true)
    assert.equal(isTaskToolName('subtask'), true)
    assert.equal(isTaskToolName('Task'), true)
    assert.equal(isTaskToolName('sub-agent'), true)
    assert.equal(isTaskToolName('bash'), false)
    assert.equal(isTaskToolName('search'), false)
  })
})

describe('childSessionIdFrom', () => {
  it('reads OpenCode running metadata', () => {
    assert.equal(childSessionIdFrom({ description: 'explore' }, { sessionId: 'ses_1' }), 'ses_1')
    assert.equal(childSessionIdFrom({ sessionID: 'ses_2' }), 'ses_2')
    assert.equal(childSessionIdFrom({}, { metadata: { task_id: 'ses_3' } }), 'ses_3')
  })

  it('returns null when nothing looks like a session id', () => {
    assert.equal(childSessionIdFrom({ description: 'explore', prompt: 'look around' }), null)
  })
})

describe('findToolBlock / topLevelToolIndex', () => {
  const nested: ToolCallBlock = {
    kind: 'toolCall',
    id: 'child-bash',
    tool: 'terminal',
    summary: 'git clone',
    input: '{}',
    output: '',
    status: 'executing'
  }
  const parent: ToolCallBlock = {
    kind: 'toolCall',
    id: 'task-1',
    tool: 'task',
    summary: 'explore',
    input: '{}',
    output: '',
    status: 'executing',
    children: [nested]
  }
  const blocks: MessageBlock[] = [{ kind: 'text', text: 'hi' }, parent]

  it('finds nested tools', () => {
    assert.equal(findToolBlock(blocks, 'task-1')?.id, 'task-1')
    assert.equal(findToolBlock(blocks, 'child-bash')?.tool, 'terminal')
    assert.equal(topLevelToolIndex(blocks, 'child-bash'), 1)
    assert.equal(topLevelToolIndex(blocks, 'missing'), null)
  })
})

describe('expireOpenTools', () => {
  it('expires nested executing tools when the turn is cancelled', () => {
    const child: ToolCallBlock = {
      kind: 'toolCall',
      id: 'c',
      tool: 'terminal',
      summary: 'ls',
      input: '{}',
      output: '',
      status: 'executing'
    }
    const parent: ToolCallBlock = {
      kind: 'toolCall',
      id: 'p',
      tool: 'task',
      summary: 'explore',
      input: '{}',
      output: '',
      status: 'executing',
      children: [child]
    }
    expireOpenTools([parent], true)
    assert.equal(parent.status, 'expired')
    assert.equal(child.status, 'expired')
  })
})

describe('snapshotToolBlock', () => {
  it('copies the children array so React sees a new block', () => {
    const children: MessageBlock[] = [{ kind: 'text', text: 'a' }]
    const block: ToolCallBlock = {
      kind: 'toolCall',
      id: 't',
      tool: 'task',
      summary: 'x',
      input: '{}',
      output: '',
      status: 'executing',
      children
    }
    const next = snapshotToolBlock(block)
    assert.notEqual(next.children, children)
    assert.deepEqual(next.children, children)
  })
})
