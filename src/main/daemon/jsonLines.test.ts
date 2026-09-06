import assert from 'node:assert/strict'
import { createConnection, createServer } from 'node:net'
import { describe, it } from 'node:test'
import { attachLineReader, secretsMatch, writeLine } from './jsonLines.ts'

async function listen(): Promise<{
  port: number
  close: () => void
  onConnection: (fn: (socket: import('node:net').Socket) => void) => void
}> {
  const server = createServer()
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  return {
    port,
    close: () => server.close(),
    onConnection: (fn) => {
      server.on('connection', fn)
    }
  }
}

describe('jsonLines', () => {
  it('compares secrets without leaking length via ===', () => {
    assert.equal(secretsMatch('0123456789abcdef', '0123456789abcdef'), true)
    assert.equal(secretsMatch('0123456789abcdef', '0123456789abcdee'), false)
    assert.equal(secretsMatch('short', 'longer-secret'), false)
  })

  it('writes a JSON line and reads valid plus invalid frames', async () => {
    const server = await listen()
    try {
      const frames: unknown[] = []
      const done = new Promise<void>((resolve) => {
        server.onConnection((socket) => {
          attachLineReader(socket, (value) => {
            frames.push(value)
            if (frames.length >= 2) resolve()
          })
        })
      })
      const client = createConnection({ host: '127.0.0.1', port: server.port })
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve)
        client.once('error', reject)
      })
      writeLine(client, { type: 'ping' })
      client.write('not-json\n')
      await done
      assert.deepEqual(frames[0], { type: 'ping' })
      assert.equal(frames[1], null)
      client.destroy()
    } finally {
      server.close()
    }
  })

  it('keeps leftover bytes for the next chunk', async () => {
    const server = await listen()
    try {
      const leftoverRef = { value: '' }
      const frames: unknown[] = []
      const done = new Promise<void>((resolve) => {
        server.onConnection((socket) => {
          attachLineReader(
            socket,
            (value) => {
              frames.push(value)
              if (frames.length >= 1) resolve()
            },
            { leftoverRef }
          )
        })
      })
      const client = createConnection({ host: '127.0.0.1', port: server.port })
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve)
        client.once('error', reject)
      })
      client.write('{"type":"hel')
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(frames.length, 0)
      assert.match(leftoverRef.value, /hel/)
      client.write('lo"}\n')
      await done
      assert.deepEqual(frames[0], { type: 'hello' })
      assert.equal(leftoverRef.value, '')
      client.destroy()
    } finally {
      server.close()
    }
  })

  it('drops the socket when a frame exceeds the cap', async () => {
    const server = await listen()
    try {
      const dropped = new Promise<void>((resolve) => {
        server.onConnection((socket) => {
          attachLineReader(socket, () => undefined, { maxBytes: 32 })
          socket.on('close', () => resolve())
        })
      })
      const client = createConnection({ host: '127.0.0.1', port: server.port })
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve)
        client.once('error', reject)
      })
      client.write(`${'x'.repeat(64)}\n`)
      await dropped
      client.destroy()
    } finally {
      server.close()
    }
  })
})
