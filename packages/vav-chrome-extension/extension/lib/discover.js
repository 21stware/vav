export const VAV_SERVER_WEB_DEFAULT_PORT = 4752
export const VAV_SERVER_WEB_SCAN_LAST = 4762
export const VAV_DISCOVER_PATH = '/discover'
export const VAV_WEB_SOCKET_PATH = '/vav'

export function isLoopbackAddress(addr) {
  if (!addr) return false
  const normalized = String(addr)
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/, '')
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized.startsWith('127.')
  )
}

/** RFC1918 + link-local IPv4. Chrome Connect accepts these; WAN stays on desktop. */
export function isPrivateLanAddress(addr) {
  if (!addr || isLoopbackAddress(addr)) return false
  const normalized = String(addr)
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

export function isLocalPairingHost(addr) {
  return isLoopbackAddress(addr) || isPrivateLanAddress(addr)
}

/** Keep loopback and private LAN. Rewrite WAN / unknown hosts onto loopback. */
export function pairingHost(addr) {
  const clean = String(addr || '')
    .trim()
    .replace(/^\[|\]$/g, '')
  if (isLocalPairingHost(clean)) return clean
  return '127.0.0.1'
}

/** MV3 optional_host_permissions cover LAN after the side panel requests them. */
export function loopbackWebOrigin(origin) {
  try {
    const url = new URL(origin)
    url.hostname = pairingHost(url.hostname)
    return `${url.protocol}//${url.host}`
  } catch {
    return origin
  }
}

export function loopbackWsUrl(wsUrl) {
  try {
    const url = new URL(wsUrl)
    url.hostname = pairingHost(url.hostname)
    return url.toString()
  } catch {
    return wsUrl
  }
}

export function webScanPorts(hint = []) {
  const ports = new Set()
  for (const port of hint) {
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port)
  }
  for (let port = VAV_SERVER_WEB_DEFAULT_PORT; port <= VAV_SERVER_WEB_SCAN_LAST; port++) ports.add(port)
  return [...ports]
}

export function discoverOrigins(hint = {}, extraHosts = []) {
  const hosts = new Set(['127.0.0.1', 'localhost'])
  for (const host of extraHosts.filter(Boolean)) {
    hosts.add(pairingHost(host))
  }
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

export async function probeDiscover(origin, ms = 1500) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(`${origin}${VAV_DISCOVER_PATH}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const info = await res.json()
    if (!info || info.app !== 'vav-server' || info.proto !== 1) return null
    return { ...info, origin, wsUrl: wsUrlFromOrigin(origin, info.wsPath) }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function rankFound(row) {
  if (row.secret && row.hasKey === true) return 0
  if (row.secret && row.hasKey !== false) return 1
  if (row.secret) return 2
  return 3
}

export async function findLocalVavServer(hint = {}) {
  const origins = discoverOrigins(hint, hint.hosts || [])
  if (hint.origin) origins.unshift(loopbackWebOrigin(hint.origin))
  const found = (await Promise.all(origins.map((origin) => probeDiscover(origin)))).filter(Boolean)
  found.sort((a, b) => rankFound(a) - rankFound(b))
  return found[0] || null
}
