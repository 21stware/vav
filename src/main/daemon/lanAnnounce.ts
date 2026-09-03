/**
 * LAN discovery for vavd — UDP multicast, no extra dependency.
 * Announce does not carry the pairing secret.
 */

import { createSocket } from 'node:dgram'
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import {
  DAEMON_ANNOUNCE_PORT,
  DAEMON_DEFAULT_PORT,
  DAEMON_MULTICAST,
  parseDaemonAnnounce,
  type DaemonAnnounce
} from '../../shared/daemonProtocol.ts'

type IfaceMap = NodeJS.Dict<NetworkInterfaceInfo[]>

/** Virtual / peer-to-peer NICs that often steal the advertised pairing IP. */
const SKIP_IFACE =
  /^(awdl\d*|llw\d*|bridge\d*|ap\d+|vmnet\d*|vnic\d*|vmenet\d*|docker\d*|br-.+|cni\d*|flannel\d*|veth.*|gif\d*|stf\d*|anpi\d*)/i

function isIPv4(entry: NetworkInterfaceInfo): boolean {
  return entry.family === 'IPv4' || (entry.family as unknown) === 4
}

function ifaceRank(name: string): number {
  if (/^en\d+$/i.test(name) || /^eth\d+$/i.test(name) || /^wlan/i.test(name) || /^wl/i.test(name)) {
    return 0
  }
  if (/^utun\d*$/i.test(name) || /^tailscale/i.test(name) || /^tun/i.test(name)) return 2
  return 1
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function lanAddresses(ifaces: IfaceMap = networkInterfaces()): string[] {
  const names = Object.keys(ifaces).sort((a, b) => ifaceRank(a) - ifaceRank(b) || a.localeCompare(b))
  const found: string[] = []
  for (const name of names) {
    if (SKIP_IFACE.test(name)) continue
    const list = ifaces[name]
    if (!list) continue
    for (const entry of list) {
      if (entry.internal || !isIPv4(entry)) continue
      if (entry.address.startsWith('169.254.')) continue
      found.push(entry.address)
    }
  }
  return uniqueStrings(found)
}

/** Bonjour / mDNS name other machines can dial when the advertised IPv4 is stale. */
export function mdnsName(osHostname = hostname(), identityName?: string): string | undefined {
  const host = osHostname.trim()
  if (host.endsWith('.local')) return host
  if (host && !host.includes('.')) return `${host}.local`
  const identity = identityName?.trim()
  if (identity?.endsWith('.local')) return identity
  return undefined
}

export function advertisedPairingAddresses(opts?: {
  interfaces?: IfaceMap
  hostname?: string
  identityName?: string
}): { host: string; addresses: string[] } {
  const ips = lanAddresses(opts?.interfaces)
  const mdns = mdnsName(opts?.hostname, opts?.identityName)
  const addresses = uniqueStrings([...ips, ...(mdns ? [mdns] : [])])
  return {
    host: ips[0] || mdns || '127.0.0.1',
    addresses: addresses.length > 0 ? addresses : ['127.0.0.1']
  }
}

export type DialTarget = { host: string; port: number }

function ipv4Slash24(ip: string): string | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  if (parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  return `${parts[0]}.${parts[1]}.${parts[2]}`
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

function rankTarget(target: DialTarget, local: string[], discoveredHosts: Set<string>): number {
  if (isLoopbackHost(target.host)) return 90
  if (discoveredHosts.has(target.host)) return 0
  const prefix = ipv4Slash24(target.host)
  if (prefix && local.some((ip) => ipv4Slash24(ip) === prefix)) return 1
  if (target.host.endsWith('.local')) return 3
  return 2
}

/**
 * Addresses a client should try, in order. Live multicast source IPs go first —
 * those packets actually arrived, unlike a stale `host` in the pairing line.
 */
export function collectDialTargets(input: {
  host?: string
  port?: number
  addresses?: string[]
  name?: string
  machineId?: string
  discovered?: Array<{ machineId: string; address: string; port: number }>
  localAddresses?: string[]
}): DialTarget[] {
  const port = input.port && input.port > 0 ? input.port : DAEMON_DEFAULT_PORT
  const seen = new Set<string>()
  const localOwn = new Set(input.localAddresses ?? [])
  const selfMdns = mdnsName()
  const out: DialTarget[] = []
  const add = (host: string | undefined, p = port): void => {
    const h = host?.trim()
    if (!h) return
    // Pairing lines often list this machine's VPN / fake-IP (198.18.0.1).
    // Dialing that hits our own VAV and looks like "pairing rejected".
    if (localOwn.has(h) || (selfMdns && h === selfMdns)) return
    const key = `${h}:${p}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ host: h, port: p })
  }

  const discoveredHosts = new Set<string>()
  if (input.machineId) {
    for (const peer of input.discovered ?? []) {
      if (peer.machineId !== input.machineId) continue
      discoveredHosts.add(peer.address)
      add(peer.address, peer.port)
      add(peer.address, port)
    }
  }

  for (const address of input.addresses ?? []) add(address)
  add(input.host)
  const name = input.name?.trim()
  if (name?.endsWith('.local')) add(name)
  // Same-machine pair (two VAV processes, tests) — LAN IPs are filtered as
  // "self" above, so loopback is the only way to reach the other listener.
  add('127.0.0.1')

  if (out.length === 0) add('127.0.0.1')
  const local = input.localAddresses ?? []
  out.sort(
    (a, b) =>
      rankTarget(a, local, discoveredHosts) - rankTarget(b, local, discoveredHosts) ||
      a.host.localeCompare(b.host) ||
      a.port - b.port
  )
  return out
}

function sendOnLanInterfaces(
  socket: ReturnType<typeof createSocket>,
  body: Buffer,
  ips: string[]
): void {
  if (ips.length === 0) {
    try {
      socket.send(body, DAEMON_ANNOUNCE_PORT, DAEMON_MULTICAST)
    } catch {
      /* ignore */
    }
    return
  }
  for (const ip of ips) {
    try {
      socket.setMulticastInterface(ip)
      socket.send(body, DAEMON_ANNOUNCE_PORT, DAEMON_MULTICAST)
    } catch {
      /* ignore */
    }
  }
}

export function startAnnouncer(payload: DaemonAnnounce): () => void {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  let timer: NodeJS.Timeout | null = null
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const send = (): void => {
    sendOnLanInterfaces(socket, body, lanAddresses())
  }
  socket.on('error', () => undefined)
  socket.bind(0, () => {
    try {
      socket.setMulticastTTL(1)
    } catch {
      /* ignore */
    }
    send()
    timer = setInterval(send, 2_000)
  })
  return () => {
    if (timer) clearInterval(timer)
    socket.close()
  }
}

export type DiscoveredPeer = DaemonAnnounce & { address: string; seenAt: number }

/**
 * Drop this machine (identity + local IPs / Bonjour) and keep one row per
 * peer. Multicast loopback and multi-NIC announces otherwise list "us" again.
 */
export function visibleLanPeers<T extends { machineId: string; address: string; seenAt?: number }>(
  peers: T[],
  self: { machineId: string; localAddresses?: string[]; mdns?: string }
): T[] {
  const local = new Set(self.localAddresses ?? lanAddresses())
  local.add('127.0.0.1')
  local.add('::1')
  local.add('localhost')
  const mdns = self.mdns?.trim()
  if (mdns) {
    local.add(mdns)
    if (mdns.endsWith('.local')) local.add(mdns.slice(0, -'.local'.length))
  }

  const best = new Map<string, T>()
  for (const peer of peers) {
    if (peer.machineId === self.machineId) continue
    if (local.has(peer.address)) continue
    const prev = best.get(peer.machineId)
    if (!prev || (peer.seenAt ?? 0) >= (prev.seenAt ?? 0)) best.set(peer.machineId, peer)
  }
  return [...best.values()].sort((a, b) => a.machineId.localeCompare(b.machineId))
}

export function startBrowser(onChange: (peers: DiscoveredPeer[]) => void): () => void {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  const peers = new Map<string, DiscoveredPeer>()
  const emit = (): void => {
    onChange([...peers.values()].sort((a, b) => a.name.localeCompare(b.name)))
  }
  socket.on('error', () => undefined)
  socket.on('message', (msg, rinfo) => {
    try {
      const parsed = parseDaemonAnnounce(JSON.parse(msg.toString('utf8')))
      if (!parsed) return
      const key = `${parsed.machineId}@${rinfo.address}:${parsed.port}`
      peers.set(key, { ...parsed, address: rinfo.address, seenAt: Date.now() })
      emit()
    } catch {
      /* ignore */
    }
  })
  socket.bind(DAEMON_ANNOUNCE_PORT, () => {
    const ips = lanAddresses()
    if (ips.length === 0) {
      try {
        socket.addMembership(DAEMON_MULTICAST)
      } catch {
        /* ignore — still receive unicast / some stacks */
      }
      return
    }
    for (const ip of ips) {
      try {
        socket.addMembership(DAEMON_MULTICAST, ip)
      } catch {
        /* ignore */
      }
    }
  })
  const prune = setInterval(() => {
    const cutoff = Date.now() - 8_000
    let changed = false
    for (const [key, peer] of peers) {
      if (peer.seenAt < cutoff) {
        peers.delete(key)
        changed = true
      }
    }
    if (changed) emit()
  }, 3_000)
  return () => {
    clearInterval(prune)
    socket.close()
  }
}
