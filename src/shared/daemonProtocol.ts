/**
 * Workspace-host daemon protocol (VAV ⇄ vavd / another desktop).
 *
 * Transport: JSON lines over TCP. Same framing as iOS remote control
 * (`drainJsonLines`), different message set — fs / spawn / pty live here,
 * not on remoteControl v1.
 *
 * Handshake: first line is `hello` with `role: 'daemon'` and the pairing
 * secret. The server replies `welcome` (host identity + home/tmp) or `error`.
 *
 * After welcome, the client issues `req` frames; the server answers `res`
 * and may push `stream` events for process / pty / watch.
 *
 * This module is pure (no Node imports) so tests and a headless `vavd` share it.
 */

import { parsePairing } from './remoteControl.ts'
import type { WorkspaceHostInfo } from './workspaceHost.ts'

export const DAEMON_PROTO_VERSION = 1
export const DAEMON_DEFAULT_PORT = 4750
export const DAEMON_ANNOUNCE_PORT = 4751
export const DAEMON_MULTICAST = '239.255.47.50'
/** Cap a single inbound frame (base64 file bodies). */
export const DAEMON_MAX_LINE_BYTES = 8 * 1024 * 1024

export type DaemonHello = {
  type: 'hello'
  proto: number
  auth: string
  role: 'daemon'
  device?: string
}

export type DaemonWelcome = {
  type: 'welcome'
  proto: number
  app: string
  version: string
  host: WorkspaceHostInfo
  home: string
  tmp: string
}

export type DaemonReq = {
  type: 'req'
  id: string
  method: string
  params?: unknown
}

export type DaemonRes = {
  type: 'res'
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export type DaemonStream = {
  type: 'stream'
  stream: string
  event: string
  data?: unknown
}

export type DaemonError = {
  type: 'error'
  code: 'auth' | 'bad-request' | 'internal'
  message: string
}

export type DaemonPing = { type: 'ping' }
export type DaemonPong = { type: 'pong' }

/** LAN pair: ask the other desktop to confirm, then they send a pairing offer. */
export type DaemonPairAsk = {
  type: 'pair-ask'
  proto: number
  name: string
  machineId: string
}

export type DaemonPairOffer = {
  type: 'pair-offer'
  pairing: string
}

export type DaemonClientMessage = DaemonHello | DaemonReq | DaemonPing | DaemonPairAsk
export type DaemonServerMessage =
  | DaemonWelcome
  | DaemonRes
  | DaemonStream
  | DaemonError
  | DaemonPong
  | DaemonPairOffer

export type DaemonMessage = DaemonClientMessage | DaemonServerMessage

export function encodeDaemonLine(message: DaemonMessage | Record<string, unknown>): string {
  return `${JSON.stringify(message)}\n`
}

export function parseDaemonHello(value: unknown): DaemonHello | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'hello') return null
  if (typeof raw.auth !== 'string' || raw.auth.length === 0) return null
  if (typeof raw.proto !== 'number') return null
  if (raw.role !== 'daemon') return null
  const device = typeof raw.device === 'string' ? raw.device : undefined
  return { type: 'hello', proto: raw.proto, auth: raw.auth, role: 'daemon', device }
}

export function parseDaemonPairAsk(value: unknown): DaemonPairAsk | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'pair-ask') return null
  if (typeof raw.proto !== 'number') return null
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const machineId = typeof raw.machineId === 'string' ? raw.machineId.trim() : ''
  if (!name || !machineId) return null
  return { type: 'pair-ask', proto: raw.proto, name, machineId }
}

export function parseDaemonClientFrame(value: unknown): DaemonClientMessage | null {
  const hello = parseDaemonHello(value)
  if (hello) return hello
  const ask = parseDaemonPairAsk(value)
  if (ask) return ask
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'ping':
      return { type: 'ping' }
    case 'req': {
      if (typeof raw.id !== 'string' || raw.id.length === 0) return null
      if (typeof raw.method !== 'string' || raw.method.length === 0) return null
      return { type: 'req', id: raw.id, method: raw.method, params: raw.params }
    }
    default:
      return null
  }
}

export function parseDaemonServerFrame(value: unknown): DaemonServerMessage | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  switch (raw.type) {
    case 'welcome': {
      if (typeof raw.proto !== 'number') return null
      if (typeof raw.app !== 'string' || typeof raw.version !== 'string') return null
      if (typeof raw.host !== 'object' || raw.host === null) return null
      const host = raw.host as Record<string, unknown>
      if (typeof host.id !== 'string' || typeof host.name !== 'string') return null
      if (host.kind !== 'local' && host.kind !== 'remote') return null
      if (typeof host.online !== 'boolean') return null
      if (typeof raw.home !== 'string' || typeof raw.tmp !== 'string') return null
      return {
        type: 'welcome',
        proto: raw.proto,
        app: raw.app,
        version: raw.version,
        host: {
          id: host.id,
          name: host.name,
          kind: host.kind,
          online: host.online,
          platform: typeof host.platform === 'string' ? host.platform : undefined
        },
        home: raw.home,
        tmp: raw.tmp
      }
    }
    case 'res': {
      if (typeof raw.id !== 'string') return null
      if (typeof raw.ok !== 'boolean') return null
      const error =
        raw.error && typeof raw.error === 'object'
          ? {
              code: String((raw.error as { code?: unknown }).code ?? 'internal'),
              message: String((raw.error as { message?: unknown }).message ?? 'error')
            }
          : undefined
      return { type: 'res', id: raw.id, ok: raw.ok, result: raw.result, error }
    }
    case 'stream': {
      if (typeof raw.stream !== 'string' || typeof raw.event !== 'string') return null
      return { type: 'stream', stream: raw.stream, event: raw.event, data: raw.data }
    }
    case 'error': {
      if (raw.code !== 'auth' && raw.code !== 'bad-request' && raw.code !== 'internal') return null
      if (typeof raw.message !== 'string') return null
      return { type: 'error', code: raw.code, message: raw.message }
    }
    case 'pong':
      return { type: 'pong' }
    case 'pair-offer': {
      if (typeof raw.pairing !== 'string' || !raw.pairing.trim()) return null
      return { type: 'pair-offer', pairing: raw.pairing }
    }
    default:
      return null
  }
}

// --- pairing ---

/**
 * Payload a desktop / vavd prints or encodes in Settings.
 * `vav-daemon://secret@host:port?name=&token=&addresses=` — distinct from the
 * phone QR (`vav-remote:`).
 */
export type DaemonPairing = {
  v: number
  secret: string
  machineId: string
  name: string
  host?: string
  port?: number
  /** Tailcat token when the daemon is also reachable over the tunnel. */
  token?: string
  /** LAN IPv4/IPv6 addresses the client should try before `host`. */
  addresses?: string[]
}

function formatPairingAuthority(host: string, port: number): string {
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${bracketed}:${port}`
}

/** Keep `:`, `,`, `.` readable — matches the hand-copied URI form. */
function encodePairingQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%2E/gi, '.')
}

export function encodeDaemonPairing(pairing: DaemonPairing): string {
  const host = pairing.host?.trim() || '127.0.0.1'
  const port = pairing.port && pairing.port > 0 ? pairing.port : DAEMON_DEFAULT_PORT
  const query: string[] = [`name=${encodePairingQueryValue(pairing.name)}`]
  if (pairing.token) query.push(`token=${encodePairingQueryValue(pairing.token)}`)
  if (pairing.addresses?.length) {
    query.push(`addresses=${encodePairingQueryValue(pairing.addresses.join(','))}`)
  }
  return `vav-daemon://${encodeURIComponent(pairing.secret)}@${formatPairingAuthority(host, port)}?${query.join('&')}`
}

function parseDaemonPairingUri(text: string): DaemonPairing | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'vav-daemon:') return null
  const secret = decodeURIComponent(url.username)
  if (secret.length < 16) return null
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const port = url.port ? Number(url.port) : undefined
  if (port !== undefined && !Number.isFinite(port)) return null
  const name = url.searchParams.get('name')?.trim() || host
  if (!name) return null
  const tokenRaw = url.searchParams.get('token')
  const token = tokenRaw && tokenRaw.startsWith('tc') ? tokenRaw : undefined
  const addressesRaw = url.searchParams.get('addresses')
  const addresses = addressesRaw
    ? addressesRaw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : undefined
  return {
    v: DAEMON_PROTO_VERSION,
    secret,
    machineId: host && port ? `${host}:${port}` : host || 'remote',
    name,
    host: host || undefined,
    port,
    token,
    addresses: addresses?.length ? addresses : undefined
  }
}

export function parseDaemonPairing(text: string): DaemonPairing | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('vav-daemon://')) return parseDaemonPairingUri(trimmed)
  return parseHostPortSecret(trimmed)
}

/** `host:port secret` or `host:port#secret` — LAN pair without the JSON wrapper. */
function parseHostPortSecret(text: string): DaemonPairing | null {
  const match = text.match(/^(\S+):(\d+)\s*[#\s]+(\S+)$/)
  if (!match) return null
  const secret = match[3]
  if (secret.length < 16) return null
  const host = match[1]
  const port = Number(match[2])
  return {
    v: DAEMON_PROTO_VERSION,
    secret,
    machineId: `${host}:${port}`,
    name: host,
    host,
    port
  }
}

/**
 * Desktop pair input: `vav-daemon://…`, `vav-remote:{…}` (same QR as the phone),
 * or `host:port secret`.
 */
export function parseMachinePairing(text: string): DaemonPairing | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('vav-remote:')) {
    const remote = parsePairing(trimmed)
    if (!remote) return null
    return {
      v: DAEMON_PROTO_VERSION,
      secret: remote.secret,
      machineId: remote.host || 'tunnel',
      name: remote.host || 'Remote',
      host: remote.host,
      token: remote.token
    }
  }
  return parseDaemonPairing(trimmed)
}

export type DaemonAnnounce = {
  v: number
  kind: 'vav-daemon'
  machineId: string
  name: string
  port: number
  platform?: string
}

export function parseDaemonAnnounce(value: unknown): DaemonAnnounce | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (raw.kind !== 'vav-daemon') return null
  if (typeof raw.v !== 'number') return null
  if (typeof raw.machineId !== 'string' || typeof raw.name !== 'string') return null
  if (typeof raw.port !== 'number') return null
  return {
    v: raw.v,
    kind: 'vav-daemon',
    machineId: raw.machineId,
    name: raw.name,
    port: raw.port,
    platform: typeof raw.platform === 'string' ? raw.platform : undefined
  }
}

// --- wire helpers for Host* method params ---

export type FsStatWire = {
  size: number
  mtimeMs: number
  birthtimeMs: number
  ctimeMs: number
  mode?: number
  uid?: number
  gid?: number
  ino?: number
  isDirectory: boolean
  isFile: boolean
}

export type FsDirentWire = {
  name: string
  isDirectory: boolean
  isFile: boolean
}
