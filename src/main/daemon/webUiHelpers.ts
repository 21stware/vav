/**
 * Browser-safe helpers shared by the bundled vavd page, tests, and the
 * Chrome side panel. Keep these free of Node APIs.
 */

/** Pairing secret from a pasted URI, `host:port#secret`, or a raw secret. */
export function pairingAuthFromInput(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  if (text.startsWith('vav-daemon://')) {
    try {
      const url = new URL(text)
      if (url.username) return decodeURIComponent(url.username)
    } catch {
      /* fall through */
    }
  }
  const hostPort = text.match(/^\S+:\d+\s*[#\s]+(\S+)$/)
  if (hostPort?.[1]) return hostPort[1]
  return text
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function parseHostHeader(hostHeader: string | undefined): string {
  const raw = (hostHeader ?? '').trim()
  if (!raw) return ''
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end > 0) return raw.slice(1, end).toLowerCase()
  }
  return raw.split('%')[0]!.split(':')[0]!.toLowerCase()
}

export function isLoopbackListen(listen: string): boolean {
  const value = listen.trim().toLowerCase()
  return value === '127.0.0.1' || value === 'localhost' || value === '::1'
}

/** Loopback web UI rejects DNS-rebinding Host headers. LAN binds stay open. */
export function webHostAllowed(hostHeader: string | undefined, listen: string): boolean {
  if (!isLoopbackListen(listen)) return true
  const host = parseHostHeader(hostHeader)
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

export function formatConnectHint(host: string, port: number): string {
  return `could not reach vavd at ${host}:${port} — is it running?`
}
