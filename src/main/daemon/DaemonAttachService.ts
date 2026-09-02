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
  parseMachinePairing,
  type DaemonPairing
} from '../../shared/daemonProtocol.ts'
import {
  isLocalMachine,
  type WorkspaceHostInfo,
  type HostProviderInfo
} from '../../shared/workspaceHost.ts'
import type { HostRegistry } from '../host/WorkspaceHost.ts'
import { createOfflineRemoteHost } from '../host/WorkspaceHost.ts'
import { DaemonServer } from './DaemonServer.ts'
import { DaemonClient, createRemoteWorkspaceHost, requestLanPairOffer, PAIRING_CANCELLED } from './DaemonClient.ts'
import { loadOrCreateIdentity, type DaemonIdentity } from './identity.ts'
import {
  advertisedPairingAddresses,
  collectDialTargets,
  lanAddresses,
  mdnsName,
  startAnnouncer,
  startBrowser,
  visibleLanPeers,
  type DialTarget,
  type DiscoveredPeer
} from './lanAnnounce.ts'

import { agentBinaryCandidates } from '../../shared/agentBinary.ts'
import { CLI_AGENT_CATALOGUE } from '../../shared/types.ts'

export type PairedHostRecord = {
  machineId: string
  name: string
  secret: string
  host: string
  port: number
  token?: string
  addresses?: string[]
  home?: string
  tmp?: string
  defaultPath?: string
}

type TunnelHandle = {
  host: string
  port: number
  close: () => void
}

type AttachOpts = {
  userData: string
  registry: HostRegistry
  identityName?: string
  secret: () => string
  appVersion: string
  enabled: () => boolean
  tailcatToken: () => string | null
  /** Open the remote daemon over tailcat (same pipe as the phone QR). */
  dialTunnel?: (token: string) => Promise<TunnelHandle>
  onHostsChanged: (hosts: WorkspaceHostInfo[]) => void
  onDiscovered?: (peers: DiscoveredPeer[]) => void
  /** Desktop: confirm a LAN Pair from another VAV. vavd omits this. */
  confirmLanPair?: (from: { name: string; machineId: string }) => Promise<boolean>
}

export class DaemonAttachService {
  private server: DaemonServer | null = null
  private stopAnnounce: (() => void) | null = null
  private stopBrowse: (() => void) | null = null
  private readonly clients = new Map<string, DaemonClient>()
  private readonly homes = new Map<string, string>()
  private readonly tmps = new Map<string, string>()
  private readonly providers = new Map<string, HostProviderInfo[]>()
  /** candidate-list cache for PTY spawn (sync). */
  private readonly whichCache = new Map<string, Map<string, string | null>>()
  /** Live `--dial` sidecars, keyed by tailcat token. */
  private readonly tunnels = new Map<string, TunnelHandle>()
  private readonly tunnelOfHost = new Map<string, string>()
  private discovered: DiscoveredPeer[] = []
  readonly identity: DaemonIdentity
  private listenPort = 0
  private readonly opts: AttachOpts
  private pairAbort: AbortController | null = null

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
    const advertised = advertisedPairingAddresses({ identityName: this.identity.name })
    const payload: DaemonPairing = {
      v: DAEMON_PROTO_VERSION,
      secret: this.opts.secret(),
      machineId: this.identity.machineId,
      name: this.identity.name,
      host: advertised.host,
      port: this.listenPort || DAEMON_DEFAULT_PORT,
      token: this.opts.tailcatToken() ?? undefined,
      addresses: advertised.addresses
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
    if (isLocalMachine(machineId)) return homedir()
    return (
      this.homes.get(machineId) ||
      this.loadStore().find((row) => row.machineId === machineId)?.home ||
      ''
    )
  }

  tmpOf(machineId: string): string {
    if (isLocalMachine(machineId)) return tmpdir()
    return (
      this.tmps.get(machineId) ||
      this.loadStore().find((row) => row.machineId === machineId)?.tmp ||
      ''
    )
  }

  defaultPathOf(machineId: string): string | null {
    const path = this.loadStore().find((row) => row.machineId === machineId)?.defaultPath?.trim()
    return path || null
  }

  rememberDefaultPath(machineId: string, path: string): void {
    const normalized = path.trim()
    if (!normalized) return
    const row = this.loadStore().find((entry) => entry.machineId === machineId)
    if (!row) return
    this.remember({ ...row, defaultPath: normalized })
  }

  providersOf(machineId: string): HostProviderInfo[] {
    return this.providers.get(machineId) ?? []
  }

  whichCached(machineId: string, candidates: string[]): string | null {
    const key = candidates.map((c) => c.trim()).filter(Boolean).join('\0')
    if (!key) return null
    return this.whichCache.get(machineId)?.get(key) ?? null
  }

  async probeProviders(machineId: string): Promise<HostProviderInfo[]> {
    const client = this.clients.get(machineId)
    if (!client?.connected) return this.providers.get(machineId) ?? []
    const found: HostProviderInfo[] = []
    const cache = this.whichCache.get(machineId) ?? new Map<string, string | null>()
    for (const agent of CLI_AGENT_CATALOGUE) {
      const candidates = agentBinaryCandidates(agent, CLI_AGENT_CATALOGUE)
      const key = candidates.join('\0')
      let path: string | null = cache.get(key) ?? null
      if (path === null && !cache.has(key)) {
        try {
          path = await client.which(candidates)
        } catch {
          path = null
        }
        cache.set(key, path)
      }
      if (path) found.push({ id: agent.id, name: agent.name, path })
    }
    this.whichCache.set(machineId, cache)
    this.providers.set(machineId, found)
    return found
  }

  adoptAuthedSocket(socket: Socket, leftover = ''): void {
    this.ensureServer()
    this.server?.adopt(socket, leftover)
  }

  async pair(text: string, signal?: AbortSignal): Promise<{ ok: true; host: WorkspaceHostInfo } | { ok: false; error: string }> {
    const parsed = parseMachinePairing(text)
    if (!parsed) return { ok: false, error: 'unrecognized pairing payload' }
    const owned = signal ? null : this.replacePairAbort()
    const sig = signal ?? owned!.signal
    try {
      const { client, welcome, target } = await this.connectPairing(parsed, sig)
      if (sig.aborted) {
        client.close()
        return { ok: false, error: PAIRING_CANCELLED }
      }
      const viaTunnel = Boolean(parsed.token && this.tunnelOfHost.get(welcome.host.id))
      const persistHost = viaTunnel ? lanHostOf(parsed) : target.host
      this.remember({
        machineId: welcome.host.id,
        name: welcome.host.name || parsed.name,
        secret: parsed.secret,
        host: persistHost,
        port: viaTunnel ? (parsed.port && persistHost ? parsed.port : 0) : target.port,
        token: parsed.token,
        addresses: uniqueAddresses([
          ...(parsed.addresses ?? []),
          persistHost || undefined,
          viaTunnel ? undefined : target.host
        ]).filter((host) => !viaTunnel || !isLoopbackHost(host)),
        home: welcome.home,
        tmp: welcome.tmp
      })
      this.mount(client, welcome)
      return { ok: true, host: this.opts.registry.get(welcome.host.id)?.info ?? welcome.host }
    } catch (err) {
      if (isPairCancelled(err)) return { ok: false, error: PAIRING_CANCELLED }
      const message = err instanceof Error ? err.message : String(err)
      if (!parsed.token && /\b(EHOSTUNREACH|ENETUNREACH|EHOSTDOWN)\b/.test(message)) {
        return { ok: false, error: `no tunnel token: ${message}` }
      }
      return { ok: false, error: message }
    }
  }

  async pairLan(peer: {
    address: string
    port: number
    name?: string
    machineId?: string
  }): Promise<{ ok: true; host: WorkspaceHostInfo } | { ok: false; error: string }> {
    const abort = this.replacePairAbort()
    try {
      const pairing = await requestLanPairOffer({
        host: peer.address,
        port: peer.port,
        name: this.identity.name,
        machineId: this.identity.machineId,
        signal: abort.signal
      })
      return await this.pair(pairing, abort.signal)
    } catch (err) {
      if (isPairCancelled(err)) return { ok: false, error: PAIRING_CANCELLED }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  cancelPair(): void {
    this.pairAbort?.abort()
  }

  private replacePairAbort(): AbortController {
    this.pairAbort?.abort()
    this.pairAbort = new AbortController()
    return this.pairAbort
  }

  forget(machineId: string): void {
    this.clients.get(machineId)?.close()
    this.clients.delete(machineId)
    this.homes.delete(machineId)
    this.tmps.delete(machineId)
    this.providers.delete(machineId)
    this.whichCache.delete(machineId)
    this.releaseTunnel(machineId)
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
        this.discovered = visibleLanPeers(peers, {
          machineId: this.identity.machineId,
          localAddresses: lanAddresses(),
          mdns: mdnsName(undefined, this.identity.name)
        })
        this.opts.onDiscovered?.(this.discovered)
      })
    }
  }

  dispose(): void {
    this.cancelPair()
    this.stopListen()
    this.stopBrowse?.()
    this.stopBrowse = null
    for (const client of this.clients.values()) client.close()
    this.clients.clear()
    for (const tunnel of this.tunnels.values()) tunnel.close()
    this.tunnels.clear()
    this.tunnelOfHost.clear()
  }

  private ensureServer(): DaemonServer {
    if (this.server) return this.server
    this.server = new DaemonServer({
      host: this.opts.registry.local(),
      identity: this.identity,
      secret: () => this.opts.secret(),
      appVersion: this.opts.appVersion,
      home: homedir(),
      tmp: tmpdir(),
      pairing: () => this.pairing(),
      onPairAsk: this.opts.confirmLanPair
        ? (from) => this.opts.confirmLanPair!(from)
        : undefined
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

  private targetsOf(parsed: DaemonPairing): DialTarget[] {
    return collectDialTargets({
      host: parsed.host,
      port: parsed.port,
      addresses: parsed.addresses,
      name: parsed.name,
      machineId: parsed.machineId,
      discovered: this.discovered,
      localAddresses: lanAddresses()
    })
  }

  private async connectPairing(
    parsed: DaemonPairing,
    signal?: AbortSignal
  ): Promise<{
    client: DaemonClient
    welcome: import('../../shared/daemonProtocol.ts').DaemonWelcome
    target: DialTarget
  }> {
    if (signal?.aborted) throw new Error(PAIRING_CANCELLED)
    const failures: Error[] = []
    if (parsed.token && this.opts.dialTunnel) {
      try {
        const tun = await this.ensureTunnel(parsed.token)
        if (signal?.aborted) throw new Error(PAIRING_CANCELLED)
        const result = await this.dial([tun], parsed.secret, 45_000, signal)
        this.tunnelOfHost.set(result.welcome.host.id, parsed.token)
        return result
      } catch (err) {
        if (isPairCancelled(err)) throw err instanceof Error ? err : new Error(PAIRING_CANCELLED)
        failures.push(err instanceof Error ? err : new Error(String(err)))
        this.dropTunnel(parsed.token)
      }
    }
    const targets = this.targetsOf(parsed)
    if (targets.length === 0) throw preferPairError(failures)
    try {
      return await this.dial(targets, parsed.secret, undefined, signal)
    } catch (err) {
      if (isPairCancelled(err)) throw err instanceof Error ? err : new Error(PAIRING_CANCELLED)
      failures.push(err instanceof Error ? err : new Error(String(err)))
      throw preferPairError(failures)
    }
  }

  private async ensureTunnel(token: string): Promise<DialTarget> {
    const existing = this.tunnels.get(token)
    if (existing) return { host: existing.host, port: existing.port }
    const handle = await this.opts.dialTunnel!(token)
    this.tunnels.set(token, handle)
    return { host: handle.host, port: handle.port }
  }

  private dropTunnel(token: string): void {
    const handle = this.tunnels.get(token)
    if (!handle) return
    handle.close()
    this.tunnels.delete(token)
    for (const [machineId, owned] of this.tunnelOfHost) {
      if (owned === token) this.tunnelOfHost.delete(machineId)
    }
  }

  private releaseTunnel(machineId: string): void {
    const token = this.tunnelOfHost.get(machineId)
    this.tunnelOfHost.delete(machineId)
    if (!token) return
    if ([...this.tunnelOfHost.values()].includes(token)) return
    this.dropTunnel(token)
  }

  private async dial(
    targets: DialTarget[],
    secret: string,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<{
    client: DaemonClient
    welcome: import('../../shared/daemonProtocol.ts').DaemonWelcome
    target: DialTarget
  }> {
    const failures: Error[] = []
    for (const target of targets) {
      if (signal?.aborted) throw new Error(PAIRING_CANCELLED)
      const client = new DaemonClient()
      try {
        const welcome = await client.connect({
          host: target.host,
          port: target.port,
          secret,
          device: this.identity.name,
          timeoutMs,
          signal
        })
        return { client, welcome, target }
      } catch (err) {
        client.close()
        if (isPairCancelled(err)) throw err instanceof Error ? err : new Error(PAIRING_CANCELLED)
        failures.push(err instanceof Error ? err : new Error(String(err)))
      }
    }
    throw preferPairError(failures)
  }

  private mount(
    client: DaemonClient,
    welcome: import('../../shared/daemonProtocol.ts').DaemonWelcome
  ): void {
    const previous = this.clients.get(welcome.host.id)
    previous?.close()
    this.clients.set(welcome.host.id, client)
    this.homes.set(welcome.host.id, welcome.home)
    this.tmps.set(welcome.host.id, welcome.tmp)
    const host = createRemoteWorkspaceHost(client, welcome)
    this.opts.registry.register(host)
    this.opts.onHostsChanged(this.opts.registry.list())
    void this.probeProviders(welcome.host.id).then(() => {
      this.opts.onHostsChanged(this.opts.registry.list())
    })
  }

  private async reconnect(row: PairedHostRecord): Promise<void> {
    try {
      const { client, welcome, target } = await this.connectPairing({
        v: DAEMON_PROTO_VERSION,
        secret: row.secret,
        machineId: row.machineId,
        name: row.name,
        host: row.host,
        port: row.port,
        token: row.token,
        addresses: row.addresses
      })
      this.mount(client, welcome)
      this.remember({
        ...row,
        host: row.token ? row.host : target.host,
        port: row.token ? row.port : target.port,
        home: welcome.home,
        tmp: welcome.tmp,
        name: welcome.host.name || row.name
      })
    } catch {
      if (row.home) this.homes.set(row.machineId, row.home)
      if (row.tmp) this.tmps.set(row.machineId, row.tmp)
      this.opts.registry.register(
        createOfflineRemoteHost(row.machineId, row.name, {
          home: row.home,
          tmp: row.tmp
        })
      )
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

function isPairCancelled(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message === PAIRING_CANCELLED || /pairing cancelled/i.test(message)
}

function uniqueAddresses(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const host = value?.trim()
    if (!host || seen.has(host)) continue
    seen.add(host)
    out.push(host)
  }
  return out
}

function isLoopbackHost(host?: string): boolean {
  const value = host?.trim().toLowerCase() ?? ''
  return value === '127.0.0.1' || value === '::1' || value === 'localhost'
}

/** LAN address from the pairing line — never the local `--dial` sidecar. */
function lanHostOf(parsed: DaemonPairing): string {
  if (parsed.host && !isLoopbackHost(parsed.host)) return parsed.host
  for (const address of parsed.addresses ?? []) {
    if (address && !isLoopbackHost(address)) return address
  }
  return ''
}

function isTunnelError(err: Error): boolean {
  return /tailcat|invalid tailcat|dial exited|context deadline/i.test(err.message)
}

function pairErrorRank(err: Error): number {
  const code = (err as NodeJS.ErrnoException).code ?? ''
  const message = err.message
  const blob = `${code} ${message}`
  if (/pairing rejected|auth/i.test(message)) return 0
  if (isTunnelError(err)) return 1
  if (/\b(EHOSTUNREACH|ENETUNREACH|EHOSTDOWN)\b/.test(blob)) return 2
  if (/\bETIMEDOUT\b/.test(blob) || /connect timeout/i.test(message)) return 3
  if (/\bECONNREFUSED\b/.test(blob) && /127\.0\.0\.1|::1|localhost/.test(blob)) return 9
  if (/\bECONNREFUSED\b/.test(blob)) return 4
  return 5
}

function preferPairError(failures: Error[]): Error {
  if (failures.length === 0) return new Error('no addresses')
  return [...failures].sort((a, b) => pairErrorRank(a) - pairErrorRank(b))[0]
}
