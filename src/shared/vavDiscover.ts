/**
 * Loopback discovery for the vav-server web bridge.
 *
 * Chrome / the bundled page probe `/discover` on well-known ports. The pairing
 * secret is included only for loopback clients — same threat model as reading
 * `~/.vav-server/secret.json` on this machine. LAN clients still paste a URI.
 */

export const VAV_SERVER_WEB_DEFAULT_PORT = 4752
export const VAV_SERVER_WEB_SCAN_LAST = 4762
/** `npm run dev` — outside the release scan so VAV.app can keep :4752. */
export const VAV_SERVER_WEB_DEV_PORT = 4772
export const VAV_SERVER_WEB_DEV_SCAN_LAST = 4782
export const VAV_DISCOVER_PATH = '/discover'
export const VAV_WEB_SOCKET_PATH = '/vav'
export const VAV_DISCOVER_APP = 'vav-server'

export type VavRuntimeChannel = 'release' | 'dev'

export function webPortRange(channel: VavRuntimeChannel): { start: number; last: number } {
  return channel === 'dev'
    ? { start: VAV_SERVER_WEB_DEV_PORT, last: VAV_SERVER_WEB_DEV_SCAN_LAST }
    : { start: VAV_SERVER_WEB_DEFAULT_PORT, last: VAV_SERVER_WEB_SCAN_LAST }
}

export function webChannelForPort(port: number): VavRuntimeChannel | null {
  if (port >= VAV_SERVER_WEB_DEV_PORT && port <= VAV_SERVER_WEB_DEV_SCAN_LAST) return 'dev'
  if (port >= VAV_SERVER_WEB_DEFAULT_PORT && port <= VAV_SERVER_WEB_SCAN_LAST) return 'release'
  return null
}

export function preferredWebPort(channel: VavRuntimeChannel = 'release'): number {
  return webPortRange(channel).start
}

/**
 * Which loopback web / state tree this process should touch.
 * Explicit `VAV_RUNTIME_CHANNEL` wins; Dev Electron pins `VAV_HOME` to `vav-dev`.
 */
export function resolveVavRuntimeChannel(
  env: { [key: string]: string | undefined } = process.env
): VavRuntimeChannel {
  const explicit = env.VAV_RUNTIME_CHANNEL?.trim().toLowerCase()
  if (explicit === 'dev' || explicit === 'release') return explicit
  if (env.ELECTRON_IS_DEV === '1' || Boolean(env.ELECTRON_RENDERER_URL?.trim())) return 'dev'
  const home = (env.VAV_HOME ?? '').replace(/\\/g, '/')
  if (/(^|\/)vav-dev(\/|$)/.test(home)) return 'dev'
  return 'release'
}

export type VavDiscoverInfo = {
  proto: 1
  app: typeof VAV_DISCOVER_APP
  name: string
  version: string
  wsPath: typeof VAV_WEB_SOCKET_PATH
  loopback: boolean
  /** True when a pairing secret exists. The secret itself is never returned over HTTP. */
  hasSecret?: boolean
  secret?: string
  /** Control-plane TCP port (`hello.role=phone`). Older daemons omit this. */
  port?: number
  /** Loopback only: host can run a VAV turn (provider key present). */
  hasKey?: boolean
}

export function isLoopbackAddress(addr?: string | null): boolean {
  if (!addr) return false
  const normalized = addr.trim().toLowerCase().replace(/^::ffff:/, '')
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.')
  )
}

/** RFC1918 + link-local IPv4. Chrome / desktop Connect accept these; WAN stays on desktop. */
export function isPrivateLanAddress(addr?: string | null): boolean {
  if (!addr || isLoopbackAddress(addr)) return false
  const normalized = addr
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/, '')
  const match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const a = Number(match[1])
  const b = Number(match[2])
  const c = Number(match[3])
  const d = Number(match[4])
  if ([a, b, c, d].some((part) => part > 255)) return false
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254) return true
  return false
}

export function isLocalPairingHost(addr?: string | null): boolean {
  return isLoopbackAddress(addr) || isPrivateLanAddress(addr)
}

export function webScanPorts(hint?: number[], channel?: VavRuntimeChannel): number[] {
  const ports = new Set<number>()
  const hints: number[] = []
  for (const port of hint ?? []) {
    if (Number.isInteger(port) && port > 0 && port < 65536) {
      ports.add(port)
      hints.push(port)
    }
  }
  const inferred =
    channel ??
    hints.map(webChannelForPort).find((value): value is VavRuntimeChannel => value != null) ??
    'release'
  const range = webPortRange(inferred)
  for (let port = range.start; port <= range.last; port++) ports.add(port)
  return [...ports]
}

export function buildDiscoverPayload(
  opts: {
    name?: string
    version?: string
    secret: () => string
    port?: number
    hasKey?: () => boolean
  },
  loopback: boolean
): VavDiscoverInfo {
  const payload: VavDiscoverInfo = {
    proto: 1,
    app: VAV_DISCOVER_APP,
    name: (opts.name || 'vav-server').trim() || 'vav-server',
    version: (opts.version || '0.0.0').trim() || '0.0.0',
    wsPath: VAV_WEB_SOCKET_PATH,
    loopback
  }
  if (typeof opts.port === 'number' && Number.isInteger(opts.port) && opts.port > 0) {
    payload.port = opts.port
  }
  payload.hasSecret = Boolean(opts.secret())
  if (loopback) {
    const secret = opts.secret()
    if (secret) payload.secret = secret
    if (opts.hasKey) payload.hasKey = opts.hasKey() === true
  }
  return payload
}
