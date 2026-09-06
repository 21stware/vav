import assert from 'node:assert/strict'
import { createServer, type Server, type Socket } from 'node:net'
import { after, describe, it } from 'node:test'
import { encodeLine } from '../../shared/remoteControl.ts'
import { attachPhone, connectPhone } from './vavPhoneClient.ts'

async function listen(
  onSocket: (socket: Socket) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    onSocket(socket)
  })
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      })
  }
}

describe('connectPhone', () => {
  const servers: Array<{ close: () => Promise<void> }> = []
  after(async () => {
    for (const server of servers) await server.close()
  })

  it('rewrites connection refused', async () => {
    await assert.rejects(
      connectPhone({ host: '127.0.0.1', port: 1, secret: '0123456789abcdef0123', timeoutMs: 400 }),
      /is it running/
    )
  })

  it('times out a silent port', async () => {
    const hung = await listen(() => {
      /* accept but never reply */
    })
    servers.push(hung)
    await assert.rejects(
      connectPhone({ host: '127.0.0.1', port: hung.port, secret: '0123456789abcdef0123', timeoutMs: 200 }),
      /timeout/
    )
  })

  it('surfaces an auth error instead of hanging', async () => {
    const server = await listen((socket) => {
      socket.write(encodeLine({ type: 'error', code: 'auth', message: 'pairing rejected' }))
    })
    servers.push(server)
    await assert.rejects(
      connectPhone({ host: '127.0.0.1', port: server.port, secret: '0123456789abcdef0123', timeoutMs: 800 }),
      /pairing rejected/
    )
  })

  it('rejects waiters when the socket closes', async () => {
    const server = await listen((socket) => {
      socket.write(encodeLine({ type: 'welcome', proto: 1, app: 'vavd', version: 'test' }))
      setTimeout(() => socket.destroy(), 20)
    })
    servers.push(server)
    const phone = await connectPhone({
      host: '127.0.0.1',
      port: server.port,
      secret: '0123456789abcdef0123',
      timeoutMs: 800
    })
    await assert.rejects(phone.waitNew((msg) => msg.type === 'sessions'), /connection closed/)
    phone.close()
  })
})

describe('attachPhone', () => {
  it('parses JSON lines and ignores garbage', async () => {
    const { PassThrough } = await import('node:stream')
    const socket = new PassThrough() as unknown as Socket
    const client = attachPhone(socket)
    socket.emit('data', 'not-json\n{"type":"sessions","sessions":[]}\n')
    const frames = await client.wait((msg) => msg.type === 'sessions')
    assert.equal(frames.some((msg) => msg.type === 'sessions'), true)
    client.close()
  })
})
