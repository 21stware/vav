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

export function webScanPorts(hint?: number[]): number[] {
  const ports = new Set<number>()
  for (const port of hint ?? []) {
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port)
  }
  for (let port = VAVD_WEB_DEFAULT_PORT; port <= VAVD_WEB_SCAN_LAST; port++) ports.add(port)
  return [...ports]
}

export function buildDiscoverPayload(
  opts: { name?: string; version?: string; secret: () => string },
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
  if (loopback) {
    const secret = opts.secret()
    if (secret) payload.secret = secret
  }
  return payload
}
