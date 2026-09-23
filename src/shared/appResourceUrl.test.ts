import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appSearchPrompt,
  findAppResourceUrls,
  formatAppCatalogUrl,
  formatAppResourceUrl,
  isAppCatalogUrl,
  isAppResourceUrl,
  parseAppResourceUrl,
  planOpenInApp
} from './appResourceUrl.ts'

describe('appResourceUrl', () => {
  it('round-trips storage files and folders', () => {
    const file = formatAppResourceUrl({ kind: 'storage', path: '/tmp/hello.md' })
    assert.equal(file, 'vav://app/storage?path=%2Ftmp%2Fhello.md')
    assert.deepEqual(parseAppResourceUrl(file), { kind: 'storage', path: '/tmp/hello.md' })

    const folder = formatAppResourceUrl({ kind: 'storage', path: '/tmp/docs', dir: true })
    assert.equal(parseAppResourceUrl(folder)?.dir, true)
    assert.equal(parseAppResourceUrl(folder)?.path, '/tmp/docs')
  })

  it('round-trips data / knowledge / scheduled ids', () => {
    assert.deepEqual(parseAppResourceUrl(formatAppResourceUrl({ kind: 'data', id: 'db-1' })), {
      kind: 'data',
      id: 'db-1'
    })
    assert.deepEqual(
      parseAppResourceUrl(formatAppResourceUrl({ kind: 'knowledge', id: 'note-1', path: '/n.md' })),
      { kind: 'knowledge', id: 'note-1', path: '/n.md' }
    )
    assert.deepEqual(parseAppResourceUrl('vav://app/scheduled?id=job-1'), {
      kind: 'scheduled',
      id: 'job-1'
    })
  })

  it('treats kind-only URLs as list roots', () => {
    assert.deepEqual(parseAppResourceUrl('vav://app/storage'), { kind: 'storage' })
    assert.deepEqual(parseAppResourceUrl('vav://app/knowledge/'), { kind: 'knowledge' })
    assert.equal(isAppCatalogUrl('vav://app'), true)
    assert.equal(isAppCatalogUrl(formatAppCatalogUrl()), true)
    assert.equal(isAppResourceUrl('vav://app'), true)
    assert.equal(isAppResourceUrl('vav://app/storage'), true)
    assert.equal(isAppResourceUrl('https://example.com'), false)
    assert.equal(parseAppResourceUrl('vav://other/storage'), null)
  })

  it('finds URLs in tool output', () => {
    const hits = findAppResourceUrls(
      'Open vav://app/storage?path=/tmp/a.md and vav://app/data?id=x then ignore https://x'
    )
    assert.equal(hits.length, 2)
    assert.equal(hits[0]?.url, 'vav://app/storage?path=/tmp/a.md')
    assert.equal(hits[1]?.url, 'vav://app/data?id=x')
  })

  it('plans catalog, folder, file, and overlay opens', () => {
    assert.deepEqual(planOpenInApp({ raw: 'vav://app' }), { action: 'catalog' })
    assert.deepEqual(planOpenInApp({ raw: 'vav://app/data' }), { action: 'catalog', mode: 'data' })
    assert.deepEqual(planOpenInApp({ raw: '/tmp/docs', isDirectory: true }), {
      action: 'browse-folder',
      path: '/tmp/docs'
    })
    assert.deepEqual(planOpenInApp({ raw: 'vav://app/knowledge?id=note-1' }), {
      action: 'focus-object',
      id: 'note-1',
      mode: 'knowledge'
    })
    assert.deepEqual(planOpenInApp({ raw: '/tmp/a.md' }), { action: 'open-file', path: '/tmp/a.md' })
    assert.deepEqual(planOpenInApp({ raw: '  ' }), { action: 'invalid' })
  })

  it('builds a search prompt that cites the app tool', () => {
    const text = appSearchPrompt('Storage', 'hello.md')
    assert.match(text, /Search Storage for: hello\.md/)
    assert.match(text, /`app` tool/)
    assert.match(text, /vav:\/\/app/)
  })
})
