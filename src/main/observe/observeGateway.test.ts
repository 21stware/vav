import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { startObserveGateway } from './observeGateway.ts'
import type { ObserveIpcEvent } from './observeIpcRegistry.ts'

const sender: ObserveIpcEvent = {
  sender: { id: 1, isDestroyed: () => false, getURL: () => 'http://localhost:5173/' }
}

describe('observe gateway', () => {
  it('serves health and invokes recorded IPC over the websocket', async () => {
    const gateway = await startObserveGateway({
      platform: 'darwin',
      rendererUrl: () => null,
      port: 0,
      senderEvent: () => sender,
      registry: {
        channels: () => ['vav:bootstrap'],
        invoke: async (channel, args) => {
          assert.equal(channel, 'vav:bootstrap')
          assert.deepEqual(args, [])
          return { ok: true, conversations: [] }
        },
        send: () => undefined
      }
    })
    try {
      const health = await fetch(`http://127.0.0.1:${gateway.port}/health`).then((res) => res.json())
      assert.equal(health.ok, true)
      assert.equal(health.mode, 'live')
      assert.equal(health.platform, 'darwin')

      const result = await new Promise<unknown>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}/ipc`)
        ws.addEventListener('error', () => reject(new Error('ws error')))
        ws.addEventListener('open', () => {
          ws.send(JSON.stringify({ type: 'invoke', id: '1', channel: 'vav:bootstrap', args: [] }))
        })
        ws.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data)) as { type: string; ok?: boolean; value?: unknown }
          if (message.type === 'result') {
            ws.close()
            resolve(message)
          }
        })
      })
      assert.deepEqual(result, { type: 'result', id: '1', ok: true, value: { ok: true, conversations: [] } })
    } finally {
      gateway.close()
    }
  })
})
