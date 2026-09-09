import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import { registerTimerIpc } from './registerTimerIpc.ts'

describe('registerTimerIpc', () => {
  it('proxies list / create / remove to the spawned vav-server catalog', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    registerTimerIpc(
      ipcMain as never,
      {} as never,
      {} as never,
      {} as never,
      () => undefined,
      {
        createDefinitionConversation: () => {
          throw new Error('local timer store should not run')
        },
        publishConversations: () => undefined,
        remote: () => ({
          request: async (method, params) => {
            calls.push({ method, params })
            if (method === 'timers.listJobs') return [{ id: 'job-1' }]
            if (method === 'timers.createScheduled') return { job: { id: 'job-2' } }
            if (method === 'timers.removeJob') return true
            return null
          }
        })
      }
    )

    const listed = await handlers.get(IPC.timersListJobs)?.({})
    const created = await handlers.get(IPC.timersCreateScheduled)?.({})
    const removed = await handlers.get(IPC.timersRemoveJob)?.({}, 'job-2')
    assert.deepEqual(listed, [{ id: 'job-1' }])
    assert.deepEqual(created, { job: { id: 'job-2' } })
    assert.equal(removed, true)
    assert.ok(calls.some((call) => call.method === 'timers.listJobs'))
    assert.ok(calls.some((call) => call.method === 'timers.createScheduled'))
    assert.ok(calls.some((call) => call.method === 'timers.removeJob'))
  })
})
