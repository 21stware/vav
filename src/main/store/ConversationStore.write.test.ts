import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ConversationStore } from './ConversationStore.ts'

function openStore(dir: string): ConversationStore {
  const store = new ConversationStore(dir)
  store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
  return store
}

describe('ConversationStore writes', () => {
  it('keeps the latest shard when a sync flush lands during an async write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-conv-race-'))
    try {
      const store = openStore(dir)
      const created = store.create(join(dir, 'ws'), 'm', { id: 'race', title: 'v1' })
      store.flush()

      store.updateMeta(created.id, { title: 'v2' })
      let release!: () => void
      store.writeRenameHold = new Promise<void>((resolve) => {
        release = resolve
      })
      const asyncFlush = store.flushAsync()
      store.updateMeta(created.id, { title: 'v3' })
      store.flush()
      release()
      await asyncFlush

      const shard = JSON.parse(readFileSync(join(dir, 'conversations', 'race.json'), 'utf8')) as {
        title: string
      }
      assert.equal(shard.title, 'v3')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renames a corrupt shard and keeps its id in the index', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-conv-corrupt-'))
    try {
      const conversationsDir = join(dir, 'conversations')
      mkdirSync(conversationsDir, { recursive: true })
      writeFileSync(join(conversationsDir, 'broken.json'), '{not-json', 'utf8')
      writeFileSync(
        join(conversationsDir, 'index.json'),
        JSON.stringify({ version: 2, ids: ['broken'] }),
        'utf8'
      )

      const store = openStore(dir)
      assert.equal(store.get('broken'), undefined)
      const renamed = readdirSync(conversationsDir).filter((name) =>
        name.startsWith('broken.json.corrupt-')
      )
      assert.equal(renamed.length, 1)
      assert.equal(existsSync(join(conversationsDir, 'broken.json')), false)

      store.create(join(dir, 'ws'), 'm', { id: 'other', title: 'ok' })
      store.flush()
      const index = JSON.parse(readFileSync(join(conversationsDir, 'index.json'), 'utf8')) as {
        ids: string[]
      }
      assert.ok(index.ids.includes('broken'))
      assert.ok(index.ids.includes('other'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
