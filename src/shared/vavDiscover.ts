/**
 * Loopback discovery for the vavd web bridge.
 *
 * Chrome / the bundled page probe `/discover` on well-known ports. The pairing
 * secret is included only for loopback clients — same threat model as reading
 * `~/.vavd/secret.json` on this machine. LAN clients still paste a URI.
 */

export const VAVD_WEB_DEFAULT_PORT = 4752
export const VAVD_WEB_SCAN_LAST = 4762
export const VAV_DISCOVER_PATH = '/discover'
export const VAV_WEB_SOCKET_PATH = '/vav'
export const VAV_DISCOVER_APP = 'vavd'

export type VavDiscoverInfo = {
  proto: 1
  app: typeof VAV_DISCOVER_APP
  name: string
  version: string
  wsPath: typeof VAV_WEB_SOCKET_PATH
  loopback: boolean
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

export function webScanPorts(hint?: number[]): number[] {
  const ports = new Set<number>()
  for (const port of hint ?? []) {
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port)
  }
  for (let port = VAVD_WEB_DEFAULT_PORT; port <= VAVD_WEB_SCAN_LAST; port++) ports.add(port)
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
    name: (opts.name || 'vavd').trim() || 'vavd',
    version: (opts.version || '0.0.0').trim() || '0.0.0',
    wsPath: VAV_WEB_SOCKET_PATH,
    loopback
  }
  if (typeof opts.port === 'number' && Number.isInteger(opts.port) && opts.port > 0) {
    payload.port = opts.port
  }
  if (loopback) {
    const secret = opts.secret()
    if (secret) payload.secret = secret
    if (opts.hasKey) payload.hasKey = opts.hasKey() === true
  }
  return payload
}
