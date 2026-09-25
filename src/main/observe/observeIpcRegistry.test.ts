import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { installObserveIpcRegistry } from './observeIpcRegistry.ts'

const event = {
  sender: { id: 1, isDestroyed: () => false, getURL: () => 'file://app' }
}

describe('observe IPC registry', () => {
  it('invokes and sends through the recorded listeners', async () => {
    const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ons = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipc = {
      handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
        handles.set(channel, listener)
      },
      on(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
        ons.set(channel, listener)
      }
    }
    const registry = installObserveIpcRegistry(ipc)
    ipc.handle('vav:bootstrap', async (_event, label: unknown) => `hello ${label}`)
    const writes: unknown[] = []
    ipc.on('vav:pty:write', (_event, data: unknown) => {
      writes.push(data)
    })
    assert.equal(await registry.invoke('vav:bootstrap', ['world'], event), 'hello world')
    registry.send('vav:pty:write', ['x'], event)
    assert.deepEqual(writes, ['x'])
    assert.ok(registry.channels().includes('vav:bootstrap'))
    assert.equal(handles.size, 1)
    assert.equal(ons.size, 1)
  })
})
