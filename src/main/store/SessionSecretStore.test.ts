import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { SessionSecretStore } from './SessionSecretStore.ts'

describe('SessionSecretStore', () => {
  it('keeps values in memory and on disk, never mixing conversations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-session-secrets-'))
    try {
      const store = new SessionSecretStore({ dir })
      assert.deepEqual(store.setMany('c1', { OPENAI_API_KEY: 'sk-live', '1BAD': 'no' }), [
        'OPENAI_API_KEY'
      ])
      assert.deepEqual(store.listNames('c1'), ['OPENAI_API_KEY'])
      assert.equal(store.getEnv('c1').OPENAI_API_KEY, 'sk-live')
      assert.deepEqual(store.getEnv('c2'), {})

      const again = new SessionSecretStore({ dir })
      assert.equal(again.getEnv('c1').OPENAI_API_KEY, 'sk-live')
      const body = readFileSync(join(dir, 'c1.json'), 'utf8')
      assert.match(body, /OPENAI_API_KEY/)
      assert.doesNotMatch(body, /1BAD/)

      store.clear('c1')
      assert.deepEqual(store.getEnv('c1'), {})
      assert.deepEqual(again.getEnv('c1'), { OPENAI_API_KEY: 'sk-live' })
      const after = new SessionSecretStore({ dir })
      assert.deepEqual(after.getEnv('c1'), {})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('works without a persist directory', () => {
    const store = new SessionSecretStore()
    store.setMany('c1', { GH_TOKEN: 'ghs_x' })
    assert.equal(store.getEnv('c1').GH_TOKEN, 'ghs_x')
    store.clear('c1')
    assert.deepEqual(store.getEnv('c1'), {})
  })

  it('removes one name and notifies listeners', () => {
    const events: Array<{ id: string; names: string[] }> = []
    const store = new SessionSecretStore()
    store.onChanged((id, names) => events.push({ id, names }))
    store.setMany('c1', { A: '1', B: '2' })
    assert.equal(store.remove('c1', 'A'), true)
    assert.deepEqual(store.listNames('c1'), ['B'])
    assert.equal(store.remove('c1', 'B'), true)
    assert.deepEqual(store.listNames('c1'), [])
    assert.equal(store.remove('c1', 'B'), false)
    assert.deepEqual(
      events.map((row) => row.names),
      [['A', 'B'], ['B'], []]
    )
  })

  it('writes through a persist adapter and migrates leftover json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-session-secrets-'))
    const blobs = new Map<string, string>()
    try {
      writeFileSync(join(dir, 'c1.json'), JSON.stringify({ LEGACY: 'plain' }))
      const store = new SessionSecretStore({
        dir,
        persist: {
          read: (id) => blobs.get(id) ?? null,
          write: (id, json) => {
            blobs.set(id, json)
          },
          remove: (id) => {
            blobs.delete(id)
          }
        }
      })
      assert.equal(store.getEnv('c1').LEGACY, 'plain')
      assert.match(blobs.get('c1') ?? '', /LEGACY/)
      assert.equal(existsJson(dir, 'c1'), false)

      store.setMany('c1', { NEXT: 'v' })
      assert.equal(existsJson(dir, 'c1'), false)
      const parsed = JSON.parse(blobs.get('c1') ?? '{}') as Record<string, string>
      assert.equal(parsed.LEGACY, 'plain')
      assert.equal(parsed.NEXT, 'v')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function existsJson(dir: string, id: string): boolean {
  try {
    readFileSync(join(dir, `${id}.json`))
    return true
  } catch {
    return false
  }
}
