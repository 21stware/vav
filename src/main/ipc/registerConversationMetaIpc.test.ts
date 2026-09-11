import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import type { Conversation } from '../../shared/types.ts'
import { registerConversationMetaIpc } from './registerConversationMetaIpc.ts'

describe('registerConversationMetaIpc convGet', () => {
  it('returns the local row, then falls back to forwardGet', async () => {
    const local = { id: 'local-row' } as Conversation
    const remote = { id: 'file-row', fileId: 'ino-1' } as Conversation
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    const store = {
      listMeta: () => [],
      listClientMeta: () => [],
      get: (id: string) => (id === 'local-row' ? local : undefined),
      hydrateMissingHostUsage: () => false,
      updateMeta: () => undefined,
      setActiveLeaf: () => undefined,
      setPinned: () => undefined,
      setArchived: () => undefined,
      setApprovalMode: () => undefined,
      setThinkingLevel: () => undefined,
      setFast: () => undefined,
      branchToNewConversation: () => undefined,
      duplicate: () => undefined
    }
    const asked: string[] = []
    registerConversationMetaIpc(ipcMain as never, store as never, {
      untitledTitle: () => 'Untitled',
      publish: () => undefined,
      renameDetached: () => undefined,
      onArchive: () => undefined,
      cliOwns: () => false,
      applyThinkingLevel: () => undefined,
      applyFast: () => undefined,
      applySessionMode: () => undefined,
      applySessionConfig: () => undefined,
      applySessionGoal: () => ({ ok: false, error: 'no' }),
      exportPack: () => undefined,
      importPack: async () => ({ ok: false }),
      promoteEphemeral: () => undefined,
      forwardGet: async (id) => {
        asked.push(id)
        return id === 'file-row' ? remote : null
      }
    })

    const get = handlers.get(IPC.convGet)
    assert.ok(get)
    assert.equal(await get({}, 'local-row'), local)
    assert.deepEqual(asked, [])
    assert.equal(await get({}, 'file-row'), remote)
    assert.deepEqual(asked, ['file-row'])
    assert.equal(await get({}, 'missing'), null)
  })
})
