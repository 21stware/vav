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
    let loaded = 0
    let broadcasts = 0
    registerTimerIpc(
      ipcMain as never,
      {
        load: () => {
          loaded += 1
        },
        removeJob: () => false
      } as never,
      {} as never,
      {} as never,
      () => {
        broadcasts += 1
      },
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
    assert.ok(loaded >= 2)
    assert.ok(broadcasts >= 2)
    assert.ok(calls.some((call) => call.method === 'timers.listJobs'))
    assert.ok(calls.some((call) => call.method === 'timers.createScheduled'))
    assert.ok(calls.some((call) => call.method === 'timers.removeJob'))
  })

  it('falls back to the local store when remote remove misses the job', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    let localRemoved = ''
    registerTimerIpc(
      ipcMain as never,
      {
        load: () => undefined,
        removeJob: (id: string) => {
          localRemoved = id
          return true
        }
      } as never,
      {} as never,
      {} as never,
      () => undefined,
      {
        createDefinitionConversation: () => {
          throw new Error('local timer store should not run')
        },
        publishConversations: () => undefined,
        remote: () => ({
          request: async () => false
        })
      }
    )

    const removed = await handlers.get(IPC.timersRemoveJob)?.({}, 'stale-job')
    assert.equal(removed, true)
    assert.equal(localRemoved, 'stale-job')
  })
})
