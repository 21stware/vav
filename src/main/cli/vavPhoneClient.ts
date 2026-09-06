/**
 * Phone-protocol client used by the `vav` CLI and process-level vavd tests.
 * Same frames as iOS Remote, the web UI, and the Chrome extension.
 */
import { createConnection, type Socket } from 'node:net'
import { encodeLine, parseServerMessage, type RemoteServerMessage } from '../../shared/remoteControl.ts'
import { formatConnectHint } from '../daemon/webUiHelpers.ts'

export type PhoneClient = {
  frames: RemoteServerMessage[]
  send: (message: object) => void
  wait: (until: (msg: RemoteServerMessage) => boolean, timeoutMs?: number) => Promise<RemoteServerMessage[]>
  waitNew: (until: (msg: RemoteServerMessage) => boolean, timeoutMs?: number) => Promise<RemoteServerMessage[]>
  close: () => void
}

export async function connectPhone(opts: {
  host: string
  port: number
  secret: string
  device?: string
  /** iOS VAV Remote omits `role`; the host treats non-daemon hello as phone. */
  omitRole?: boolean
  timeoutMs?: number
}): Promise<PhoneClient> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const socket = createConnection({ host: opts.host, port: opts.port })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`${formatConnectHint(opts.host, opts.port)} (timeout)`))
    }, timeoutMs)
    timer.unref?.()
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', (err) => {
      clearTimeout(timer)
      const code = 'code' in err ? String((err as { code?: unknown }).code) : ''
      if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(err.message)) {
        reject(new Error(formatConnectHint(opts.host, opts.port)))
        return
      }
      reject(err)
    })
  })
  const client = attachPhone(socket)
  client.send({
    type: 'hello',
    proto: 1,
    auth: opts.secret,
    ...(opts.omitRole ? {} : { role: 'phone' }),
    device: opts.device ?? 'vav-cli'
  })
  const frames = await client.wait((msg) => msg.type === 'welcome' || msg.type === 'error', timeoutMs)
  const error = frames.find((msg) => msg.type === 'error')
  if (error && error.type === 'error') {
    client.close()
    throw new Error(error.message || 'pairing rejected')
  }
  return client
}

export function attachPhone(socket: Socket): PhoneClient {
  let buf = ''
  let closed = false
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

  const failWaiters = (err: Error): void => {
    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    pending.length = 0
  }

  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
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
  })
  socket.on('error', (err) => {
    failWaiters(err)
  })
  socket.on('close', () => {
    if (closed) return
    failWaiters(new Error('connection closed'))
  })

  return {
    frames,
    send(message) {
      socket.write(encodeLine(message as Parameters<typeof encodeLine>[0]))
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
      closed = true
      for (const waiter of pending) clearTimeout(waiter.timer)
      pending.length = 0
      socket.destroy()
    }
  }
}
