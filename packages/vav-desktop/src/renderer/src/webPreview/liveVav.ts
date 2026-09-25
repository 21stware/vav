import { createVavApi, type VavIpcAdapter } from '@shared/createVavApi'
import type { VavApi } from '@shared/ipc'
import type { Platform } from '@shared/platform'
import {
  OBSERVE_DEFAULT_ORIGIN,
  OBSERVE_IPC_PATH,
  type ObserveClientMessage,
  type ObserveHealth,
  type ObserveServerMessage
} from '@shared/observeIpc'

export type LiveObserve = {
  vav: VavApi
  close: () => void
  origin: string
}

function observeOrigin(search = typeof location === 'undefined' ? '' : location.search): string {
  const query = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const override = query.get('observe')
  if (override) return override.replace(/\/$/, '')
  if (typeof location !== 'undefined' && (location.port === '5175' || location.pathname === OBSERVE_IPC_PATH)) {
    return location.origin
  }
  return OBSERVE_DEFAULT_ORIGIN
}

export function observeHealthUrl(origin = observeOrigin()): string {
  return `${origin}/health`
}

export async function fetchObserveHealth(
  origin = observeOrigin(),
  timeoutMs = 400
): Promise<ObserveHealth | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${origin}/health`, { signal: ac.signal })
    if (!res.ok) return null
    const body = (await res.json()) as ObserveHealth
    return body?.ok === true && body.mode === 'live' ? body : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function connectObserveSocket(
  origin: string,
  onMessage: (message: ObserveServerMessage) => void
): { send: (message: ObserveClientMessage) => void; close: () => void; ready: Promise<void> } {
  const url = origin.replace(/^http/, 'ws') + OBSERVE_IPC_PATH
  const ws = new WebSocket(url)
  const send = (message: ObserveClientMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
  }
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('observe websocket timeout')), 2000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('observe websocket error'))
    })
  })
  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return
    try {
      onMessage(JSON.parse(event.data) as ObserveServerMessage)
    } catch {
      // ignore
    }
  })
  return {
    send,
    close: () => ws.close(),
    ready
  }
}

export function createLiveVav(options: {
  platform: Platform
  send: (message: ObserveClientMessage) => void
  onEvent: (handler: (channel: string, payload: unknown) => void) => () => void
}): { vav: VavApi; acceptResult: (message: ObserveServerMessage) => void } {
  let nextId = 1
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()

  const adapter: VavIpcAdapter = {
    platform: options.platform,
    invoke: (channel, ...args) => {
      const id = `obs-${nextId++}`
      return new Promise<any>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        options.send({ type: 'invoke', id, channel, args })
      })
    },
    send: (channel, ...args) => {
      options.send({ type: 'send', channel, args })
    },
    subscribe: (channel, handler) =>
      options.onEvent((eventChannel, payload) => {
        if (eventChannel === channel) handler(payload as never)
      })
  }

  return {
    vav: createVavApi(adapter),
    acceptResult: (message) => {
      if (message.type !== 'result') return
      const wait = pending.get(message.id)
      if (!wait) return
      pending.delete(message.id)
      if (message.ok) wait.resolve(message.value)
      else wait.reject(new Error(message.error || 'observe invoke failed'))
    }
  }
}

export async function openLiveObserve(origin = observeOrigin()): Promise<LiveObserve | null> {
  const health = await fetchObserveHealth(origin)
  if (!health) return null

  const listeners = new Set<(channel: string, payload: unknown) => void>()
  let send: (message: ObserveClientMessage) => void = () => undefined
  const live = createLiveVav({
    platform: (health.platform || 'darwin') as Platform,
    send: (message) => send(message),
    onEvent: (handler) => {
      listeners.add(handler)
      return () => listeners.delete(handler)
    }
  })
  const socket = connectObserveSocket(origin, (message) => {
    if (message.type === 'event') {
      for (const listener of listeners) listener(message.channel, message.payload)
      return
    }
    live.acceptResult(message)
  })
  send = socket.send
  try {
    await socket.ready
  } catch {
    socket.close()
    return null
  }

  const { vav } = live

  vav.window.popupMenu = async (items, position) => {
    const { showDomMenu } = await import('../lib/domMenu')
    return showDomMenu(items, position)
  }
  vav.window.closePopupMenu = async () => {
    document.getElementById('vav-dom-menu')?.remove()
  }
  vav.window.openSettings = async (view, _agentId, _machineId) => {
    if (typeof location === 'undefined') return
    const url = new URL(location.href)
    url.searchParams.set('view', 'settings')
    if (view) url.searchParams.set('settingsView', String(view))
    location.assign(url.toString())
  }

  return { vav, origin, close: socket.close }
}
