import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import type { Conversation } from '../../shared/types.ts'
import { DbConnectionStore } from '../store/DbConnectionStore.ts'
import { registerDbIpc } from './registerDbIpc.ts'

function memoryVault(): {
  get: (id: string) => string | null
  set: (id: string, password: string) => void
  clear: (id: string) => void
} {
  const map = new Map<string, string>()
  return {
    get: (id) => map.get(id) ?? null,
    set: (id, password) => {
      map.set(id, password)
    },
    clear: (id) => {
      map.delete(id)
    }
  }
}

describe('registerDbIpc', () => {
  it('ensures a connection row for an existing conversation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-db-ipc-'))
    const store = new DbConnectionStore(dir, memoryVault())
    const conversations = new Map<string, Conversation>()
    const conversation = { id: 'c1', title: 'Database' } as Conversation
    conversations.set(conversation.id, conversation)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    const metas: string[] = []
    registerDbIpc(
      ipcMain as never,
      store,
      { evict: () => undefined } as never,
      {
        get: (id: string) => conversations.get(id),
        updateMeta: (id: string, patch: { dbConnectionId?: string }) => {
          metas.push(`${id}:${patch.dbConnectionId ?? ''}`)
        }
      } as never,
      () => undefined,
      {
        createDefinitionConversation: () => {
          throw new Error('should not mint a conversation')
        },
        publishConversations: () => undefined
      }
    )

    const missing = await handlers.get(IPC.dbEnsureForConversation)?.({}, 'missing')
    assert.equal(missing, null)
    const created = (await handlers.get(IPC.dbEnsureForConversation)?.({}, 'c1')) as {
      id: string
      conversationId: string
    }
    assert.equal(created.conversationId, 'c1')
    const again = (await handlers.get(IPC.dbEnsureForConversation)?.({}, 'c1')) as { id: string }
    assert.equal(again.id, created.id)
    assert.equal(store.getForConversation('c1')?.id, created.id)
    assert.equal(metas.length, 1)

    const opened = (await handlers.get(IPC.dbOpen)?.({}, created.id)) as { lastStatus: string }
    assert.equal(opened.lastStatus, 'ok')
    assert.equal(store.get(created.id)?.lastStatus, 'ok')
  })
})
