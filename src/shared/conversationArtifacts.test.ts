import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChangeSet } from './changeSet.ts'
import {
  collectConversationArtifacts,
  isFeaturedArtifact,
  partitionConversationArtifacts,
  relativeArtifactPath,
  writeToolPath
} from './conversationArtifacts.ts'
import type { ChatMessage, ToolCallBlock } from './types.ts'

function write(
  id: string,
  path: string,
  status: ToolCallBlock['status'] = 'completed'
): ToolCallBlock {
  return {
    kind: 'toolCall',
    id,
    tool: 'fs_write',
    summary: path,
    input: JSON.stringify({ path, contents: 'x' }),
    output: 'ok',
    status
  }
}

function assistant(id: string, blocks: ChatMessage['blocks'], changeSetId?: string): ChatMessage {
  return {
    id,
    parentId: 'u1',
    role: 'assistant',
    content: id,
    blocks,
    createdAt: 1,
    changeSetId
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
  it('collects unique writes from the visible thread and change sets', () => {
    const changeSet: ChangeSet = {
      id: 'cs-1',
      conversationId: 'c',
      turnTitle: 't',
      model: 'm',
      risk: 'low',
      status: 'pending',
      createdAt: 1,
      files: [
        {
          filePath: '/tmp/ws/slides.pptx',
          relativePath: 'slides.pptx',
          changeType: 'added',
          diffText: '',
          originalContent: null,
          newContent: '',
          status: 'pending',
          riskLevel: 'low'
        },
        {
          filePath: '/tmp/ws/gone.md',
          relativePath: 'gone.md',
          changeType: 'deleted',
          diffText: '',
          originalContent: '',
          newContent: '',
          status: 'pending',
          riskLevel: 'low'
        }
      ]
    }
    const artifacts = collectConversationArtifacts({
      workdir: '/tmp/ws',
      changeSetsById: { 'cs-1': changeSet },
      messages: [
        {
          id: 'u1',
          parentId: null,
          role: 'user',
          content: 'go',
          blocks: [{ kind: 'text', text: 'go' }],
          createdAt: 1
        },
        assistant(
          'a1',
          [
            write('w1', '/tmp/ws/note.md'),
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
              children: [write('w4', '/tmp/ws/chart.png')]
            }
          ],
          'cs-1'
        )
      ],
      liveBlocks: [write('live', '/tmp/ws/draft.html', 'executing')]
    })
    assert.deepEqual(
      artifacts.map((item) => item.name),
      ['chart.png', 'note.md', 'slides.pptx', 'draft.html', 'app.ts']
    )
    assert.equal(artifacts.find((item) => item.name === 'draft.html')?.draft, true)
    assert.equal(artifacts.find((item) => item.name === 'app.ts')?.featured, false)
    assert.ok(!artifacts.some((item) => item.name === 'x.js'))
    assert.ok(!artifacts.some((item) => item.name === 'gone.md'))
  })

  it('dedupes the same path from write + change set', () => {
    const changeSet: ChangeSet = {
      id: 'cs',
      conversationId: 'c',
      turnTitle: 't',
      model: 'm',
      risk: 'low',
      status: 'accepted',
      createdAt: 1,
      files: [
        {
          filePath: '/tmp/ws/note.md',
          relativePath: 'note.md',
          changeType: 'added',
          diffText: '',
          originalContent: null,
          newContent: 'hi',
          status: 'accepted',
          riskLevel: 'low'
        }
      ]
    }
    const artifacts = collectConversationArtifacts({
      workdir: '/tmp/ws',
      changeSetsById: { cs: changeSet },
      messages: [assistant('a1', [write('w1', '/tmp/ws/note.md')], 'cs')]
    })
    assert.equal(artifacts.length, 1)
    assert.equal(artifacts[0]?.name, 'note.md')
    assert.equal(artifacts[0]?.draft, false)
  })
})

describe('partitionConversationArtifacts', () => {
  it('keeps featured rows visible and collapses source files', () => {
    const artifacts = collectConversationArtifacts({
      workdir: '/tmp/ws',
      messages: [
        assistant('a1', [
          write('a', '/tmp/ws/index.html'),
          write('b', '/tmp/ws/a.ts'),
          write('c', '/tmp/ws/b.ts')
        ])
      ]
    })
    const { pinned, extra } = partitionConversationArtifacts(artifacts)
    assert.deepEqual(
      pinned.map((item) => item.name),
      ['index.html']
    )
    assert.deepEqual(
      extra.map((item) => item.name).sort(),
      ['a.ts', 'b.ts']
    )
  })
})
