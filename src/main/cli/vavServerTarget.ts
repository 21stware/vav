/**
 * Resolve a running vav-server (or desktop web-bridge) for vav-board / vav-tui.
 *
 * Order: explicit URI / host flags → state dir (`secret.json` + `listen.json`)
 * → loopback `/discover` (same secret the Chrome extension already reads).
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DAEMON_DEFAULT_PORT, parseDaemonPairing } from '../../shared/daemonProtocol.ts'
import {
  VAV_DISCOVER_APP,
  VAV_DISCOVER_PATH,
  VAV_WEB_SOCKET_PATH,
  webScanPorts,
  type VavDiscoverInfo
} from '../../shared/vavDiscover.ts'
import { probeListenAlive, readListenState } from '../daemon/listenState.ts'

export type VavServerTcpTarget = {
  kind: 'tcp'
  host: string
  port: number
  secret: string
  source: string
}

export type VavServerWsTarget = {
  kind: 'ws'
  origin: string
  secret: string
  source: string
}

export type VavServerTarget = VavServerTcpTarget | VavServerWsTarget

export const TARGET_FLAGS = new Set([
  '--uri',
  '--host',
  '--port',
  '--secret',
  '--state',
  '--device'
])

export function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  const next = argv[index + 1]
  if (next == null || next.startsWith('-')) return undefined
  return next
}

export function argValueOrEq(argv: string[], flag: string): string | undefined {
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) return eq.slice(flag.length + 1) || undefined
  return argValue(argv, flag)
}

/** Positional tokens after argv[1], skipping flags (and the value of known flags). */
export function positionalArgs(
  argv: string[],
  takesValue: Set<string>,
  booleanFlags: Set<string> = new Set()
): string[] {
  const out: string[] = []
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue
    if (booleanFlags.has(arg) || arg.startsWith('--no-') || arg === '--json' || arg === '--wait') {
      continue
    }
    if (takesValue.has(arg)) {
      i += 1
      continue
    }
    if (arg.startsWith('-')) continue
    out.push(arg)
  }
  return out
}

export function secretFromState(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'secret.json'), 'utf8')) as { secret?: unknown }
    return typeof raw.secret === 'string' && raw.secret.length >= 16 ? raw.secret : null
  } catch {
    return null
  }
}

/** Candidate state dirs: flag, env, ~/.vav-server, packaged-app spawn dir. */
export function defaultStateDirs(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const out: string[] = []
  const add = (dir: string | undefined): void => {
    const trimmed = dir?.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  add(env.VAV_SERVER_STATE)
  add(join(home, '.vav', 'servers', 'default'))
  add(join(home, '.vav-server'))
  const appData = env.HOME || home
  if (process.platform === 'darwin') {
    add(join(appData, 'Library', 'Application Support', 'vav', 'vav-server'))
    add(join(appData, 'Library', 'Application Support', 'vav-dev', 'vav-server'))
  } else if (process.platform === 'win32') {
    const roaming = env.APPDATA || join(appData, 'AppData', 'Roaming')
    add(join(roaming, 'vav', 'vav-server'))
    add(join(roaming, 'vav-dev', 'vav-server'))
  } else {
    add(join(appData, '.config', 'vav', 'vav-server'))
    add(join(appData, '.config', 'vav-dev', 'vav-server'))
  }
  return out
}

export function targetFromUri(
  uri: string,
  overrides: { host?: string; port?: string; secret?: string } = {}
): VavServerTcpTarget | null {
  const parsed = parseDaemonPairing(uri)
  if (!parsed?.secret) return null
  const port = Number(overrides.port || parsed.port || DAEMON_DEFAULT_PORT)
  if (!Number.isFinite(port) || port <= 0) return null
  return {
    kind: 'tcp',
    host: overrides.host || parsed.host || '127.0.0.1',
    port,
    secret: overrides.secret || parsed.secret,
    source: 'uri'
  }
}

export function targetFromState(
  dir: string,
  overrides: { host?: string; port?: string; secret?: string } = {}
): VavServerTcpTarget | null {
  const secret = overrides.secret || secretFromState(dir)
  if (!secret) return null
  const listen = readListenState(dir)
  const port = Number(overrides.port || listen?.port || DAEMON_DEFAULT_PORT)
  if (!Number.isFinite(port) || port <= 0) return null
  return {
    kind: 'tcp',
    host: overrides.host || listen?.host || '127.0.0.1',
    port,
    secret,
    source: `state:${dir}`
  }
}

export async function resolveStateTarget(
  dir: string,
  overrides: { host?: string; port?: string; secret?: string } = {}
): Promise<VavServerTcpTarget | null> {
  const target = targetFromState(dir, overrides)
  if (!target) return null
  if (overrides.port || overrides.host) return target
  const listen = readListenState(dir)
  if (!listen) return target
  if (await probeListenAlive(listen)) return target
  return null
}

export async function discoverLoopbackVavServer(
  env: NodeJS.ProcessEnv = process.env
): Promise<VavServerTarget | null> {
  const hint = env.VAV_SERVER_WEB_PORT ? [Number(env.VAV_SERVER_WEB_PORT)] : []
  const ports = webScanPorts(hint.filter((n) => Number.isInteger(n) && n > 0))
  const origins = ports.flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  for (const origin of origins) {
    const info = await probeDiscover(origin)
    if (!info?.secret) continue
    if (typeof info.port === 'number' && info.port > 0) {
      return {
        kind: 'tcp',
        host: '127.0.0.1',
        port: info.port,
        secret: info.secret,
        source: `discover:${origin}`
      }
    }
    return {
      kind: 'ws',
      origin,
      secret: info.secret,
      source: `discover:${origin}`
    }
  }
  return null
}

export async function probeDiscover(origin: string, ms = 400): Promise<VavDiscoverInfo | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(`${origin}${VAV_DISCOVER_PATH}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const info = (await res.json()) as VavDiscoverInfo
    if (!info || info.app !== VAV_DISCOVER_APP || info.proto !== 1) return null
    if (info.wsPath && info.wsPath !== VAV_WEB_SOCKET_PATH) return info
    return info
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export type ResolveVavServerTargetInput = {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  home?: string
  /** Skip /discover (unit tests). */
  discover?: boolean
}

export async function resolveVavServerTarget(input: ResolveVavServerTargetInput = {}): Promise<VavServerTarget> {
  const argv = input.argv ?? process.argv
  const env = input.env ?? process.env
  const home = input.home ?? homedir()
  const host = argValueOrEq(argv, '--host')
  const port = argValueOrEq(argv, '--port')
  const secret = argValueOrEq(argv, '--secret')
  const uri = argValueOrEq(argv, '--uri') || env.VAV_SERVER_URI
  if (uri) {
    const fromUri = targetFromUri(uri, { host, port, secret })
    if (fromUri) return fromUri
    throw new Error('unrecognized pairing URI')
  }
  if (secret && (host || port)) {
    const parsedPort = Number(port || DAEMON_DEFAULT_PORT)
    if (!Number.isFinite(parsedPort) || parsedPort <= 0) throw new Error('invalid --port')
    return {
      kind: 'tcp',
      host: host || '127.0.0.1',
      port: parsedPort,
      secret,
      source: 'flags'
    }
  }
  const stateFlag = argValueOrEq(argv, '--state')
  const dirs = stateFlag ? [stateFlag] : defaultStateDirs(env, home)
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const found = await resolveStateTarget(dir, { host, port, secret })
    if (found) return found
  }
  if (secret) {
    const parsedPort = Number(port || DAEMON_DEFAULT_PORT)
    return {
      kind: 'tcp',
      host: host || '127.0.0.1',
      port: parsedPort,
      secret,
      source: 'flags'
    }
  }
  if (input.discover !== false) {
    const discovered = await discoverLoopbackVavServer(env)
    if (discovered) return discovered
  }
  throw new Error(
    'no pairing secret: pass --uri / --secret, run vav-server first (~/.vav/servers/default), or leave the VAV app running'
  )
}

export function formatTarget(target: VavServerTarget): string {
  if (target.kind === 'ws') return `${target.origin} (${target.source})`
  return `${target.host}:${target.port} (${target.source})`
}
