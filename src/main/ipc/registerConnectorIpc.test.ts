import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import { registerConnectorIpc } from './registerConnectorIpc.ts'

describe('registerConnectorIpc', () => {
  it('proxies catalog and login to spawned vav-server', async () => {
    const calls: string[] = []
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    registerConnectorIpc(
      ipcMain as never,
      {
        catalog: () => {
          throw new Error('local connector registry should not run')
        }
      } as never,
      () => ({ token: null }),
      {
        broadcastSettings: () => undefined,
        remote: () => ({
          request: async (method) => {
            calls.push(method)
            if (method === 'connectors.catalog') return [{ id: 'github' }]
            if (method === 'connectors.beginLogin') {
              return { rows: [], login: { connector: 'github', status: 'running' } }
            }
            return null
          }
        })
      }
    )

    const catalog = await handlers.get(IPC.connectorsCatalog)?.({})
    const login = await handlers.get(IPC.connectorsBeginLogin)?.({}, 'github')
    assert.deepEqual(catalog, [{ id: 'github' }])
    assert.deepEqual(login, { rows: [], login: { connector: 'github', status: 'running' } })
    assert.deepEqual(calls, ['connectors.catalog', 'connectors.beginLogin'])
  })
})
