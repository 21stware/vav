export const VAVD_WEB_DEFAULT_PORT = 4752
export const VAVD_WEB_SCAN_LAST = 4762
export const VAV_DISCOVER_PATH = '/discover'
export const VAV_WEB_SOCKET_PATH = '/vav'

export function webScanPorts(hint = []) {
  const ports = new Set()
  for (const port of hint) {
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port)
  }
  for (let port = VAVD_WEB_DEFAULT_PORT; port <= VAVD_WEB_SCAN_LAST; port++) ports.add(port)
  return [...ports]
}

export function discoverOrigins(hint = {}, extraHosts = []) {
  const hosts = new Set(['127.0.0.1', 'localhost', ...extraHosts.filter(Boolean)])
  const origins = []
  for (const host of hosts) {
    const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    for (const port of webScanPorts(hint.ports)) {
      origins.push(`http://${authority}:${port}`)
    }
  }
  return origins
}

export function wsUrlFromOrigin(origin, wsPath = VAV_WEB_SOCKET_PATH) {
  const url = new URL(origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = wsPath || VAV_WEB_SOCKET_PATH
  url.search = ''
  url.hash = ''
  return url.toString()
}

export async function probeDiscover(origin, ms = 600) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(`${origin}${VAV_DISCOVER_PATH}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const info = await res.json()
    if (!info || info.app !== 'vavd' || info.proto !== 1) return null
    return { origin, wsUrl: wsUrlFromOrigin(origin, info.wsPath), ...info }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function findLocalVavd(hint = {}) {
  const origins = discoverOrigins(hint, hint.hosts || [])
  if (hint.origin) origins.unshift(hint.origin)
  const found = (await Promise.all(origins.map((origin) => probeDiscover(origin)))).filter(Boolean)
  const withSecret = found.filter((row) => row.secret)
  return (withSecret[0] || found[0] || null)
}
