/**
 * Same-port loopback listeners for PTY services on a paired host.
 *
 * Local / loopback vav-server rows are marks only. Remote rows bind
 * 127.0.0.1:<port> and proxy through `hello.role=proxy`. Collision is
 * `conflict` — never a silent remap.
 */

import { createServer, type Server, type Socket } from 'node:net'
import {
  portForwardKey,
  type PtyPortForward,
  type PtyPortForwardStatus
} from '../../shared/ptyPorts.ts'
import { openPortProxy, pipeSockets, type PortProxyDial } from '../daemon/portProxy.ts'

export type DesiredPortForward = {
  hostId: string
  tabId: string
  conversationId: string
  remotePort: number
  mode: 'local' | 'proxy'
  dial?: PortProxyDial | null
}

type LiveRow = {
  key: string
  hostId: string
  remotePort: number
  localPort: number
  status: PtyPortForwardStatus
  tabIds: Set<string>
  conversationIds: Set<string>
  server: Server | null
  lingerUntil: number
}

const LINGER_MS = 4_000

export class PortForwardService {
  private readonly rows = new Map<string, LiveRow>()
  private readonly byTab = new Map<string, PtyPortForward[]>()
  private lingerTimer: ReturnType<typeof setInterval> | null = null
  private readonly onChanged: (conversationIds: string[]) => void

  constructor(onChanged: (conversationIds: string[]) => void) {
    this.onChanged = onChanged
  }

  snapshotForTab(tabId: string): PtyPortForward[] | undefined {
    const rows = this.byTab.get(tabId)
    return rows?.length ? rows.map((row) => ({ ...row })) : undefined
  }

  close(): void {
    if (this.lingerTimer) {
      clearInterval(this.lingerTimer)
      this.lingerTimer = null
    }
    for (const row of this.rows.values()) this.teardown(row)
    this.rows.clear()
    this.byTab.clear()
  }

  sync(desired: DesiredPortForward[]): void {
    const now = Date.now()
    const wanted = new Map<string, DesiredPortForward[]>()
    for (const item of desired) {
      if (!Number.isInteger(item.remotePort) || item.remotePort < 1) continue
      const key = portForwardKey(item.hostId, item.remotePort)
      const list = wanted.get(key) ?? []
      list.push(item)
      wanted.set(key, list)
    }

    const changed = new Set<string>()
    for (const [key, items] of wanted) {
      const first = items[0]!
      let row = this.rows.get(key)
      const tabIds = new Set(items.map((item) => item.tabId))
      const conversationIds = new Set(items.map((item) => item.conversationId))
      if (!row) {
        row = {
          key,
          hostId: first.hostId,
          remotePort: first.remotePort,
          localPort: first.mode === 'local' ? first.remotePort : 0,
          status: first.mode === 'local' ? 'local' : 'error',
          tabIds,
          conversationIds,
          server: null,
          lingerUntil: 0
        }
        this.rows.set(key, row)
        if (first.mode === 'proxy') this.bindProxy(row, first.dial ?? null)
        else for (const id of conversationIds) changed.add(id)
      } else {
        row.tabIds = tabIds
        row.conversationIds = conversationIds
        row.lingerUntil = 0
        if (first.mode === 'local' && row.status !== 'local') {
          this.teardown(row)
          row.status = 'local'
          row.localPort = first.remotePort
          row.server = null
          for (const id of conversationIds) changed.add(id)
        } else if (first.mode === 'proxy' && !row.server && row.status !== 'conflict') {
          this.bindProxy(row, first.dial ?? null)
          for (const id of conversationIds) changed.add(id)
        }
      }
    }

    for (const row of this.rows.values()) {
      if (wanted.has(row.key)) continue
      if (row.lingerUntil === 0) row.lingerUntil = now + LINGER_MS
    }
    this.reindex()
    if (changed.size) this.onChanged([...changed])
    this.ensureLingerTimer()
  }

  private ensureLingerTimer(): void {
    const lingering = [...this.rows.values()].some((row) => row.lingerUntil > 0)
    if (lingering && !this.lingerTimer) {
      this.lingerTimer = setInterval(() => this.reapLingering(), 1_000)
      this.lingerTimer.unref?.()
    }
    if (!lingering && this.lingerTimer) {
      clearInterval(this.lingerTimer)
      this.lingerTimer = null
    }
  }

  private reapLingering(): void {
    const now = Date.now()
    const changed = new Set<string>()
    for (const [key, row] of [...this.rows]) {
      if (row.lingerUntil === 0 || row.lingerUntil > now) continue
      for (const id of row.conversationIds) changed.add(id)
      this.teardown(row)
      this.rows.delete(key)
    }
    this.reindex()
    if (changed.size) this.onChanged([...changed])
    this.ensureLingerTimer()
  }

  private bindProxy(row: LiveRow, dial: PortProxyDial | null): void {
    if (!dial) {
      row.status = 'error'
      row.localPort = 0
      this.reindex()
      this.onChanged([...row.conversationIds])
      return
    }
    const server = createServer((client) => {
      void this.proxyOne(client, dial, row.remotePort)
    })
    server.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code
      row.status = code === 'EADDRINUSE' ? 'conflict' : 'error'
      row.localPort = 0
      row.server = null
      this.reindex()
      this.onChanged([...row.conversationIds])
    })
    try {
      server.listen(row.remotePort, '127.0.0.1', () => {
        row.server = server
        row.localPort = row.remotePort
        row.status = 'forwarding'
        this.reindex()
        this.onChanged([...row.conversationIds])
      })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      row.status = code === 'EADDRINUSE' ? 'conflict' : 'error'
      row.localPort = 0
    }
  }

  private async proxyOne(client: Socket, dial: PortProxyDial, remotePort: number): Promise<void> {
    try {
      const remote = await openPortProxy(dial, remotePort)
      pipeSockets(client, remote)
    } catch {
      client.destroy()
    }
  }

  private teardown(row: LiveRow): void {
    if (!row.server) return
    try {
      row.server.close()
    } catch {
      /* already closed */
    }
    row.server = null
  }

  private reindex(): void {
    this.byTab.clear()
    for (const row of this.rows.values()) {
      if (row.lingerUntil > 0) continue
      const forward: PtyPortForward = {
        remotePort: row.remotePort,
        localPort: row.localPort,
        status: row.status
      }
      for (const tabId of row.tabIds) {
        const list = this.byTab.get(tabId) ?? []
        list.push(forward)
        this.byTab.set(tabId, list)
      }
    }
    for (const list of this.byTab.values()) {
      list.sort((a, b) => a.remotePort - b.remotePort)
    }
  }
}
