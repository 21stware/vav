/**
 * Desktop side of the daemon: listen (so others can attach here), persist
 * paired remotes, reconnect, and register them on HostRegistry.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Socket } from 'node:net'
import {
  DAEMON_DEFAULT_PORT,
  DAEMON_PROTO_VERSION,
  encodeDaemonPairing,
  parseDaemonPairing,
  type DaemonPairing
} from '../../shared/daemonProtocol.ts'
import type { WorkspaceHostInfo } from '../../shared/workspaceHost.ts'
import type { HostRegistry, WorkspaceHost } from '../host/WorkspaceHost.ts'
import { DaemonServer } from './DaemonServer.ts'
import { DaemonClient, createRemoteWorkspaceHost } from './DaemonClient.ts'
import { loadOrCreateIdentity, type DaemonIdentity } from './identity.ts'
import { lanAddresses, startAnnouncer, startBrowser, type DiscoveredPeer } from './lanAnnounce.ts'

function offlineWorkspaceHost(id: string, name: string): WorkspaceHost {
  const fail = (): never => {
    throw new Error(`${name} is offline`)
  }
  return {
    id,
    info: { id, name, kind: 'remote', online: false },
    fs: {
      readdir: fail,
      stat: fail,
      readFile: fail,
      writeFile: fail,
      mkdir: fail,
      rename: fail,
      open: fail,
      watch: fail,
      exists: fail
    },
    process: { spawn: fail },
    pty: { spawn: fail }
  }
}

export type PairedHostRecord = {
  machineId: string
  name: string
  secret: string
  host: string
  port: number
  token?: string
  addresses?: string[]
}

type AttachOpts = {
  userData: string
  registry: HostRegistry
  identityName?: string
  secret: () => string
  appVersion: string
  enabled: () => boolean
  tailcatToken: () => string | null
  onHostsChanged: (hosts: WorkspaceHostInfo[]) => void
  onDiscovered?: (peers: DiscoveredPeer[]) => void
}

export class DaemonAttachService {
  private server: DaemonServer | null = null
  private stopAnnounce: (() => void) | null = null
  private stopBrowse: (() => void) | null = null
  private readonly clients = new Map<string, DaemonClient>()
  private readonly homes = new Map<string, string>()
  private discovered: DiscoveredPeer[] = []
  readonly identity: DaemonIdentity
  private listenPort = 0
  private readonly opts: AttachOpts

  constructor(opts: AttachOpts) {
    this.opts = opts
    this.identity = loadOrCreateIdentity(join(opts.userData, 'daemon'), opts.identityName)
  }

  private get storeFile(): string {
    return join(this.opts.userData, 'paired-hosts.json')
  }

  applySettings(): void {
    if (this.opts.enabled()) this.startListen()
    else this.stopListen()
  }

  pairing(): string | null {
    if (!this.opts.enabled() && !this.server) return null
    const lans = lanAddresses()
    const payload: DaemonPairing = {
      v: DAEMON_PROTO_VERSION,
      secret: this.opts.secret(),
      machineId: this.identity.machineId,
      name: this.identity.name,
      host: lans[0] || '127.0.0.1',
      port: this.listenPort || DAEMON_DEFAULT_PORT,
      token: this.opts.tailcatToken() ?? undefined,
      addresses: [...lans, '127.0.0.1']
    }
    return encodeDaemonPairing(payload)
  }

  listenPortOf(): number {
    return this.listenPort
  }

  listDiscovered(): DiscoveredPeer[] {
    return this.discovered
  }

  homeOf(machineId: string): string {
    return this.homes.get(machineId) || homedir()
  }

  adoptAuthedSocket(socket: Socket, leftover = ''): void {
    this.ensureServer()
    this.server?.adopt(socket, leftover)
  }

  async pair(text: string): Promise<{ ok: true; host: WorkspaceHostInfo } | { ok: false; error: string }> {
    const parsed = parseDaemonPairing(text)
    if (!parsed) return { ok: false, error: 'unrecognized pairing payload' }
    const targets = this.targetsOf(parsed)
    if (targets.length === 0) return { ok: false, error: 'pairing is missing a host address' }
    try {
      const { client, welcome } = await this.dial(targets, parsed.secret)
      const record: PairedHostRecord = {
        machineId: welcome.host.id,
        name: welcome.host.name || parsed.name,
        secret: parsed.secret,
        host: targets[0].host,
        port: targets[0].port,
        token: parsed.token,
        addresses: parsed.addresses
      }
      this.remember(record)
      this.mount(client, welcome)
      return { ok: true, host: this.opts.registry.get(welcome.host.id)?.info ?? welcome.host }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  forget(machineId: string): void {
    this.clients.get(machineId)?.close()
    this.clients.delete(machineId)
    this.opts.registry.remove(machineId)
    const next = this.loadStore().filter((row) => row.machineId !== machineId)
    this.saveStore(next)
    this.opts.onHostsChanged(this.opts.registry.list())
  }

  restore(): void {
    for (const row of this.loadStore()) {
      void this.reconnect(row)
    }
    if (!this.stopBrowse) {
      this.stopBrowse = startBrowser((peers) => {
        this.discovered = peers.filter((p) => p.machineId !== this.identity.machineId)
        this.opts.onDiscovered?.(this.discovered)
      })
    }
  }

  dispose(): void {
    this.stopListen()
    this.stopBrowse?.()
    this.stopBrowse = null
    for (const client of this.clients.values()) client.close()
    this.clients.clear()
  }

  private ensureServer(): DaemonServer {
    if (this.server) return this.server
    this.server = new DaemonServer({
      host: this.opts.registry.local(),
      identity: this.identity,
      secret: () => this.opts.secret(),
      appVersion: this.opts.appVersion,
      home: homedir(),
      tmp: tmpdir()
    })
    return this.server
  }

  private startListen(): void {
    if (this.server && this.listenPort) return
    const server = this.ensureServer()
    void server
      .listen(DAEMON_DEFAULT_PORT)
      .catch(() => server.listen(0))
      .then((port) => {
        this.listenPort = port
        this.stopAnnounce?.()
        this.stopAnnounce = startAnnouncer({
          v: DAEMON_PROTO_VERSION,
          kind: 'vav-daemon',
          machineId: this.identity.machineId,
          name: this.identity.name,
          port,
          platform: process.platform
        })
      })
      .catch((err) => {
        console.error('[daemon] listen failed', err)
      })
  }

  private stopListen(): void {
    this.stopAnnounce?.()
    this.stopAnnounce = null
    this.server?.close()
    this.server = null
    this.listenPort = 0
  }

  private targetsOf(parsed: DaemonPairing): { host: string; port: number }[] {
    const port = parsed.port || DAEMON_DEFAULT_PORT
    const seen = new Set<string>()
    const out: { host: string; port: number }[] = []
    const add = (host?: string): void => {
      const h = host?.trim()
      if (!h) return
      const key = `${h}:${port}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ host: h, port })
    }
    for (const address of parsed.addresses ?? []) add(address)
    add(parsed.host)
    return out
  }

  private async dial(
    targets: { host: string; port: number }[],
    secret: string
  ): Promise<{ client: DaemonClient; welcome: import('../../shared/daemonProtocol.ts').DaemonWelcome }> {
    let last: Error = new Error('no addresses')
    for (const target of targets) {
      const client = new DaemonClient()
      try {
        const welcome = await client.connect({
          host: target.host,
          port: target.port,
          secret,
          device: this.identity.name
        })
        return { client, welcome }
      } catch (err) {
        client.close()
        last = err instanceof Error ? err : new Error(String(err))
      }
    }
    throw last
  }

  private mount(
    client: DaemonClient,
    welcome: import('../../shared/daemonProtocol.ts').DaemonWelcome
  ): void {
    const previous = this.clients.get(welcome.host.id)
    previous?.close()
    this.clients.set(welcome.host.id, client)
    this.homes.set(welcome.host.id, welcome.home)
    const host = createRemoteWorkspaceHost(client, welcome)
    this.opts.registry.register(host)
    this.opts.onHostsChanged(this.opts.registry.list())
  }

  private async reconnect(row: PairedHostRecord): Promise<void> {
    const targets = this.targetsOf({
      v: DAEMON_PROTO_VERSION,
      secret: row.secret,
      machineId: row.machineId,
      name: row.name,
      host: row.host,
      port: row.port,
      token: row.token,
      addresses: row.addresses
    })
    try {
      const { client, welcome } = await this.dial(targets, row.secret)
      this.mount(client, welcome)
    } catch {
      this.opts.registry.register(offlineWorkspaceHost(row.machineId, row.name))
      this.opts.onHostsChanged(this.opts.registry.list())
    }
  }

  private loadStore(): PairedHostRecord[] {
    try {
      if (!existsSync(this.storeFile)) return []
      const raw = JSON.parse(readFileSync(this.storeFile, 'utf8')) as { hosts?: unknown }
      if (!Array.isArray(raw.hosts)) return []
      return raw.hosts.filter((row): row is PairedHostRecord => {
        if (typeof row !== 'object' || row === null) return false
        const rec = row as PairedHostRecord
        return (
          typeof rec.machineId === 'string' &&
          typeof rec.secret === 'string' &&
          typeof rec.host === 'string' &&
          typeof rec.port === 'number'
        )
      })
    } catch {
      return []
    }
  }

  private remember(record: PairedHostRecord): void {
    const next = this.loadStore().filter((row) => row.machineId !== record.machineId)
    next.push(record)
    this.saveStore(next)
  }

  private saveStore(hosts: PairedHostRecord[]): void {
    mkdirSync(this.opts.userData, { recursive: true })
    writeFileSync(this.storeFile, JSON.stringify({ hosts }, null, 2))
  }
}
