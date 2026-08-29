import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatMessage } from './types.ts'
import { projectRemoteMessages, remoteSessionPreview } from './remoteThread.ts'

function msg(
  id: string,
  parentId: string | null,
  role: ChatMessage['role'],
  content: string
): ChatMessage {
  return {
    id,
    parentId,
    role,
    content,
    blocks: [{ kind: 'text', text: content }],
    createdAt: 1
  }
}

describe('projectRemoteMessages', () => {
  it('drops system, keeps last turns, and preserves markdown', () => {
    const path = [
      msg('s', null, 'system', 'hidden'),
      msg('u1', 's', 'user', '**hello** world'),
      msg('a1', 'u1', 'assistant', ''),
      msg('u2', 'a1', 'user', 'continue')
    ]
    const rows = projectRemoteMessages(path)
    assert.deepEqual(
      rows.map((r) => [r.role, r.text]),
      [
        ['user', '**hello** world'],
        ['assistant', '（工具回合）'],
        ['user', 'continue']
      ]
    )
  })

  it('keeps assistant newlines for the phone log', () => {
    const rows = projectRemoteMessages([msg('a1', null, 'assistant', 'hello\n\n**world**')])
    assert.equal(rows[0]?.text, 'hello\n\n**world**')
  })

  it('projects thinking even when the answer is still empty', () => {
    const rows = projectRemoteMessages([
      {
        id: 'a1',
        parentId: null,
        role: 'assistant',
        content: '',
        createdAt: 1,
        blocks: [{ kind: 'reasoning', text: 'first consider the folder' }]
      }
    ])
    assert.equal(rows[0]?.text, '')
    assert.deepEqual(rows[0]?.blocks, [
      { kind: 'reasoning', text: 'first consider the folder' }
    ])
  })

  it('projects thinking and answer as sibling blocks', () => {
    const rows = projectRemoteMessages([
      {
        id: 'a1',
        parentId: null,
        role: 'assistant',
        content: 'done',
        createdAt: 1,
        blocks: [
          { kind: 'reasoning', text: 'consider the tests' },
          { kind: 'text', text: 'done' }
        ]
      }
    ])
    assert.deepEqual(
      rows[0]?.blocks?.map((block) => [block.kind, 'text' in block ? block.text : '']),
      [
        ['reasoning', 'consider the tests'],
        ['text', 'done']
      ]
    )
  })

  it('projects a tool card with a human name, not the schema id', () => {
    const rows = projectRemoteMessages([
      {
        id: 'a1',
        parentId: null,
        role: 'assistant',
        content: '',
        createdAt: 1,
        blocks: [
          {
            kind: 'toolCall',
            id: 't1',
            tool: 'fs_read',
            summary: 'src/index.ts',
            input: '',
            output: '',
            status: 'done'
          }
        ]
      }
    ])
    const tool = rows[0]?.blocks?.[0]
    assert.equal(tool?.kind, 'tool')
    assert.equal(tool && 'tool' in tool ? tool.tool : '', 'fs_read')
    assert.equal(tool && 'name' in tool ? tool.name : '', '读取文件')
  })

  it('previews the last visible turn', () => {
    const path = [msg('u1', null, 'user', 'pick this session about the daemon pairing')]
    assert.match(remoteSessionPreview(path), /daemon pairing/)
  })
})
