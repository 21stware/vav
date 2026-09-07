import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import type { Conversation } from '../../shared/types.ts'
import { isLocalMachine } from '../../shared/workspaceHost.ts'
import { ConversationStore } from './ConversationStore.ts'

describe('ConversationStore host bind', () => {
  it('keeps the local workbench row when the same id arrives from spawned vavd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-host-bind-'))
    try {
      const store = new ConversationStore(dir)
      store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      const local = store.create(join(dir, 'ws'), 'm', { id: 'e2e-session' })
      const adopted = store.adoptHostConversation(
        { ...local, title: 'Host copy' } as Conversation,
        'vavd-1'
      )
      assert.equal(adopted, null)
      assert.equal(store.findOnHost('vavd-1', 'e2e-session')?.id, 'e2e-session')
      assert.equal(store.get('e2e-session')?.machineId, 'local')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refreshes a local Chrome-adopted row from a later catalog pull', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-host-refresh-'))
    try {
      const store = new ConversationStore(dir)
      store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      store.adoptHostConversation(
        {
          id: 'chrome-row',
          title: 'From Chrome',
          createdAt: 1,
          updatedAt: 1,
          workingDirectory: join(dir, 'ws'),
          model: 'm',
          messages: []
        } as Conversation,
        'local'
      )
      const refreshed = store.adoptHostConversation(
        {
          id: 'chrome-row',
          title: 'From Chrome',
          createdAt: 1,
          updatedAt: 5,
          workingDirectory: join(dir, 'ws'),
          model: 'm',
          messages: [
            { id: 'm1', role: 'user', content: 'hi', createdAt: 2 } as Conversation['messages'][number]
          ]
        } as Conversation,
        'local'
      )
      assert.ok(refreshed)
      assert.equal(refreshed.messages.length, 1)
      assert.equal(refreshed.messages[0]?.content, 'hi')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refreshes local-shell usage and resume cursor from a later vavd pull', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-host-usage-'))
    try {
      const store = new ConversationStore(dir)
      store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      store.create(join(dir, 'ws'), 'm', { id: 'e2e-session' })
      const refreshed = store.adoptHostConversation(
        {
          id: 'e2e-session',
          title: 'E2E ACP live',
          createdAt: 1,
          updatedAt: 5,
          workingDirectory: join(dir, 'ws'),
          model: 'grok-4.6',
          tokensUsed: 9000,
          tokenLimit: 240_000,
          tokenHistory: [{ turnIndex: 1, totalInputTokens: 9000 } as Conversation['tokenHistory'][number]],
          cliHost: 'cursor',
          cliResumeCursor: { provider: 'cursor', sessionId: 'acp-sess-1' },
          acpSession: { currentModeId: 'agent', modes: [{ id: 'agent', name: 'Agent' }] },
          messages: [
            { id: 'm1', role: 'user', content: 'hi', createdAt: 2 } as Conversation['messages'][number]
          ]
        } as Conversation,
        'local'
      )
      assert.ok(refreshed)
      assert.equal(refreshed.tokensUsed, 9000)
      assert.equal(refreshed.tokenLimit, 240_000)
      assert.equal(refreshed.tokenHistory?.length, 1)
      assert.equal(
        refreshed.cliResumeCursor && 'sessionId' in refreshed.cliResumeCursor
          ? refreshed.cliResumeCursor.sessionId
          : null,
        'acp-sess-1'
      )
      assert.equal(refreshed.acpSession?.currentModeId, 'agent')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('adopts a Chrome-created vavd session as a local workbench row', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-host-local-'))
    try {
      const store = new ConversationStore(dir)
      store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      const adopted = store.adoptHostConversation(
        {
          id: 'chrome-row',
          title: 'From Chrome',
          createdAt: 1,
          updatedAt: 1,
          workingDirectory: join(dir, 'ws'),
          model: 'm',
          messages: []
        } as Conversation,
        'local'
      )
      assert.ok(adopted)
      assert.equal(adopted.id, 'chrome-row')
      assert.equal(adopted.machineId, 'local')
      assert.equal(store.get('chrome-row')?.title, 'From Chrome')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('projects host turns onto the local row before an adopted duplicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-host-pref-'))
    try {
      const store = new ConversationStore(dir)
      store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      const local = store.create(join(dir, 'ws'), 'm', { id: 'local-row' })
      store.bindHostSession(local.id, 'host-row')
      const adopted = store.adoptHostConversation(
        {
          id: 'host-row',
          title: 'Host',
          createdAt: 1,
          updatedAt: 1,
          workingDirectory: join(dir, 'ws'),
          model: 'm',
          messages: []
        } as Conversation,
        'vavd-1'
      )
      assert.ok(adopted)
      assert.equal(store.findOnHost('vavd-1', 'host-row')?.id, 'local-row')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps host-owned local rows in memory only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-host-persist-'))
    try {
      const store = new ConversationStore(dir)
      store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      store.setShouldPersist((row) => !isLocalMachine(row.machineId))
      const local = store.create(join(dir, 'ws'), 'm', { id: 'memory-only' })
      const remote = store.create(join(dir, 'ws'), 'm', { id: 'paired-row', machineId: 'other-box' })
      store.flush()
      assert.equal(store.get(local.id)?.id, 'memory-only')
      assert.equal(existsSync(join(dir, 'conversations', 'memory-only.json')), false)
      assert.equal(existsSync(join(dir, 'conversations', 'paired-row.json')), true)
      const index = JSON.parse(readFileSync(join(dir, 'conversations', 'index.json'), 'utf8')) as {
        ids?: string[]
      }
      assert.deepEqual(index.ids, [remote.id])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('drops a previously written local shard once vavd owns local chats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-host-drop-'))
    try {
      const store = new ConversationStore(dir)
      store.load({ model: 'm', mintWorkdir: () => join(dir, 'ws') })
      store.create(join(dir, 'ws'), 'm', { id: 'stale-local' })
      store.flush()
      assert.equal(existsSync(join(dir, 'conversations', 'stale-local.json')), true)
      store.setShouldPersist((row) => !isLocalMachine(row.machineId))
      store.flush()
      assert.equal(store.get('stale-local')?.id, 'stale-local')
      assert.equal(existsSync(join(dir, 'conversations', 'stale-local.json')), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
