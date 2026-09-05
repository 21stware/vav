import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createExtensionTransport } from './phoneTransport.ts'

type Listener<T> = (value: T) => void

function mockPort() {
  const messages: Array<Record<string, unknown>> = []
  const messageListeners: Array<Listener<Record<string, unknown>>> = []
  const disconnectListeners: Array<() => void> = []
  let dead = false
  return {
    messages,
    postMessage(msg: Record<string, unknown>) {
      if (dead) throw new Error('Attempting to use a disconnected port object')
      messages.push(msg)
    },
    onMessage: {
      addListener(fn: Listener<Record<string, unknown>>) {
        messageListeners.push(fn)
      }
    },
    onDisconnect: {
      addListener(fn: () => void) {
        disconnectListeners.push(fn)
      }
    },
    emit(msg: Record<string, unknown>) {
      for (const listener of messageListeners) listener(msg)
    },
    disconnect() {
      dead = true
      for (const listener of disconnectListeners) listener()
    }
  }
}

describe('extension MV3 port', () => {
  it('reconnects and flushes a queued send after the service worker drops the port', async () => {
    const ports: ReturnType<typeof mockPort>[] = []
    const transport = createExtensionTransport(() => {
      const port = mockPort()
      ports.push(port)
      return port
    })

    const statuses: string[] = []
    transport.onStatus((status) => statuses.push(status.status))
    ports[0]?.emit({
      type: 'state',
      state: { status: 'connected', hostName: 'Release Ext Test', version: '0.0.0' }
    })
    assert.equal(statuses.at(-1), 'connected')

    ports[0]?.disconnect()
    assert.equal(statuses.at(-1), 'reconnecting')

    transport.send({ type: 'send', conversationId: 'c1', text: 'hello from the release extension' })
    await new Promise((resolve) => setTimeout(resolve, 400))

    assert.equal(ports.length, 2)
    assert.deepEqual(ports[1]?.messages, [
      {
        type: 'wire',
        payload: { type: 'send', conversationId: 'c1', text: 'hello from the release extension' }
      }
    ])
  })

  it('does not throw when postMessage hits a dead port — it reconnects instead', async () => {
    const ports: ReturnType<typeof mockPort>[] = []
    const transport = createExtensionTransport(() => {
      const port = mockPort()
      ports.push(port)
      return port
    })
    ports[0]?.disconnect()
    // First port is dead; send must not throw.
    transport.send({ type: 'ping' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(ports.length, 2)
    assert.deepEqual(ports[1]?.messages[0], { type: 'wire', payload: { type: 'ping' } })
  })
})
