/**
 * LAN discovery for vavd — UDP multicast, no extra dependency.
 * Announce does not carry the pairing secret.
 */

import { createSocket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import {
  DAEMON_ANNOUNCE_PORT,
  DAEMON_MULTICAST,
  parseDaemonAnnounce,
  type DaemonAnnounce
} from '../../shared/daemonProtocol.ts'

export function lanAddresses(): string[] {
  const found: string[] = []
  const ifaces = networkInterfaces()
  for (const list of Object.values(ifaces)) {
    if (!list) continue
    for (const entry of list) {
      if (entry.internal) continue
      if (String(entry.family) === 'IPv4' || (entry.family as unknown) === 4) {
        found.push(entry.address)
      }
    }
  }
  return found
}

export function startAnnouncer(payload: DaemonAnnounce): () => void {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  let timer: NodeJS.Timeout | null = null
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const send = (): void => {
    try {
      socket.send(body, DAEMON_ANNOUNCE_PORT, DAEMON_MULTICAST)
    } catch {
      /* ignore */
    }
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
    try {
      socket.addMembership(DAEMON_MULTICAST)
    } catch {
      /* ignore — still receive unicast / some stacks */
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
