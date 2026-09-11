import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import { registerFileSessionsIpc } from './registerFileSessionsIpc.ts'

describe('registerFileSessionsIpc host routing', () => {
  it('does not fall back to this computer when the remote window is offline', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    let listedLocal = 0
    registerFileSessionsIpc(
      ipcMain as never,
      {
        listAll: () => {
          listedLocal += 1
          return [{ path: '/this-mac/secret.md' }]
        },
        open: async () => {
          throw new Error('local open')
        },
        createSession: async () => {
          throw new Error('local create')
        },
        setActive: () => null,
        list: () => null,
        resolve: () => ({ path: '/this-mac/secret.md', pathStatus: 'ok' }),
        forceDelete: () => ({ ok: true, removed: [] }),
        rename: () => null,
        deleteSessions: () => null
      } as never,
      {
        defaultModel: () => 'm',
        defaultApprovalMode: () => 'auto',
        defaultThinkingLevel: () => 'off',
        setReadOnly: () => undefined,
        onSessionsDeleted: () => undefined,
        remote: () => null,
        remoteOnly: () => true
      }
    )

    const listAll = handlers.get(IPC.fileSessionsListAll)
    const open = handlers.get(IPC.fileSessionsOpen)
    assert.ok(listAll)
    assert.ok(open)
    assert.deepEqual(await listAll({}), [])
    assert.equal(await open({}, '/remote/note.md'), null)
    assert.equal(listedLocal, 0)
  })

  it('remembers remote listAll rows so file IO can follow machineId', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    const remembered: Array<{ sessionId: string; fileId: string; path: string; title: string }> = []
    registerFileSessionsIpc(
      ipcMain as never,
      {
        listAll: () => [],
        open: async () => {
          throw new Error('local open')
        },
        createSession: async () => {
          throw new Error('local create')
        },
        setActive: () => null,
        list: () => null,
        resolve: () => null,
        forceDelete: () => ({ ok: true, removed: [] }),
        rename: () => null,
        deleteSessions: () => null
      } as never,
      {
        defaultModel: () => 'm',
        defaultApprovalMode: () => 'auto',
        defaultThinkingLevel: () => 'off',
        setReadOnly: () => undefined,
        onSessionsDeleted: () => undefined,
        remote: () => ({
          request: async (method) => {
            if (method === 'fileSessions.listAll') {
              return [
                {
                  fileId: 'ino-1',
                  path: '/host/only.md',
                  sessionId: 'sess-1',
                  title: 'Host note'
                }
              ]
            }
            return null
          }
        }),
        remoteOnly: () => true,
        rememberRemoteSessions: (rows) => {
          remembered.push(...rows)
        }
      }
    )

    const listAll = handlers.get(IPC.fileSessionsListAll)
    assert.ok(listAll)
    const listed = await listAll({})
    assert.equal((listed as Array<{ path: string }>)[0]?.path, '/host/only.md')
    assert.deepEqual(remembered, [
      { sessionId: 'sess-1', fileId: 'ino-1', path: '/host/only.md', title: 'Host note' }
    ])
  })
})
