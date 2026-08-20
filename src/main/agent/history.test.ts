import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { buildHistory } from './history.ts'
import {
  MAX_INLINE_IMAGES,
  loadInlineImages
} from './attachmentImages.ts'
import type { Api, Model } from '@earendil-works/pi-ai'

function fakeModel(input: ('text' | 'image')[] = ['text', 'image']): Model<Api> {
  return {
    id: 'test-model',
    name: 'test-model',
    api: 'anthropic-messages',
    provider: 'vav',
    baseUrl: 'https://example.invalid',
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_384
  }
}

function userMessage(id: string, text: string, attachments?: string[]): any {
  return {
    id,
    parentId: null,
    role: 'user',
    content: text,
    blocks: [{ kind: 'text', text }],
    createdAt: Date.now(),
    ...(attachments?.length ? { attachments } : {})
  }
}

const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function makeImage(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.from(PNG_1PX_BASE64, 'base64'))
  return path
}

describe('buildHistory image inlining', () => {
  it('keeps text-only history as a single text part', () => {
    const messages = [userMessage('u1', 'hello')]
    const history = buildHistory(messages, 'u1', fakeModel())
    assert.equal(history.length, 1)
    const first = history[0]!
    assert.equal(first.role, 'user')
    assert.deepEqual(first.content, [{ type: 'text', text: 'hello' }])
  })

  it('inlines preloaded images ahead of the text part and keeps the path list', () => {
    const img = '/tmp/a.png'
    const messages = [userMessage('u1', 'look at this', [img])]
    const inline = new Map([['/tmp/a.png', { data: 'QUJD', mimeType: 'image/png' }]])
    const history = buildHistory(messages, 'u1', fakeModel(), null, inline)
    const first = history[0]!
    assert.equal(first.role, 'user')
    assert.deepEqual(first.content, [
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
      { type: 'text', text: 'Attachments:\n- /tmp/a.png\n\nlook at this' }
    ])
  })

  it('leaves attachments as text when no image map is provided', () => {
    const messages = [userMessage('u1', 'look', ['/tmp/a.png'])]
    const history = buildHistory(messages, 'u1', fakeModel())
    const first = history[0]!
    assert.deepEqual(first.content, [
      { type: 'text', text: 'Attachments:\n- /tmp/a.png\n\nlook' }
    ])
  })

  it('only inlines images the map actually resolved', () => {
    const messages = [userMessage('u1', 'two files', ['/tmp/a.png', '/tmp/b.png'])]
    const inline = new Map([['/tmp/b.png', { data: 'REI=', mimeType: 'image/png' }]])
    const history = buildHistory(messages, 'u1', fakeModel(), null, inline)
    const first = history[0]!
    assert.equal(first.content.length, 2)
    assert.deepEqual(first.content[0], { type: 'image', data: 'REI=', mimeType: 'image/png' })
    assert.match((first.content[1] as any).text, /Attachments:\n- \/tmp\/a\.png\n- \/tmp\/b\.png/)
  })

  it('emits image-only content when the bubble text is empty', () => {
    const messages = [userMessage('u1', '', ['/tmp/a.png'])]
    const inline = new Map([['/tmp/a.png', { data: 'QUJD', mimeType: 'image/png' }]])
    const history = buildHistory(messages, 'u1', fakeModel(), null, inline)
    const first = history[0]!
    assert.equal(first.content.length, 2) // Attachments line + image
    assert.equal(first.content[0]!.type, 'image')
  })
})

describe('loadInlineImages', () => {
  it('returns an empty map for text-only models', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-img-'))
    const path = makeImage(dir, 'a.png')
    const messages = [userMessage('u1', 'x', [path])]
    const map = await loadInlineImages(messages, 'u1', fakeModel(['text']))
    assert.equal(map.size, 0)
  })

  it('reads image attachments as base64 with mime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-img-'))
    const path = makeImage(dir, 'a.png')
    const messages = [userMessage('u1', 'x', [path])]
    const map = await loadInlineImages(messages, 'u1', fakeModel())
    assert.equal(map.size, 1)
    const image = map.get(path)!
    assert.equal(image.mimeType, 'image/png')
    assert.equal(image.data, PNG_1PX_BASE64)
  })

  it('ignores non-image attachments and read failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-img-'))
    const path = makeImage(dir, 'a.png')
    const missing = join(dir, 'missing.png')
    const messages = [userMessage('u1', 'x', [path, missing, join(dir, 'notes.txt')])]
    const map = await loadInlineImages(messages, 'u1', fakeModel())
    assert.equal(map.size, 1)
    assert.ok(map.has(path))
  })

  it(`caps at ${MAX_INLINE_IMAGES} most-recent images`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-img-'))
    const paths: string[] = []
    const messages: any[] = []
    for (let i = 0; i < MAX_INLINE_IMAGES + 3; i++) {
      const path = makeImage(dir, `img${String(i).padStart(2, '0')}.png`)
      paths.push(path)
      messages.push(userMessage(`u${i}`, `turn ${i}`, [path]))
    }
    // Link them into a thread: each message parents the next.
    for (let i = 1; i < messages.length; i++) messages[i]!.parentId = messages[i - 1]!.id
    const leaf = messages.at(-1)!.id
    const map = await loadInlineImages(messages, leaf, fakeModel())
    assert.equal(map.size, MAX_INLINE_IMAGES)
    // Newest survive; the three oldest degrade to the text path line.
    assert.ok(map.has(paths.at(-1)!))
    assert.ok(!map.has(paths[0]!))
  })
})
