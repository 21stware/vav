import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import { registerPluginIpc } from './registerPluginIpc.ts'

describe('registerPluginIpc', () => {
  it('proxies list / setEnabled to spawned vav-server and unwraps mutations', async () => {
    const calls: string[] = []
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    registerPluginIpc(
      ipcMain as never,
      {
        snapshot: () => {
          throw new Error('local plugin store should not run')
        },
        setEnabled: () => {
          throw new Error('local plugin store should not run')
        }
      } as never,
      undefined,
      () => ({
        request: async (method) => {
          calls.push(method)
          if (method === 'plugins.list') {
            return { host: 'vav', root: '/tmp', plugins: [] }
          }
          if (method === 'plugins.setEnabled') {
            return { ok: true, snapshot: { host: 'vav', root: '/tmp', plugins: [{ id: 'p1' }] } }
          }
          return { ok: false, error: 'unused' }
        }
      })
    )

    const listed = await handlers.get(IPC.pluginsList)?.({}, 'vav')
    const toggled = await handlers.get(IPC.pluginsSetEnabled)?.({}, 'vav', 'p1', false)
    assert.deepEqual(listed, { host: 'vav', root: '/tmp', plugins: [] })
    assert.deepEqual(toggled, { host: 'vav', root: '/tmp', plugins: [{ id: 'p1' }] })
    assert.deepEqual(calls, ['plugins.list', 'plugins.setEnabled'])
  })
})
