/**
 * Phone-protocol client used by the `vav` CLI and process-level vavd tests.
 * Same frames as iOS Remote, the web UI, and the Chrome extension.
 */
import { createConnection, type Socket } from 'node:net'
import { encodeLine, parseServerMessage, type RemoteServerMessage } from '../../shared/remoteControl.ts'

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
}): Promise<PhoneClient> {
  const socket = createConnection({ host: opts.host, port: opts.port })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  const client = attachPhone(socket)
  const welcomed = client.wait((msg) => msg.type === 'welcome')
  client.send({
    type: 'hello',
    proto: 1,
    auth: opts.secret,
    role: 'phone',
    device: opts.device ?? 'vav-cli'
  })
  await welcomed
  return client
}

export function attachPhone(socket: Socket): PhoneClient {
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
    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    pending.length = 0
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
      for (const waiter of pending) clearTimeout(waiter.timer)
      pending.length = 0
      socket.destroy()
    }
  }
}
