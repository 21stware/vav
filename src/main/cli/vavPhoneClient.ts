/**
 * Phone-protocol client used by vav-board / vav-tui and process-level vav-server tests.
 * Same frames as iOS Remote, the web UI, and the Chrome extension.
 */
import { createConnection, type Socket } from 'node:net'
import { encodeLine, parseServerMessage, type RemoteServerMessage } from '../../shared/remoteControl.ts'
import { VAV_WEB_SOCKET_PATH } from '../../shared/vavDiscover.ts'
import type { VavServerTarget } from './vavServerTarget.ts'

export type PhoneClient = {
  frames: RemoteServerMessage[]
  send: (message: object) => void
  wait: (until: (msg: RemoteServerMessage) => boolean, timeoutMs?: number) => Promise<RemoteServerMessage[]>
  waitNew: (until: (msg: RemoteServerMessage) => boolean, timeoutMs?: number) => Promise<RemoteServerMessage[]>
  close: () => void
}

export type PhoneTransport = {
  write: (line: string) => void
  close: () => void
}

export async function connectPhone(opts: {
  host: string
  port: number
  secret: string
  device?: string
  /** iOS VAV Remote omits `role`; the host treats non-daemon hello as phone. */
  omitRole?: boolean
}): Promise<PhoneClient> {
  const socket = createConnection({ host: opts.host, port: opts.port })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  const client = attachPhone(socket)
  await hello(client, opts.secret, opts.device ?? 'vav-tui', opts.omitRole)
  return client
}

/** WebSocket attach — same path the Chrome extension uses on loopback. */
export async function connectPhoneWs(opts: {
  origin: string
  secret: string
  device?: string
}): Promise<PhoneClient> {
  const url = new URL(opts.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = VAV_WEB_SOCKET_PATH
  url.search = ''
  url.hash = ''
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`websocket timeout: ${url}`)), 8000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`websocket error: ${url}`))
    })
  })
  const client = attachWsPhone(ws)
  await hello(client, opts.secret, opts.device ?? 'vav-tui', false)
  return client
}

export async function connectPhoneTarget(
  target: VavServerTarget,
  device = 'vav-tui'
): Promise<PhoneClient> {
  if (target.kind === 'ws') {
    return connectPhoneWs({ origin: target.origin, secret: target.secret, device })
  }
  return connectPhone({
    host: target.host,
    port: target.port,
    secret: target.secret,
    device
  })
}

function hello(client: PhoneClient, secret: string, device: string, omitRole?: boolean): Promise<RemoteServerMessage[]> {
  const welcomed = client.wait((msg) => msg.type === 'welcome')
  client.send({
    type: 'hello',
    proto: 1,
    auth: secret,
    ...(omitRole ? {} : { role: 'phone' }),
    device
  })
  return welcomed
}

export function attachPhone(socket: Socket): PhoneClient {
  return attachTransport({
    write: (line) => {
      socket.write(line)
    },
    close: () => {
      socket.destroy()
    },
    onChunk: (fn) => {
      socket.setEncoding('utf8')
      socket.on('data', fn)
    },
    onError: (fn) => {
      socket.on('error', fn)
    }
  })
}

function attachWsPhone(ws: WebSocket): PhoneClient {
  return attachTransport({
    write: (line) => {
      ws.send(line)
    },
    close: () => {
      ws.close()
    },
    onChunk: (fn) => {
      ws.addEventListener('message', (event) => {
        const text = typeof event.data === 'string' ? event.data : String(event.data)
        fn(text.endsWith('\n') ? text : `${text}\n`)
      })
    },
    onError: (fn) => {
      ws.addEventListener('error', () => fn(new Error('websocket error')))
    }
  })
}

function attachTransport(transport: {
  write: (line: string) => void
  close: () => void
  onChunk: (fn: (chunk: string) => void) => void
  onError: (fn: (err: Error) => void) => void
}): PhoneClient {
  let buf = ''
  const frames: RemoteServerMessage[] = []
  const pending: Array<{
    until: (msg: RemoteServerMessage) => boolean
    resolve: (msgs: RemoteServerMessage[]) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []

  const flushWaiters = (): void => {
    for (const waiter of [...pending]) {
      if (frames.some((msg) => waiter.until(msg))) {
        clearTimeout(waiter.timer)
        pending.splice(pending.indexOf(waiter), 1)
        waiter.resolve(frames.slice())
      }
    }
  }

  const ingest = (chunk: string): void => {
    buf += chunk
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''
    for (const line of parts) {
      if (!line.trim()) continue
      let parsed: RemoteServerMessage | null = null
      try {
        parsed = parseServerMessage(JSON.parse(line) as unknown)
      } catch {
        continue
      }
      if (!parsed) continue
      frames.push(parsed)
    }
    flushWaiters()
  }

  transport.onChunk(ingest)
  transport.onError((err) => {
    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    pending.length = 0
  })

  return {
    frames,
    send(message) {
      transport.write(encodeLine(message as Parameters<typeof encodeLine>[0]))
    },
    wait(until, timeoutMs = 8000) {
      if (frames.some((msg) => until(msg))) return Promise.resolve(frames.slice())
      return new Promise((resolve, reject) => {
        const waiter = {
          until,
          resolve,
          reject,
          timer: setTimeout(() => {
            pending.splice(pending.indexOf(waiter), 1)
            reject(new Error(`timeout; saw ${frames.map((m) => m.type).join(',')}`))
          }, timeoutMs)
        }
        pending.push(waiter)
      })
    },
    waitNew(until, timeoutMs = 8000) {
      const start = frames.length
      return this.wait((msg) => frames.indexOf(msg) >= start && until(msg), timeoutMs)
    },
    close() {
      for (const waiter of pending) clearTimeout(waiter.timer)
      pending.length = 0
      transport.close()
    }
  }
}
