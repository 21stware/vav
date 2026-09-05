export type PhoneVariant = 'web' | 'extension'

export type PhoneLine = Record<string, unknown> & { type?: string }

export type PhoneTransport = {
  variant: PhoneVariant
  send: (msg: Record<string, unknown>) => void
  onLine: (handler: (msg: PhoneLine) => void) => () => void
  onStatus: (handler: (status: PhoneLinkStatus) => void) => () => void
  connect: (secret?: string) => void
  rediscover: () => void
  pageState: () => PhonePageState
  onPage: (handler: (page: PhonePageState) => void) => () => void
  setIncludePage: (on: boolean) => void
  setIncludeShot: (on: boolean) => void
}

export type PhoneLinkStatus = {
  status: 'searching' | 'reconnecting' | 'connected' | 'error'
  error: string
  hostName: string
  version: string
}

export type PhonePageState = {
  title: string
  url: string
  selection: string
  includePage: boolean
  includeShot: boolean
}

const emptyPage = (): PhonePageState => ({
  title: '',
  url: '',
  selection: '',
  includePage: true,
  includeShot: false
})

function parseLines(data: string, emit: (msg: PhoneLine) => void): void {
  for (const line of String(data).split('\n').filter(Boolean)) {
    try {
      emit(JSON.parse(line) as PhoneLine)
    } catch {
      /* ignore a bad line */
    }
  }
}

export function createWebTransport(): PhoneTransport {
  const lineHandlers = new Set<(msg: PhoneLine) => void>()
  const statusHandlers = new Set<(status: PhoneLinkStatus) => void>()
  let ws: WebSocket | null = null
  let status: PhoneLinkStatus = {
    status: 'searching',
    error: '',
    hostName: 'VAV',
    version: ''
  }

  const setStatus = (next: Partial<PhoneLinkStatus>): void => {
    status = { ...status, ...next }
    for (const handler of statusHandlers) handler(status)
  }

  const emit = (msg: PhoneLine): void => {
    if (msg.type === 'welcome') {
      setStatus({
        status: 'connected',
        error: '',
        version: typeof msg.version === 'string' ? msg.version : status.version
      })
    }
    if (msg.type === 'host' && typeof msg.name === 'string' && msg.name) {
      setStatus({ hostName: msg.name })
    }
    if (msg.type === 'error') {
      setStatus({
        status: status.status === 'connected' ? 'connected' : 'error',
        error: String(msg.message || msg.code || 'error')
      })
    }
    for (const handler of lineHandlers) handler(msg)
  }

  const send = (msg: Record<string, unknown>): void => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
  }

  const openSocket = (secret: string): void => {
    if (ws) ws.close()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/vav`)
    setStatus({ status: 'searching', error: '' })
    ws.onopen = () => {
      send({ type: 'hello', proto: 1, auth: secret, role: 'phone', device: 'web' })
    }
    ws.onclose = () => setStatus({ status: 'error', error: 'Disconnected' })
    ws.onerror = () => setStatus({ status: 'error', error: 'Socket error' })
    ws.onmessage = (event) => parseLines(String(event.data), emit)
  }

  const connect = (secret?: string): void => {
    const next = (secret || localStorage.getItem('vavd-secret') || '').trim()
    if (next) localStorage.setItem('vavd-secret', next)
    if (!next) {
      setStatus({ status: 'error', error: 'Paste the pairing secret' })
      return
    }
    openSocket(next)
  }

  const autoConnect = async (): Promise<void> => {
    try {
      const res = await fetch('/discover')
      if (res.ok) {
        const info = (await res.json()) as { secret?: string; name?: string }
        if (info.secret) {
          localStorage.setItem('vavd-secret', info.secret)
          if (info.name) setStatus({ hostName: info.name })
        }
      }
    } catch {
      /* offline */
    }
    const secret = localStorage.getItem('vavd-secret') || ''
    if (secret) connect(secret)
    else setStatus({ status: 'error', error: 'Paste the pairing secret' })
  }

  void autoConnect()

  return {
    variant: 'web',
    send,
    onLine: (handler) => {
      lineHandlers.add(handler)
      return () => lineHandlers.delete(handler)
    },
    onStatus: (handler) => {
      statusHandlers.add(handler)
      handler(status)
      return () => statusHandlers.delete(handler)
    },
    connect,
    rediscover: () => void autoConnect(),
    pageState: emptyPage,
    onPage: () => () => undefined,
    setIncludePage: () => undefined,
    setIncludeShot: () => undefined
  }
}

type ExtensionPortMessage = {
  type?: string
  payload?: PhoneLine
  state?: Record<string, unknown>
}

type ExtensionPort = {
  postMessage: (msg: Record<string, unknown>) => void
  onMessage: { addListener: (fn: (msg: ExtensionPortMessage) => void) => void }
  onDisconnect: { addListener: (fn: () => void) => void }
}

export function createExtensionTransport(
  connectPort: () => ExtensionPort = () => chrome.runtime.connect({ name: 'sidepanel' })
): PhoneTransport {
  const lineHandlers = new Set<(msg: PhoneLine) => void>()
  const statusHandlers = new Set<(status: PhoneLinkStatus) => void>()
  const pageHandlers = new Set<(page: PhonePageState) => void>()
  const outbound: Array<Record<string, unknown>> = []
  let page = emptyPage()
  let status: PhoneLinkStatus = {
    status: 'searching',
    error: '',
    hostName: 'VAV',
    version: ''
  }
  let port: ExtensionPort | null = null
  let reconnectTimer = 0
  let generation = 0

  const setStatus = (next: Partial<PhoneLinkStatus>): void => {
    status = { ...status, ...next }
    for (const handler of statusHandlers) handler(status)
  }

  const setPage = (next: PhonePageState): void => {
    page = next
    for (const handler of pageHandlers) handler(page)
  }

  const handleMessage = (msg: ExtensionPortMessage): void => {
    if (msg?.type === 'wire' && msg.payload) {
      const line = msg.payload
      if (line.type === 'welcome') {
        setStatus({
          status: 'connected',
          error: '',
          version: typeof line.version === 'string' ? line.version : status.version
        })
      }
      if (line.type === 'host' && typeof line.name === 'string' && line.name) {
        setStatus({ hostName: line.name })
      }
      for (const handler of lineHandlers) handler(line)
      return
    }
    if (msg?.type === 'state' && msg.state) {
      const snap = msg.state as {
        status?: PhoneLinkStatus['status']
        error?: string
        hostName?: string
        version?: string
        page?: { title?: string; url?: string; selection?: string }
        includePage?: boolean
        includeShot?: boolean
      }
      setStatus({
        status: snap.status || status.status,
        error: snap.error || '',
        hostName: snap.hostName || status.hostName,
        version: snap.version || status.version
      })
      const nextPage = snap.page
      setPage({
        title: nextPage?.title || '',
        url: nextPage?.url || '',
        selection: nextPage?.selection || '',
        includePage: snap.includePage !== false,
        includeShot: snap.includeShot === true
      })
    }
  }

  const flush = (next: ExtensionPort): void => {
    while (outbound.length) {
      const msg = outbound[0]
      try {
        next.postMessage(msg)
        outbound.shift()
      } catch {
        break
      }
    }
  }

  const bindPort = (): void => {
    if (port) return
    let next: ExtensionPort
    try {
      next = connectPort()
    } catch {
      scheduleReconnect()
      return
    }
    const born = ++generation
    port = next
    next.onMessage.addListener(handleMessage)
    next.onDisconnect.addListener(() => {
      if (generation !== born) return
      port = null
      if (status.status === 'connected') setStatus({ status: 'reconnecting', error: '' })
      scheduleReconnect()
    })
    flush(next)
  }

  const scheduleReconnect = (): void => {
    if (reconnectTimer) return
    reconnectTimer = globalThis.setTimeout(() => {
      reconnectTimer = 0
      bindPort()
    }, 250) as unknown as number
  }

  const post = (msg: Record<string, unknown>): void => {
    if (!port) {
      outbound.push(msg)
      bindPort()
      return
    }
    try {
      port.postMessage(msg)
    } catch {
      outbound.push(msg)
      port = null
      if (status.status === 'connected') setStatus({ status: 'reconnecting', error: '' })
      bindPort()
    }
  }

  bindPort()

  return {
    variant: 'extension',
    send: (payload) => post({ type: 'wire', payload }),
    onLine: (handler) => {
      lineHandlers.add(handler)
      return () => lineHandlers.delete(handler)
    },
    onStatus: (handler) => {
      statusHandlers.add(handler)
      handler(status)
      return () => statusHandlers.delete(handler)
    },
    connect: (secret) => {
      if (secret) post({ type: 'pair', text: secret })
    },
    rediscover: () => post({ type: 'rediscover' }),
    pageState: () => page,
    onPage: (handler) => {
      pageHandlers.add(handler)
      handler(page)
      return () => pageHandlers.delete(handler)
    },
    setIncludePage: (on) => post({ type: 'toggle-page', on }),
    setIncludeShot: (on) => post({ type: 'toggle-shot', on })
  }
}

export function createPhoneTransport(variant: PhoneVariant): PhoneTransport {
  return variant === 'extension' ? createExtensionTransport() : createWebTransport()
}

export function detectPhoneVariant(): PhoneVariant {
  return typeof chrome !== 'undefined' && chrome.runtime?.id ? 'extension' : 'web'
}
