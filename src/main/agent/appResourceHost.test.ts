import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { formatAppResourceUrl } from '../../shared/appResourceUrl.ts'
import { ConversationStore } from '../store/ConversationStore.ts'
import { KnowledgeStore } from '../store/KnowledgeStore.ts'
import { TimerStore } from '../store/TimerStore.ts'
import { DbConnectionStore } from '../store/DbConnectionStore.ts'
import { createAppResourceHost } from './appResourceHost.ts'

function memoryVault() {
  const map = new Map<string, string>()
  return {
    get: (id: string) => map.get(id) ?? null,
    set: (id: string, password: string) => {
      map.set(id, password)
    },
    clear: (id: string) => {
      map.delete(id)
    }
  }
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'vav-app-host-'))
  const conversations = new ConversationStore(dir)
  conversations.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
  const knowledge = new KnowledgeStore(dir)
  knowledge.load()
  const timers = new TimerStore(dir)
  timers.load()
  const dbConnections = new DbConnectionStore(dir, memoryVault())
  dbConnections.load()
  const written: Array<{ path: string; content: string }> = []
  const granted: string[] = []
  const applied: Array<{ type: string; url: string; kind: string }> = []
  const host = createAppResourceHost({
    conversations,
    knowledge,
    timers,
    dbConnections,
    files: {
      readTextWindow: async (path) => ({
        content: written.find((row) => row.path === path)?.content ?? '',
        error: null
      }),
      writeTextFile: async (path, content) => {
        written.push({ path, content })
        writeFileSync(path, content)
        return { ok: true }
      }
    },
    createAppConversation: (kind) => {
      const row = conversations.create(join(dir, 'ws'), 'm', {
        sessionKind: kind,
        title:
          kind === 'timer' ? 'Untitled-scheduled-task' : kind === 'db' ? 'Untitled-db' : 'Untitled-note'
      })
      return { id: row.id, title: row.title }
    },
    grantPath: (path) => {
      granted.push(path)
    },
    onApply: (event) => {
      applied.push(event)
    }
  })
  return { dir, host, conversations, knowledge, timers, dbConnections, written, granted, applied }
}

describe('createAppResourceHost', () => {
  it('creates, reads, and rewrites a knowledge note bound to a conversation', async () => {
    const { dir, host, conversations, knowledge, applied } = harness()
    try {
      const created = await host.create({
        kind: 'knowledge',
        title: 'Launch notes',
        content: 'Ship the app column tools.'
      })
      if ('error' in created) throw new Error(created.error)
      assert.match(created.url, /vav:\/\/app\/knowledge/)
      assert.deepEqual(applied, [{ type: 'open', url: created.url, kind: 'knowledge' }])
      const read = await host.read(created.url)
      if ('error' in read) throw new Error(read.error)
      assert.match(read.text, /Launch notes/)
      assert.match(read.text, /Ship the app column tools/)
      const written = await host.write(created.url, '# Launch notes\n\nUpdated body.')
      if ('error' in written) throw new Error(written.error)
      const again = await host.read(created.url)
      if ('error' in again) throw new Error(again.error)
      assert.match(again.text, /Updated body/)
      const hostId = knowledge.list()[0]?.id
      assert.ok(hostId)
      assert.ok(conversations.all().some((row) => row.knowledgeHostId === hostId))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates, reads, and updates a scheduled task', async () => {
    const { dir, host, timers } = harness()
    try {
      const created = await host.create({
        kind: 'scheduled',
        title: 'Morning digest',
        prompt: 'Summarize overnight deploys.',
        schedule: '0 9 * * 1-5',
        enabled: true
      })
      if ('error' in created) throw new Error(created.error)
      const read = await host.read(created.url)
      if ('error' in read) throw new Error(read.error)
      assert.match(read.text, /Morning digest/)
      assert.match(read.text, /Summarize overnight deploys/)
      assert.match(read.text, /0 9 \* \* 1-5/)
      assert.match(read.text, /Enabled: yes/)
      const updated = await host.write(created.url, 'Also include incidents.', {
        schedule: 'every 1h',
        enabled: false
      })
      if ('error' in updated) throw new Error(updated.error)
      const job = timers.listJobs()[0]
      assert.equal(job?.enabled, false)
      assert.equal(job?.schedule.kind, 'interval')
      assert.equal(job?.prompt, 'Also include incidents.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates a Data file object and lists it', async () => {
    const { dir, host } = harness()
    try {
      const path = join(dir, 'sales.csv')
      const created = await host.create({
        kind: 'data',
        path,
        content: 'sku,qty\nA,2\n'
      })
      if ('error' in created) throw new Error(created.error)
      assert.match(created.url, /vav:\/\/app\/data/)
      const listed = host.list('data')
      assert.equal(listed.length, 1)
      assert.equal(listed[0]?.path, path)
      const read = await host.read(created.url)
      if ('error' in read) throw new Error(read.error)
      assert.match(read.text, /sales\.csv/)
      assert.match(read.text, /sql_query/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates a live Data connection from a URL', async () => {
    const { dir, host, dbConnections } = harness()
    try {
      const created = await host.create({
        kind: 'data',
        title: 'sakila',
        connectionUrl: 'postgres://reader:secret@db.example:5432/sakila'
      })
      if ('error' in created) throw new Error(created.error)
      const connection = dbConnections.list()[0]
      assert.equal(connection?.driver, 'postgres')
      assert.equal(connection?.database, 'sakila')
      const read = await host.read(created.url)
      if ('error' in read) throw new Error(read.error)
      assert.match(read.text, /postgres/)
      assert.doesNotMatch(read.text, /secret/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('grants and resolves a storage path against the conversation workdir', async () => {
    const { dir, host, conversations, granted, written } = harness()
    try {
      const agent = conversations.create(join(dir, 'ws'), 'm', { sessionKind: 'workspace' })
      mkdirSync(join(dir, 'ws'), { recursive: true })
      const scoped = createAppResourceHost({
        conversations,
        conversationId: agent.id,
        grantPath: (path) => {
          granted.push(path)
        },
        files: {
          readTextWindow: async () => ({ content: '', error: null }),
          writeTextFile: async (path, content) => {
            written.push({ path, content })
            writeFileSync(path, content)
            return { ok: true }
          }
        }
      })
      const created = await scoped.create({
        kind: 'storage',
        path: 'keep.md',
        content: '# Keep'
      })
      if ('error' in created) throw new Error(created.error)
      const expected = join(dir, 'ws', 'keep.md')
      assert.equal(written.at(-1)?.path, expected)
      assert.ok(granted.includes(expected))
      assert.match(created.url, /vav:\/\/app\/storage/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses create when the catalog factory is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-app-host-nofactory-'))
    try {
      const conversations = new ConversationStore(dir)
      conversations.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      const host = createAppResourceHost({
        conversations,
        files: {
          readTextWindow: async () => ({ content: '', error: null }),
          writeTextFile: async () => ({ ok: true })
        }
      })
      const created = await host.create({ kind: 'knowledge', content: '# Nope' })
      assert.ok('error' in created)
      assert.match(created.error, /unavailable/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists catalog kinds with vav://app URLs', async () => {
    const { dir, host } = harness()
    try {
      await host.create({ kind: 'knowledge', title: 'A', content: '# A' })
      await host.create({ kind: 'scheduled', title: 'B', prompt: 'Ping' })
      const rows = host.list()
      assert.ok(rows.some((row) => row.kind === 'knowledge' && row.url.startsWith('vav://app/knowledge')))
      assert.ok(rows.some((row) => row.kind === 'scheduled' && row.url.startsWith('vav://app/scheduled')))
      assert.equal(formatAppResourceUrl({ kind: 'scheduled' }), 'vav://app/scheduled')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exposes the conversation app-column focus url', async () => {
    const { dir, conversations, knowledge } = harness()
    try {
      const agent = conversations.create(join(dir, 'ws'), 'm', { sessionKind: 'workspace' })
      const created = knowledge.createNote('Focus note', agent.id)
      const url = formatAppResourceUrl({ kind: 'knowledge', id: created.id })
      conversations.updateMeta(agent.id, {
        appColumnFocus: {
          kind: 'knowledge',
          level: 'item',
          title: 'Focus note',
          path: created.storedPath,
          objectId: agent.id,
          url
        }
      })
      const focused = createAppResourceHost({
        conversations,
        knowledge,
        conversationId: agent.id,
        files: {
          readTextWindow: async () => ({ content: '', error: null }),
          writeTextFile: async () => ({ ok: true })
        }
      })
      assert.equal(focused.focusedUrl?.(), url)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
