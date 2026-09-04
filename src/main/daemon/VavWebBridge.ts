/**
 * Loopback HTTP + WebSocket for the same phone protocol `RemoteControlHub`
 * already speaks. Chrome extension and the bundled web page attach here.
 */
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import type { Socket as NetSocket } from 'node:net'
import type { RemoteControlHub } from '../remote/RemoteControlHub.ts'
import { WEB_UI_HTML } from './webUi.ts'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export type VavWebBridgeOpts = {
  listen: string
  port: number
  hub: RemoteControlHub
  secret: () => string
}

class WsSocket extends EventEmitter {
  destroyed = false
  private chunks: Buffer[] = []
  private readonly raw: import('node:net').Socket

  constructor(raw: import('node:net').Socket) {
    super()
    this.raw = raw
    raw.on('error', (err) => this.emit('error', err))
    raw.on('close', () => {
      this.destroyed = true
      this.emit('close')
    })
    raw.on('data', (chunk: Buffer) => this.onBytes(chunk))
  }

  setEncoding(_enc: BufferEncoding): this {
    return this
  }

  write(data: string | Buffer): boolean {
    if (this.destroyed) return false
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
    this.raw.write(encodeWsText(payload))
    return true
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.raw.destroy()
  }

  removeAllListeners(event?: string | symbol): this {
    super.removeAllListeners(event)
    return this
  }

  private onBytes(chunk: Buffer): void {
    this.chunks.push(chunk)
    let buf = Buffer.concat(this.chunks)
    this.chunks = []
    while (buf.length >= 2) {
      const decoded = decodeWsFrame(buf)
      if (!decoded) {
        this.chunks.push(buf)
        return
      }
      buf = decoded.rest
      if (decoded.opcode === 8) {
        this.destroy()
        return
      }
      if (decoded.opcode === 1 || decoded.opcode === 2) {
        const text = decoded.payload.toString('utf8')
        const line = text.endsWith('\n') ? text : `${text}\n`
        this.emit('data', line)
      }
    }
    if (buf.length) this.chunks.push(buf)
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
  if (buf.length < 2) return null
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
    len = Number(buf.readBigUInt64BE(2))
    offset = 10
  }
  const maskLen = masked ? 4 : 0
  if (buf.length < offset + maskLen + len) return null
  let payload = buf.subarray(offset + maskLen, offset + maskLen + len)
  if (masked) {
    const mask = buf.subarray(offset, offset + 4)
    const copy = Buffer.from(payload)
    for (let i = 0; i < copy.length; i++) copy[i] = copy[i]! ^ mask[i % 4]!
    payload = copy
  }
  return { opcode, payload, rest: buf.subarray(offset + maskLen + len) }
}

function acceptWs(req: IncomingMessage, socket: import('node:net').Socket): WsSocket | null {
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string' || !key) return null
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n')
  )
  return new WsSocket(socket)
}

export function startVavWebBridge(
  opts: VavWebBridgeOpts
): Promise<{ close: () => void; port: number; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => handleHttp(req, res, opts))
    server.on('upgrade', (req, socket) => {
      if ((req.url ?? '/').split('?')[0] !== '/vav') {
        socket.destroy()
        return
      }
      const ws = acceptWs(req, socket)
      if (!ws) {
        socket.destroy()
        return
      }
      opts.hub.attach(ws as unknown as NetSocket)
    })
    server.once('error', reject)
    server.listen(opts.port, opts.listen, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : opts.port
      resolve({
        server,
        port,
        close: () => server.close()
      })
    })
  })
}

function handleHttp(req: IncomingMessage, res: ServerResponse, opts: VavWebBridgeOpts): void {
  const path = (req.url ?? '/').split('?')[0]
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(WEB_UI_HTML)
    return
  }
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, app: 'vavd' }))
    return
  }
  if (path === '/pairing.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ proto: 1, hasSecret: Boolean(opts.secret()) }))
    return
  }
  res.writeHead(404)
  res.end('not found')
}
