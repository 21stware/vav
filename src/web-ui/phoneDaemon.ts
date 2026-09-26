import { DAEMON_PROTO_VERSION } from '@shared/daemonProtocol'

export type DaemonStreamEvent = {
  stream: string
  event: string
  data?: unknown
}

export type PhoneDaemonPlane = {
  request: (method: string, params?: unknown) => Promise<unknown>
  onStream: (handler: (event: DaemonStreamEvent) => void) => () => void
  ready: () => Promise<boolean>
  hello: (auth: string, device: string) => Promise<boolean>
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

const REQ_TIMEOUT_MS = 20_000

/**
 * Browser-side daemon RPC. Transport only supplies send / onLine —
 * WebSocket vs extension port stay outside this module.
 */
export function createDaemonRpc(opts: {
  send: (msg: Record<string, unknown>) => void
  onLine: (handler: (msg: Record<string, unknown>) => void) => () => void
}): PhoneDaemonPlane {
  const pending = new Map<string, Pending>()
  const streamHandlers = new Set<(event: DaemonStreamEvent) => void>()
  let seq = 0
  let readyResolve: ((ok: boolean) => void) | null = null
  let readyState = false
  const readyPromise = new Promise<boolean>((resolve) => {
    readyResolve = resolve
  })

  const settleReady = (ok: boolean): void => {
    readyState = ok
    readyResolve?.(ok)
    readyResolve = null
  }

  opts.onLine((msg) => {
    if (msg.type === 'welcome') {
      settleReady(true)
      return
    }
    if (msg.type === 'error' && !readyState) {
      settleReady(false)
      return
    }
    if (msg.type === 'res' && typeof msg.id === 'string') {
      const wait = pending.get(msg.id)
      if (!wait) return
      pending.delete(msg.id)
      if (msg.ok) wait.resolve(msg.result)
      else wait.reject(new Error(String((msg.error as { message?: string } | undefined)?.message || 'daemon request failed')))
      return
    }
    if (msg.type === 'stream' && typeof msg.stream === 'string' && typeof msg.event === 'string') {
      const event = { stream: msg.stream, event: msg.event, data: msg.data }
      for (const handler of streamHandlers) handler(event)
    }
  })

  return {
    hello(auth, device) {
      opts.send({
        type: 'hello',
        proto: DAEMON_PROTO_VERSION,
        auth,
        role: 'daemon',
        device
      })
      return readyPromise
    },
    ready: () => readyPromise,
    async request(method, params) {
      const ok = await readyPromise
      if (!ok) throw new Error('daemon plane unavailable')
      const id = `d${++seq}`
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('daemon rpc timeout'))
        }, REQ_TIMEOUT_MS)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (err) => {
            clearTimeout(timer)
            reject(err)
          }
        })
        opts.send({ type: 'req', id, method, params })
      })
    },
    onStream(handler) {
      streamHandlers.add(handler)
      return () => streamHandlers.delete(handler)
    }
  }
}

export function decodeBase64Utf8(base64: string): string {
  if (typeof atob === 'function') {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  }
  return Buffer.from(base64, 'base64').toString('utf8')
}
