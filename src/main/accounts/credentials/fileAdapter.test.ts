import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFileAdapter } from './fileAdapter.ts'
import { parseFileSnapshotMeta } from './parseFileSnapshot.ts'

describe('file credential adapter', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vav-cred-'))
    path = join(dir, 'nested', 'auth.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('captures and restores grok auth.json atomically', async () => {
    mkdirSync(join(dir, 'nested'), { recursive: true })
    const first = JSON.stringify({
      'https://auth.x.ai': {
        key: 'tok-a',
        email: 'ada@x.ai',
        expires_at: '2099-01-01T00:00:00.000Z'
      }
    })
    writeFileSync(path, first)
    const adapter = makeFileAdapter({ host: 'grok', path: () => path })
    const snap = await adapter.capture()
    assert.equal(snap?.medium, 'file')
    assert.equal(snap?.identity, 'ada@x.ai')
    assert.equal(await adapter.liveIdentity(), 'ada@x.ai')

    const second = JSON.stringify({
      'https://auth.x.ai': { key: 'tok-b', email: 'bob@x.ai', expires_at: '2099-06-01T00:00:00.000Z' }
    })
    writeFileSync(path, second)
    assert.equal(await adapter.liveIdentity(), 'bob@x.ai')
    await adapter.restore(snap!)
    assert.equal(readFileSync(path, 'utf8'), first)
    assert.equal(await adapter.liveIdentity(), 'ada@x.ai')
    if (process.platform !== 'win32') {
      assert.equal(statSync(path).mode & 0o777, 0o600)
    }
  })

  it('returns null when the slot is empty', async () => {
    const adapter = makeFileAdapter({ host: 'codex', path: () => path })
    assert.equal(await adapter.capture(), null)
    assert.equal(await adapter.liveIdentity(), null)
  })

  it('parses grok / opencode identities from raw files', () => {
    const grok = parseFileSnapshotMeta(
      'grok',
      JSON.stringify({
        'https://auth.x.ai': { key: 'x', email: 'ada@x.ai', expires_at: '2030-01-01T00:00:00.000Z' }
      })
    )
    assert.equal(grok.identity, 'ada@x.ai')
    assert.ok((grok.expiresAtMs ?? 0) > Date.parse('2029-01-01'))
    const opencode = parseFileSnapshotMeta(
      'opencode',
      JSON.stringify({ 'opencode-go': { type: 'api', key: 'sk', email: 'zen@opencode.ai' } })
    )
    assert.equal(opencode.identity, 'zen@opencode.ai')
  })
})
