import { VAVD_WEB_DEFAULT_PORT, VAV_WEB_SOCKET_PATH, wsUrlFromOrigin } from './discover.js'

/**
 * Parse a paste from Connect, a local URL, or a raw pairing secret.
 * Desktop Connect copies `vav-daemon://…` (daemon TCP). The extension talks
 * HTTP/WS on the web bridge (default 4752), which shares that secret.
 */
export function parsePairing(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null

  if (trimmed.startsWith('vav-daemon://')) {
    try {
      const url = new URL(trimmed)
      const secret = decodeURIComponent(url.username)
      if (secret.length < 16) return null
      const host = url.hostname.replace(/^\[|\]$/g, '') || '127.0.0.1'
      const origin = `http://${host.includes(':') ? `[${host}]` : host}:${VAVD_WEB_DEFAULT_PORT}`
      return { secret, host, origin, wsUrl: wsUrlFromOrigin(origin) }
    } catch {
      return null
    }
  }

  if (/^https?:\/\//i.test(trimmed) || /^wss?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const http = new URL(url.href)
      http.protocol = url.protocol === 'wss:' || url.protocol === 'https:' ? 'https:' : 'http:'
      if (url.protocol === 'ws:' || url.protocol === 'wss:') {
        http.pathname = '/'
      }
      const origin = `${http.protocol}//${http.host}`
      const wsPath =
        url.protocol === 'ws:' || url.protocol === 'wss:'
          ? url.pathname || VAV_WEB_SOCKET_PATH
          : VAV_WEB_SOCKET_PATH
      const secret = url.username ? decodeURIComponent(url.username) : undefined
      if (secret && secret.length < 16) return null
      return {
        host: url.hostname.replace(/^\[|\]$/g, ''),
        origin,
        wsUrl: wsUrlFromOrigin(origin, wsPath),
        ...(secret ? { secret } : {})
      }
    } catch {
      return null
    }
  }

  if (/^vav-remote:/i.test(trimmed)) return null
  if (trimmed.length >= 16 && !/\s/.test(trimmed) && !/[:/?#]/.test(trimmed)) {
    return { secret: trimmed }
  }
  return null
}
