/**
 * SSRF guard for agent web tools.
 *
 * Blocks non-http(s) schemes, localhost / private / link-local hosts, and
 * re-checks every redirect hop after DNS resolution (DNS rebinding).
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata'
])

/** Default: only well-known web ports. Search backends may relax this. */
const DEFAULT_PORTS = new Set([80, 443])

export interface PublicUrlOptions {
  /** Allow non-80/443 ports (e.g. self-hosted SearXNG). */
  allowNonStandardPorts?: boolean
  /** Explicit host allowlist (hostname lowercased). Bypasses private-IP checks. */
  allowHosts?: ReadonlySet<string>
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfError'
  }
}

export function parseHttpUrl(raw: string): URL {
  const trimmed = raw.trim()
  if (!trimmed) throw new SsrfError('URL is empty')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new SsrfError(`Invalid URL: ${trimmed}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`Only http(s) URLs are allowed (got ${url.protocol})`)
  }
  if (url.username || url.password) {
    throw new SsrfError('URLs with embedded credentials are not allowed')
  }
  return url
}

export async function assertPublicHttpUrl(
  raw: string,
  options: PublicUrlOptions = {}
): Promise<URL> {
  const url = parseHttpUrl(raw)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  if (!host) throw new SsrfError('URL has no hostname')
  if (BLOCKED_HOSTS.has(host)) {
    throw new SsrfError(`Blocked host: ${host}`)
  }
  if (host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new SsrfError(`Blocked host: ${host}`)
  }

  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new SsrfError(`Invalid port: ${url.port}`)
  }
  if (!options.allowNonStandardPorts && !DEFAULT_PORTS.has(port)) {
    throw new SsrfError(`Port ${port} is not allowed (only 80/443 by default)`)
  }

  const allowHosts = options.allowHosts
  if (allowHosts?.has(host)) return url

  // Literal IP in the URL.
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError(`Blocked IP address: ${host}`)
    return url
  }

  // Resolve all records and reject if any address is non-public.
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new SsrfError(`DNS lookup failed for ${host}: ${msg}`)
  }
  if (addresses.length === 0) {
    throw new SsrfError(`DNS returned no addresses for ${host}`)
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfError(`Host ${host} resolves to blocked address ${address}`)
    }
  }
  return url
}

/** True if the IP must not be contacted by web tools. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isBlockedIpv4(ip)
  if (v === 6) return isBlockedIpv6(ip)
  return true
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts as [number, number, number, number]

  // 0.0.0.0/8, loopback, link-local, private, CGNAT, multicast, reserved, broadcast
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 192 && b === 0 && parts[2] === 0) return true
  if (a === 192 && b === 0 && parts[2] === 2) return true // TEST-NET-1
  // Note: 198.18.0.0/15 is RFC 2544 benchmarking, but also widely used by
  // desktop proxies (Clash/Surge fake-ip). Blocking it breaks real browsing
  // for those users, so it is intentionally allowed.
  if (a === 198 && b === 51 && parts[2] === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true // TEST-NET-3
  if (a >= 224) return true // multicast + reserved
  return false
}

function isBlockedIpv6(ip: string): boolean {
  const bare = (ip.split('%')[0] ?? ip).toLowerCase()
  // Loopback / unspecified
  if (bare === '::1' || bare === '::') return true

  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:XXXX:YYYY, including odd forms
  // like ::ffff:0:c612:78 seen from some resolvers / fake-ip stacks).
  const v4 = ipv4FromMappedV6(bare)
  if (v4) return isBlockedIpv4(v4)

  const hextets = expandIpv6(bare)
  if (!hextets) return true
  const first = hextets[0]!
  // fe80::/10 link-local
  if (first >= 0xfe80 && first <= 0xfebf) return true
  // fc00::/7 unique local
  if (first >= 0xfc00 && first <= 0xfdff) return true
  // ff00::/8 multicast
  if (first >= 0xff00 && first <= 0xffff) return true
  // 2001:db8::/32 documentation
  if (first === 0x2001 && hextets[1] === 0xdb8) return true
  return false
}

/** Extract embedded IPv4 from common IPv4-mapped IPv6 spellings. */
function ipv4FromMappedV6(ip: string): string | null {
  const dotted = ip.match(/:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)
  if (dotted) return dotted[1]!

  // ::ffff:HHHH:LLLL  (two hextets = 4 bytes)
  const two = ip.match(/:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (two) {
    const hi = parseInt(two[1]!, 16)
    const lo = parseInt(two[2]!, 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }

  // ::ffff:0:HHHH:LLLL (three hextets after ffff — some stacks pad a zero)
  const three = ip.match(/:ffff:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (three) {
    const hi = parseInt(three[1]!, 16)
    const lo = parseInt(three[2]!, 16)
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  }

  return null
}

/** Expand an IPv6 address into 8 hextets, or null if unparseable. */
function expandIpv6(ip: string): number[] | null {
  if (ip.includes('.')) {
    // Embedded IPv4 at the end without ffff handling above — treat as opaque.
    return null
  }
  const sides = ip.split('::')
  if (sides.length > 2) return null
  const parseSide = (side: string): number[] => {
    if (!side) return []
    return side.split(':').map((h) => parseInt(h, 16))
  }
  let head: number[]
  let tail: number[]
  if (sides.length === 2) {
    head = parseSide(sides[0]!)
    tail = parseSide(sides[1]!)
  } else {
    head = parseSide(ip)
    tail = []
  }
  if (head.some((n) => !Number.isFinite(n)) || tail.some((n) => !Number.isFinite(n))) {
    return null
  }
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  if (sides.length === 1 && missing !== 0) return null
  return [...head, ...Array(missing).fill(0), ...tail]
}
