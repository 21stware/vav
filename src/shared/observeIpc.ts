/** Localhost observe bridge: browser `window.vav` ↔ Electron IPC. */

export const OBSERVE_DEFAULT_PORT = 5175
export const OBSERVE_DEFAULT_ORIGIN = `http://127.0.0.1:${OBSERVE_DEFAULT_PORT}`
export const OBSERVE_IPC_PATH = '/ipc'

export type ObserveHello = {
  type: 'hello'
  platform: string
  rendererUrl: string | null
}

export type ObserveInvoke = {
  type: 'invoke'
  id: string
  channel: string
  args: unknown[]
}

export type ObserveSend = {
  type: 'send'
  channel: string
  args: unknown[]
}

export type ObserveSubscribe = {
  type: 'subscribe' | 'unsubscribe'
  channel: string
}

export type ObserveResult = {
  type: 'result'
  id: string
  ok: boolean
  value?: unknown
  error?: string
}

export type ObserveEvent = {
  type: 'event'
  channel: string
  payload: unknown
}

export type ObserveClientMessage = ObserveInvoke | ObserveSend | ObserveSubscribe
export type ObserveServerMessage = ObserveHello | ObserveResult | ObserveEvent

export type ObserveHealth = {
  ok: true
  mode: 'live'
  port: number
  platform: string
  rendererUrl: string | null
}

type EnvMap = { [key: string]: string | undefined }

function envMap(env?: EnvMap): EnvMap {
  if (env) return env
  const proc = (globalThis as { process?: { env?: EnvMap } }).process
  return proc?.env ?? {}
}

export function observePort(env?: EnvMap): number {
  const raw = envMap(env).VAV_OBSERVE_PORT
  const parsed = raw ? Number(raw) : OBSERVE_DEFAULT_PORT
  return Number.isFinite(parsed) && parsed > 0 ? parsed : OBSERVE_DEFAULT_PORT
}

export function observeEnabled(env?: EnvMap): boolean {
  const values = envMap(env)
  if (values.VAV_OBSERVE === '0' || values.VAV_OBSERVE === 'false') return false
  if (values.VAV_OBSERVE === '1' || values.VAV_OBSERVE === 'true') return true
  return Boolean(values.ELECTRON_RENDERER_URL || values.ELECTRON_IS_DEV)
}

export function isLoopbackObserveOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  } catch {
    return false
  }
}
