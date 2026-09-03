import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appendNestedChildDelta,
  applyCliToolPatch,
  applyToolEventStatus,
  applyToolRuntimePatch,
  applyToolStatePatch,
  cliToolCardSummary,
  cliToolHasInput,
  ensureToolCallBlock,
  newCliParentTaskBlock,
  newCliPermissionBlock,
  newCliToolCallBlock,
  rememberSentToolCard,
  shouldAdoptMappedTool,
  shouldKeepPendingInteractive,
  toolCallBlockIndex,
  ensureCliParentTask
} from './cliToolBlock.ts'

describe('cliToolBlock', () => {
  it('creates a pending tool card', () => {
    const block = newCliToolCallBlock({
      id: 't1',
      tool: 'fs_read',
      summary: 'read',
      input: '{}'
    })
    assert.equal(block.kind, 'toolCall')
    assert.equal(block.status, 'pending')
    assert.equal(block.output, '')
  })

  it('keeps parked ask/plan-doc pending, then completes others', () => {
    const ask = newCliToolCallBlock({
      id: 'a',
      tool: 'ask_user_question',
      summary: 'q',
      input: '{}'
    })
    assert.equal(shouldKeepPendingInteractive(ask), true)
    applyToolEventStatus(ask, 'started')
    assert.equal(ask.status, 'pending')
    const read = newCliToolCallBlock({
      id: 'r',
      tool: 'fs_read',
      summary: 'read',
      input: '{}'
    })
    applyToolEventStatus(read, 'started')
    assert.equal(read.status, 'executing')
    applyToolEventStatus(read, 'completed', 'ok')
    assert.equal(read.status, 'completed')
    assert.equal(read.output, 'ok')
  })

  it('attaches optional nested/interactive fields', () => {
    const block = newCliToolCallBlock({
      id: 'p',
      tool: 'task',
      summary: 'task',
      input: '{}',
      status: 'executing',
      children: [],
      questions: [{ question: 'q?' }],
      askTitle: 'Ask',
      choices: ['a', 'b']
    })
    assert.equal(block.status, 'executing')
    assert.deepEqual(block.children, [])
    assert.equal(block.askTitle, 'Ask')
    assert.deepEqual(block.choices, ['a', 'b'])
    assert.equal(block.questions?.[0]?.question, 'q?')
  })

  it('clears approval fields when the runtime patch has no choices', () => {
    const prev = newCliToolCallBlock({
      id: 't',
      tool: 'fs_write',
      summary: 'write',
      input: '{}',
      choices: ['Approve', 'Deny'],
      askTitle: 'fs_write'
    })
    const next = applyToolRuntimePatch(prev, { status: 'executing', output: 'ok' })
    assert.equal(next.status, 'executing')
    assert.equal(next.output, 'ok')
    assert.equal(next.choices, undefined)
    assert.equal(next.askTitle, undefined)
  })

  it('builds an Approve/Deny permission card', () => {
    const block = newCliPermissionBlock({
      requestId: 'r1',
      toolName: 'Bash',
      inputJson: '{"tool":"Bash"}'
    })
    assert.equal(block.id, 'perm-r1')
    assert.equal(block.tool, 'request')
    assert.equal(block.summary, 'Bash')
    assert.deepEqual(block.choices, ['Approve', 'Deny'])
    assert.equal(block.askTitle, 'Bash')
  })

  it('detects non-empty tool input objects', () => {
    assert.equal(cliToolHasInput({ path: '/a' }), true)
    assert.equal(cliToolHasInput({}), false)
    assert.equal(cliToolHasInput(null), false)
    assert.equal(shouldAdoptMappedTool('terminal', 'fs_read'), true)
    assert.equal(shouldAdoptMappedTool('external', 'fs_read'), false)
    assert.equal(shouldAdoptMappedTool('external', 'external'), true)
  })

  it('patches live CLI tool cards from driver events', () => {
    const block = newCliToolCallBlock({
      id: 't',
      tool: 'fs_read',
      summary: 'read',
      input: '{}'
    })
    const deps = {
      inputJson: (input: unknown) => JSON.stringify(input ?? {}),
      summarize: (_name: string, input: unknown) =>
        String((input as { path?: string }).path ?? ''),
      mapToolName: (name: string) =>
        name === 'Bash' ? ('terminal' as const) : ('external' as const)
    }
    applyCliToolPatch(block, { status: 'started', name: 'Bash', input: { path: '/a.ts' } }, deps)
    assert.equal(block.status, 'executing')
    assert.equal(block.tool, 'terminal')
    assert.equal(block.summary, '/a.ts')
    applyCliToolPatch(block, { status: 'updated', name: 'Unknown', title: 'stay' }, deps)
    assert.equal(block.summary, 'stay')
    assert.equal(block.tool, 'terminal')
    applyCliToolPatch(block, { status: 'completed', name: 'Bash', output: 'ok' }, deps)
    assert.equal(block.status, 'completed')
    assert.equal(block.output, 'ok')
  })

  it('appends nested text/reasoning children', () => {
    const children: import('../../shared/types.ts').MessageBlock[] = []
    assert.equal(appendNestedChildDelta(children, 'text', ''), false)
    assert.equal(appendNestedChildDelta(children, 'text', 'Hello'), true)
    assert.equal(appendNestedChildDelta(children, 'text', ' world'), true)
    assert.equal(appendNestedChildDelta(children, 'reasoning', 'think'), true)
    assert.equal(children.length, 2)
    assert.equal(children[0]?.kind === 'text' ? children[0].text : '', 'Hello world')
    assert.equal(children[1]?.kind === 'reasoning' ? children[1].text : '', 'think')
  })

  it('ensures a pending tool card and builds a parent task', () => {
    const blocks: import('../../shared/types.ts').MessageBlock[] = []
    assert.equal(ensureToolCallBlock(blocks, 't1', 'run'), true)
    assert.equal(ensureToolCallBlock(blocks, 't1', 'again'), false)
    assert.equal(blocks[0]?.kind === 'toolCall' ? blocks[0].id : '', 't1')
    const parent = newCliParentTaskBlock('p1', 'Task')
    assert.equal(parent.tool, 'task')
    assert.equal(parent.status, 'executing')
    assert.deepEqual(parent.children, [])
  })

  it('prefers title, then summarized args, then the raw tool name', () => {
    const summarize = (name: string, input: unknown) =>
      input ? `${name}:${JSON.stringify(input)}` : ''
    assert.equal(
      cliToolCardSummary({ title: 'Read notes', name: 'fs_read', input: { path: 'a' } }, summarize),
      'Read notes'
    )
    assert.equal(
      cliToolCardSummary({ name: 'fs_read', input: { path: 'a' } }, summarize),
      'fs_read:{"path":"a"}'
    )
    assert.equal(cliToolCardSummary({ name: 'fs_read' }, summarize), 'fs_read')
  })

  it('indexes tool cards, patches approval fields, and skips unchanged emits', () => {
    const blocks = [
      { kind: 'text', text: 'hi' },
      newCliToolCallBlock({ id: 't1', tool: 'fs_read', summary: 'read', input: '{}' })
    ]
    assert.equal(toolCallBlockIndex(blocks, 't1'), 1)
    assert.equal(toolCallBlockIndex(blocks, 'missing'), -1)

    const state = { status: 'pending', output: '', choices: ['Approve', 'Deny'], askTitle: 'Run' }
    applyToolStatePatch(state, { status: 'executing', choices: undefined, askTitle: undefined })
    assert.equal(state.status, 'executing')
    assert.equal('choices' in state, false)
    assert.equal('askTitle' in state, false)

    const sent = new Map<string, string>()
    assert.equal(rememberSentToolCard(sent, 't1', '{"a":1}'), true)
    assert.equal(rememberSentToolCard(sent, 't1', '{"a":1}'), false)
    assert.equal(rememberSentToolCard(sent, 't1', '{"a":2}'), true)
  })

  it('inserts a parent task once and seals open reasoning', () => {
    const turn = {
      blocks: [] as ReturnType<typeof newCliToolCallBlock>[],
      toolIndex: new Map<string, number>(),
      textIndex: 3 as number | null,
      reasoningIndex: 1 as number | null
    }
    let sealed = 0
    const first = ensureCliParentTask(turn, 'task-1', 'Task', () => {
      sealed += 1
    })
    assert.equal(first.tool, 'task')
    assert.equal(first.status, 'executing')
    assert.equal(turn.blocks.length, 1)
    assert.equal(turn.toolIndex.get('task-1'), 0)
    assert.equal(turn.textIndex, null)
    assert.equal(turn.reasoningIndex, null)
    assert.equal(sealed, 1)
    const again = ensureCliParentTask(turn, 'task-1', 'Task', () => {
      sealed += 1
    })
    assert.equal(again, first)
    assert.equal(sealed, 1)
  })
})
