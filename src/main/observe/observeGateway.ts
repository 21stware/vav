import { createHash } from 'node:crypto'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { EventEmitter } from 'node:events'
import type { Duplex } from 'node:stream'
import {
  OBSERVE_IPC_PATH,
  isLoopbackObserveOrigin,
  observePort,
  type ObserveClientMessage,
  type ObserveHealth,
  type ObserveServerMessage
} from '../../shared/observeIpc.ts'
import type { ObserveIpcEvent, ObserveIpcRegistry } from './observeIpcRegistry.ts'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export type ObserveGatewayOpts = {
  registry: ObserveIpcRegistry
  senderEvent: () => ObserveIpcEvent
  platform: string
  rendererUrl: () => string | null
  listen?: string
  port?: number
}

export type ObserveGateway = {
  close: () => void
  port: number
  server: Server
  emit: (channel: string, payload: unknown) => void
}

class WsClient extends EventEmitter {
  destroyed = false
  private chunks: Buffer[] = []
  private readonly raw: Duplex

  constructor(raw: Duplex) {
    super()
    this.raw = raw
    raw.on('error', (err) => this.emit('error', err))
    raw.on('close', () => {
      this.destroyed = true
      this.emit('close')
    })
    raw.on('data', (chunk: Buffer) => this.onBytes(chunk))
  }

  send(message: ObserveServerMessage): void {
    if (this.destroyed) return
    this.raw.write(encodeWsText(Buffer.from(JSON.stringify(message), 'utf8')))
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.raw.destroy()
  }

  private onBytes(chunk: Buffer): void {
    this.chunks.push(chunk)
    let buf = Buffer.concat(this.chunks)
    this.chunks = []
    while (buf.length >= 2) {
      const decoded = decodeWsFrame(buf)
      if (!decoded) {
        this.chunks.push(Buffer.from(buf))
        return
      }
      buf = Buffer.from(decoded.rest)
      if (decoded.opcode === 8) {
        this.destroy()
        return
      }
      if (decoded.opcode === 1 || decoded.opcode === 2) {
        this.emit('message', decoded.payload.toString('utf8'))
      }
    }
    if (buf.length) this.chunks.push(Buffer.from(buf))
  }
}

function encodeWsText(payload: Buffer): Buffer {
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x81
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

function decodeWsFrame(buf: Buffer): { opcode: number; payload: Buffer; rest: Buffer } | null {
  const fin = (buf[0]! & 0x80) !== 0
  const opcode = buf[0]! & 0x0f
  const masked = (buf[1]! & 0x80) !== 0
  let len = buf[1]! & 0x7f
  let offset = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2)
    offset = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    const big = buf.readBigUInt64BE(2)
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
    len = Number(big)
    offset = 10
  }
  const maskSize = masked ? 4 : 0
  if (buf.length < offset + maskSize + len) return null
  if (!fin) return null
  let payload = buf.subarray(offset + maskSize, offset + maskSize + len)
  if (masked) {
    const mask = buf.subarray(offset, offset + 4)
    payload = Buffer.from(payload)
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]!
  }
  return { opcode, payload, rest: buf.subarray(offset + maskSize + len) }
}

function trustedHost(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false
  const host = hostHeader.trim().toLowerCase()
  const allowed = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    '127.0.0.1',
    'localhost',
    '[::1]'
  ])
  return allowed.has(host)
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  })
  res.end(json)
}

function proxyHttp(req: IncomingMessage, res: ServerResponse, target: URL): void {
  const path = req.url || '/'
  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path,
      method: req.method,
      headers: { ...req.headers, host: target.host }
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    }
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end('observe proxy: renderer is not up')
  })
  req.pipe(upstream)
}

function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: URL): void {
  const path = req.url || '/'
  const upstream = httpRequest({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    path,
    method: 'GET',
    headers: req.headers
  })
  upstream.on('upgrade', (upReq, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upReq.headers)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\r\n')}\r\n\r\n`
    )
    if (upHead.length) socket.write(upHead)
    if (head.length) upSocket.write(head)
    upSocket.pipe(socket)
    socket.pipe(upSocket)
  })
  upstream.on('error', () => socket.destroy())
  upstream.end()
}

export function startObserveGateway(opts: ObserveGatewayOpts): Promise<ObserveGateway> {
  const listen = opts.listen ?? '127.0.0.1'
  const requested = opts.port ?? observePort()
  const clients = new Set<WsClient>()

  const health = (port: number): ObserveHealth => ({
    ok: true,
    mode: 'live',
    port,
    platform: opts.platform,
    rendererUrl: opts.rendererUrl()
  })

  const handleClient = (client: WsClient): void => {
    clients.add(client)
    client.send({
      type: 'hello',
      platform: opts.platform,
      rendererUrl: opts.rendererUrl()
    })
    client.on('close', () => clients.delete(client))
    client.on('message', (raw: string) => {
      void (async () => {
        let message: ObserveClientMessage
        try {
          message = JSON.parse(raw) as ObserveClientMessage
        } catch {
          return
        }
        const event = opts.senderEvent()
        if (message.type === 'invoke') {
          try {
            const value = await opts.registry.invoke(message.channel, message.args, event)
            client.send({ type: 'result', id: message.id, ok: true, value })
          } catch (err) {
            client.send({
              type: 'result',
              id: message.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            })
          }
          return
        }
        if (message.type === 'send') {
          opts.registry.send(message.channel, message.args, event)
        }
      })()
    })
  }

  const server = createServer((req, res) => {
    const port = boundPort()
    if (!trustedHost(req.headers.host, port) || !isLoopbackObserveOrigin(req.headers.origin)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    if (url.pathname === '/health') {
      writeJson(res, 200, health(port))
      return
    }
    if (url.pathname === OBSERVE_IPC_PATH) {
      res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('observe ipc websocket')
      return
    }
    const renderer = opts.rendererUrl()
    if (!renderer) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('observe: Electron renderer URL is not ready')
      return
    }
    proxyHttp(req, res, new URL(renderer))
  })

  server.on('upgrade', (req, socket, head) => {
    const port = boundPort()
    if (!trustedHost(req.headers.host, port) || !isLoopbackObserveOrigin(req.headers.origin)) {
      socket.destroy()
      return
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    if (url.pathname === OBSERVE_IPC_PATH) {
      const key = req.headers['sec-websocket-key']
      if (!key || Array.isArray(key)) {
        socket.destroy()
        return
      }
      const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      )
      handleClient(new WsClient(socket))
      return
    }
    const renderer = opts.rendererUrl()
    if (!renderer) {
      socket.destroy()
      return
    }
    proxyUpgrade(req, socket, head, new URL(renderer))
  })

  function boundPort(): number {
    const address = server.address()
    return typeof address === 'object' && address ? address.port : requested
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(requested, listen, () => {
      const port = boundPort()
      console.log(`vav observe  http://127.0.0.1:${port}/  (ego / Chrome → live Electron IPC)`)
      resolve({
        port,
        server,
        emit: (channel, payload) => {
          const message: ObserveServerMessage = { type: 'event', channel, payload }
          for (const client of clients) client.send(message)
        },
        close: () => {
          for (const client of clients) client.destroy()
          clients.clear()
          server.close()
        }
      })
    })
  })
}

