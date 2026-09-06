import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { ChatMessage } from '../../shared/types.ts'
import { ensureTimerOutput, lastAssistantText } from './timerOutput.ts'

function assistant(id: string, parentId: string | null, text: string): ChatMessage {
  return {
    id,
    parentId,
    role: 'assistant',
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt: 1
  }
}

describe('lastAssistantText', () => {
  it('returns the leaf assistant text', () => {
    const messages = [
      { id: 'u1', parentId: null, role: 'user', content: 'go', blocks: [{ kind: 'text', text: 'go' }], createdAt: 1 },
      assistant('a1', 'u1', 'done')
    ] as ChatMessage[]
    assert.equal(lastAssistantText(messages, 'a1'), 'done')
    assert.equal(lastAssistantText(messages, null), 'done')
  })
})

describe('ensureTimerOutput', () => {
  it('leaves an existing OUTPUT.md alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-timer-out-'))
    const existing = join(dir, 'OUTPUT.md')
    writeFileSync(existing, 'already\n', 'utf8')
    const path = ensureTimerOutput(dir, [], null)
    assert.equal(path, existing)
    assert.equal(readFileSync(existing, 'utf8'), 'already\n')
  })

  it('writes the last assistant reply when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-timer-out-'))
    const messages = [assistant('a1', null, 'report')] as ChatMessage[]
    const path = ensureTimerOutput(dir, messages, 'a1')
    assert.ok(path)
    assert.equal(existsSync(path!), true)
    assert.equal(readFileSync(path!, 'utf8'), 'report\n')
  })
})
