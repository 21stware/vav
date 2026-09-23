import { isLoopbackAddress } from '../../shared/vavDiscover.ts'

function normalizeHostHeader(hostHeader: string): { hostname: string; port: string } {
  const host = hostHeader.trim().toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return {
      hostname: host.slice(0, end + 1),
      port: host.slice(end + 1).startsWith(':') ? host.slice(end + 2) : ''
    }
  }
  const colon = host.lastIndexOf(':')
  if (colon !== -1) {
    return { hostname: host.slice(0, colon), port: host.slice(colon + 1) }
  }
  return { hostname: host, port: '' }
}

/** Accept only loopback (or the LAN bind address) Host headers. */
export function isTrustedBridgeHost(
  hostHeader: string | undefined,
  port: number,
  listen: string
): boolean {
  if (!hostHeader) return false
  const { hostname, port: hostPort } = normalizeHostHeader(hostHeader)
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
  if (!isLoopbackAddress(listen)) {
    const bind = listen.replace(/^\[|\]$/g, '').toLowerCase()
    allowed.add(bind)
    allowed.add(`[${bind}]`)
  }
  if (!allowed.has(hostname)) return false
  if (hostPort && Number(hostPort) !== port) return false
  return true
}

/**
 * Browser Origin must be this bridge or a Chrome extension.
 * Missing Origin (non-browser clients) is allowed; the pairing secret still applies.
 */
export function isTrustedBridgeOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true
  if (origin.startsWith('chrome-extension://')) return true
  try {
    const url = new URL(origin)
    if (!isLoopbackAddress(url.hostname)) return false
    const originPort = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
    return originPort === port
  } catch {
    return false
  }
}
