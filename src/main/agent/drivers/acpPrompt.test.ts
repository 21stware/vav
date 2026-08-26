import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { buildAcpPrompt } from './acpPrompt.ts'

describe('buildAcpPrompt', () => {
  it('embeds a small text attachment when the agent advertises embeddedContext', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-prompt-'))
    const path = join(dir, 'notes.md')
    await writeFile(path, '# hi', 'utf8')
    const blocks = await buildAcpPrompt({
      text: 'please read this',
      attachments: [path],
      capabilities: { image: false, audio: false, embeddedContext: true }
    })
    assert.equal(blocks[0]?.type, 'text')
    assert.equal(blocks[1]?.type, 'resource')
    if (blocks[1]?.type === 'resource') {
      assert.equal(blocks[1].resource.text, '# hi')
      assert.ok(blocks[1].resource.uri.startsWith('file://'))
    }
  })

  it('falls back to a resource_link when embedded context is off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-acp-prompt-'))
    const path = join(dir, 'notes.md')
    await writeFile(path, '# hi', 'utf8')
    const blocks = await buildAcpPrompt({
      text: 'please read this',
      attachments: [path],
      capabilities: { image: false, audio: false, embeddedContext: false }
    })
    assert.equal(blocks[1]?.type, 'resource_link')
    if (blocks[1]?.type === 'resource_link') {
      assert.equal(blocks[1].name, 'notes.md')
      assert.ok(blocks[1].uri.startsWith('file://'))
    }
  })
})
