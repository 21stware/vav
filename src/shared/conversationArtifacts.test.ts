import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ARTIFACT_MARKER,
  collectConversationArtifacts,
  hasArtifactMarker,
  isArtifactWrite,
  isFeaturedArtifact,
  relativeArtifactPath,
  writeToolPath
} from './conversationArtifacts.ts'
import type { ChatMessage, ToolCallBlock } from './types.ts'

function write(
  id: string,
  path: string,
  status: ToolCallBlock['status'] = 'completed',
  extra?: { contents?: string; artifact?: boolean }
): ToolCallBlock {
  const contents = extra?.contents ?? 'x'
  const input: Record<string, unknown> = { path, contents }
  if (extra?.artifact) input.artifact = true
  return {
    kind: 'toolCall',
    id,
    tool: 'fs_write',
    summary: path,
    input: JSON.stringify(input),
    output: 'ok',
    status
  }
}

function marked(id: string, path: string, status: ToolCallBlock['status'] = 'completed'): ToolCallBlock {
  return write(id, path, status, { contents: `${ARTIFACT_MARKER}\nbody\n` })
}

function assistant(id: string, blocks: ChatMessage['blocks']): ChatMessage {
  return {
    id,
    parentId: 'u1',
    role: 'assistant',
    content: id,
    blocks,
    createdAt: 1
  }
}

describe('writeToolPath', () => {
  it('reads path aliases used by CLI write tools', () => {
    assert.equal(writeToolPath('fs_write', { path: '/a.md' }), '/a.md')
    assert.equal(writeToolPath('Write', { file_path: '/b.ts' }), '/b.ts')
    assert.equal(writeToolPath('create_file', { target_file: 'c.html' }), 'c.html')
    assert.equal(writeToolPath('fs_read', { path: '/no.md' }), null)
  })
})

describe('hasArtifactMarker / isArtifactWrite', () => {
  it('detects the HTML comment in the file head', () => {
    assert.equal(hasArtifactMarker(`${ARTIFACT_MARKER}\n# Title\n`), true)
    assert.equal(hasArtifactMarker('<!--  vav-artifact  -->\n'), true)
    assert.equal(hasArtifactMarker('# Title\nplain\n'), false)
  })

  it('accepts artifact: true on the write payload', () => {
    assert.equal(isArtifactWrite('fs_write', { path: '/a.pptx', content: '', artifact: true }), true)
    assert.equal(isArtifactWrite('fs_write', { path: '/a.md', contents: 'hi' }), false)
    assert.equal(
      isArtifactWrite('fs_write', { path: '/a.md', contents: `${ARTIFACT_MARKER}\nhi` }),
      true
    )
  })
})

describe('relativeArtifactPath', () => {
  it('strips the workdir prefix', () => {
    assert.equal(relativeArtifactPath('/tmp/ws/note.md', '/tmp/ws'), 'note.md')
    assert.equal(relativeArtifactPath('/tmp/ws/docs/a.pdf', '/tmp/ws'), 'docs/a.pdf')
    assert.equal(relativeArtifactPath('/elsewhere/a.md', '/tmp/ws'), '/elsewhere/a.md')
  })
})

describe('isFeaturedArtifact', () => {
  it('pins deliverables, not source edits', () => {
    assert.equal(isFeaturedArtifact('html', 'landing.html'), true)
    assert.equal(isFeaturedArtifact('pdf', 'report.pdf'), true)
    assert.equal(isFeaturedArtifact('text', 'note.md'), true)
    assert.equal(isFeaturedArtifact('text', 'src/app.ts'), false)
  })
})

describe('collectConversationArtifacts', () => {
  it('keeps only marked writes, not ordinary source edits or change-set files', () => {
    const artifacts = collectConversationArtifacts({
      workdir: '/tmp/ws',
      messages: [
        {
          id: 'u1',
          parentId: null,
          role: 'user',
          content: 'go',
          blocks: [{ kind: 'text', text: 'go' }],
          createdAt: 1
        },
        assistant('a1', [
          marked('w1', '/tmp/ws/note.md'),
          write('w2', '/tmp/ws/src/app.ts'),
          write('w3', '/tmp/ws/node_modules/x.js'),
          {
            kind: 'toolCall',
            id: 'task',
            tool: 'task',
            summary: 'child',
            input: '{}',
            output: '',
            status: 'completed',
            children: [marked('w4', '/tmp/ws/chart.png')]
          }
        ])
      ],
      liveBlocks: [write('live', '/tmp/ws/draft.html', 'executing', { artifact: true })]
    })
    assert.deepEqual(
      artifacts.map((item) => item.name),
      ['chart.png', 'note.md', 'draft.html']
    )
    assert.equal(artifacts.find((item) => item.name === 'draft.html')?.draft, true)
    assert.ok(!artifacts.some((item) => item.name === 'app.ts'))
    assert.ok(!artifacts.some((item) => item.name === 'x.js'))
  })

  it('drops a path when a later completed write is unmarked', () => {
    const artifacts = collectConversationArtifacts({
      workdir: '/tmp/ws',
      messages: [
        assistant('a1', [
          marked('w1', '/tmp/ws/note.md'),
          write('w2', '/tmp/ws/note.md', 'completed', { contents: 'plain\n' })
        ])
      ]
    })
    assert.equal(artifacts.length, 0)
  })

  it('does not drop a marked file while a live unmarked rewrite is still streaming', () => {
    const artifacts = collectConversationArtifacts({
      workdir: '/tmp/ws',
      messages: [assistant('a1', [marked('w1', '/tmp/ws/note.md')])],
      liveBlocks: [write('live', '/tmp/ws/note.md', 'executing', { contents: 'still typing' })]
    })
    assert.equal(artifacts.length, 1)
    assert.equal(artifacts[0]?.name, 'note.md')
    assert.equal(artifacts[0]?.draft, false)
  })
})
