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
import { DaemonServer, type DaemonWorkspaceCatalog } from './DaemonServer.ts'
import { DaemonClient, createRemoteWorkspaceHost, requestLanPairOffer, PAIRING_CANCELLED } from './DaemonClient.ts'
import { RemoteControlDial } from '../remote/RemoteControlDial.ts'
import type { RemoteHello, RemoteServerMessage } from '../../shared/remoteControl.ts'
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

/** Hello into a local `--dial` port. The listen staying up does not mean the pipe is live. */
const TUNNEL_HELLO_MS = 5_000

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
  /** This computer's sessions + folder recents, served to a paired client. */
  catalog?: DaemonWorkspaceCatalog
  /**
   * After a live daemon session is mounted (pair or reconnect). Pull the
   * host catalog here before the remote window bootstraps.
   */
  onHostAttached?: (machineId: string) => void | Promise<void>
  /** Phone-role hello on this machine's listen port → session hub. */
  onControlHello?: (socket: Socket, leftover: string, hello: RemoteHello) => void
  /** Frames from a control-plane dial we opened to a paired desktop. */
  onControlEvent?: (machineId: string, message: RemoteServerMessage) => void
}

export class DaemonAttachService {
  private server: DaemonServer | null = null
  private stopAnnounce: (() => void) | null = null
  private stopBrowse: (() => void) | null = null
  private readonly clients = new Map<string, DaemonClient>()
  private readonly control = new Map<string, RemoteControlDial>()
  /** Per-host probe: true after welcome, false after headless refuse / timeout. */
  private readonly controlProbes = new Map<string, Promise<boolean>>()
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

  /**
   * Import the other computer's sidebar sessions and folder recents.
   * Missing RPCs (headless / older vavd) resolve to empty lists.
   */
  async pullHostCatalog(machineId: string): Promise<{ sessions: unknown[]; recents: string[] }> {
    const client = this.clients.get(machineId)
    if (!client?.connected) return { sessions: [], recents: [] }
    let metas: Array<{ id?: unknown }> = []
    try {
      const listed = (await client.request('sessions.list')) as { sessions?: unknown }
      if (Array.isArray(listed?.sessions)) metas = listed.sessions as Array<{ id?: unknown }>
    } catch {
      return { sessions: [], recents: [] }
    }
    const sessions: unknown[] = []
    for (const meta of metas.slice(0, 100)) {
      const id = typeof meta?.id === 'string' ? meta.id.trim() : ''
      if (!id) continue
      try {
        const got = (await client.request('sessions.get', { id }, 60_000)) as {
          conversation?: unknown
        }
        if (got?.conversation && typeof got.conversation === 'object') {
          sessions.push(got.conversation)
        }
      } catch {
        // skip one oversized / broken session
      }
    }
    let recents: string[] = []
    try {
      const listed = (await client.request('workspace.recents')) as { paths?: unknown }
      if (Array.isArray(listed?.paths)) {
        recents = listed.paths.filter(
          (path): path is string => typeof path === 'string' && path.trim().length > 0
        )
      }
    } catch {
      // older host
    }
    return { sessions, recents }
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
      this.mount(client, welcome, target, parsed.secret)
      await this.pendingControl
      await this.notifyHostAttached(welcome.host.id)
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

  controlOf(machineId: string): RemoteControlDial | undefined {
    const dial = this.control.get(machineId)
    return dial?.ready ? dial : undefined
  }

  controlPlaneOf(machineId: string): boolean {
    return this.control.get(machineId)?.ready === true
  }

  /** Wait until the phone-role probe for this host finishes (desktop or vavd). */
  async waitForControlPlane(machineId: string): Promise<boolean> {
    const probe = this.controlProbes.get(machineId)
    if (probe) return probe
    return this.control.get(machineId)?.ready === true
  }

  forget(machineId: string): void {
    this.dropControl(machineId)
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
    for (const dial of this.control.values()) dial.close()
    this.control.clear()
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
        : undefined,
      catalog: this.opts.catalog,
      onControlHello: this.opts.onControlHello
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
    const lanTargets = this.targetsOf(parsed)
    const canTunnel = Boolean(parsed.token && this.opts.dialTunnel)

    const runLan = (sig: AbortSignal) => {
      if (lanTargets.length === 0) return Promise.reject(new Error('no addresses'))
      return this.dial(lanTargets, parsed.secret, undefined, sig)
    }
    const runTunnel = async (sig: AbortSignal) => {
      const token = parsed.token!
      try {
        const tun = await this.ensureTunnel(token, sig)
        if (sig.aborted) throw new Error(PAIRING_CANCELLED)
        const result = await this.dial([tun], parsed.secret, TUNNEL_HELLO_MS, sig)
        this.tunnelOfHost.set(result.welcome.host.id, token)
        return result
      } catch (err) {
        this.dropTunnel(token)
        throw err
      }
    }

    try {
      if (canTunnel && lanTargets.length > 0) {
        return await this.raceTunnelAndLan(runTunnel, runLan, parsed.token!, signal)
      }
      if (canTunnel) {
        return await runTunnel(signal ?? new AbortController().signal)
      }
      if (lanTargets.length === 0) throw preferPairError(failures)
      return await runLan(signal ?? new AbortController().signal)
    } catch (err) {
      if (isPairCancelled(err)) throw err instanceof Error ? err : new Error(PAIRING_CANCELLED)
      const message = err instanceof Error ? err : new Error(String(err))
      failures.push(message)
      throw preferPairError(failures)
    }
  }

  /**
   * LAN and tailcat at once. A listening `--dial` port is not a live tunnel —
   * hello into a dead proxy used to block LAN for 45s. First welcome wins.
   */
  private async raceTunnelAndLan(
    runTunnel: (signal: AbortSignal) => ReturnType<DaemonAttachService['dial']>,
    runLan: (signal: AbortSignal) => ReturnType<DaemonAttachService['dial']>,
    token: string,
    signal?: AbortSignal
  ): Promise<Awaited<ReturnType<DaemonAttachService['dial']>>> {
    const tunAbort = new AbortController()
    const lanAbort = new AbortController()
    const onParent = (): void => {
      tunAbort.abort()
      lanAbort.abort()
    }
    signal?.addEventListener('abort', onParent, { once: true })
    type Outcome =
      | { ok: true; via: 'tun' | 'lan'; r: Awaited<ReturnType<DaemonAttachService['dial']>> }
      | { ok: false; via: 'tun' | 'lan'; e: unknown }
    const wrap = (
      via: 'tun' | 'lan',
      run: (sig: AbortSignal) => ReturnType<DaemonAttachService['dial']>,
      sig: AbortSignal
    ): Promise<Outcome> =>
      run(sig).then(
        (r) => ({ ok: true, via, r }),
        (e: unknown) => ({ ok: false, via, e })
      )
    try {
      const tunP = wrap('tun', runTunnel, tunAbort.signal)
      const lanP = wrap('lan', runLan, lanAbort.signal)
      const first = await Promise.race([tunP, lanP])
      if (first.ok) {
        if (first.via === 'tun') lanAbort.abort()
        else {
          tunAbort.abort()
          this.dropTunnel(token)
        }
        const loser = first.via === 'tun' ? lanP : tunP
        void loser.then((outcome) => {
          if (outcome.ok) outcome.r.client.close()
        })
        return first.r
      }
      const second = first.via === 'tun' ? await lanP : await tunP
      if (second.ok) {
        if (second.via !== 'tun') this.dropTunnel(token)
        return second.r
      }
      const errors = [first.e, second.e].map((err) =>
        err instanceof Error ? err : new Error(String(err))
      )
      throw preferPairError(errors)
    } finally {
      signal?.removeEventListener('abort', onParent)
    }
  }

  private async ensureTunnel(token: string, signal?: AbortSignal): Promise<DialTarget> {
    const existing = this.tunnels.get(token)
    if (existing) return { host: existing.host, port: existing.port }
    const handle = await this.opts.dialTunnel!(token)
    if (signal?.aborted) {
      handle.close()
      throw new Error(PAIRING_CANCELLED)
    }
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
    welcome: import('../../shared/daemonProtocol.ts').DaemonWelcome,
    target?: DialTarget,
    hostSecret?: string
  ): void {
    const previous = this.clients.get(welcome.host.id)
    previous?.close()
    this.dropControl(welcome.host.id)
    this.clients.set(welcome.host.id, client)
    this.homes.set(welcome.host.id, welcome.home)
    this.tmps.set(welcome.host.id, welcome.tmp)
    const host = createRemoteWorkspaceHost(client, welcome)
    this.opts.registry.register(host)
    this.opts.onHostsChanged(this.opts.registry.list())
    void this.probeProviders(welcome.host.id).then(() => {
      this.opts.onHostsChanged(this.opts.registry.list())
    })
    this.pendingControl =
      target && hostSecret
        ? this.attachControlPlane(welcome.host.id, target, hostSecret).catch(() => undefined)
        : Promise.resolve()
  }

  private pendingControl: Promise<void> = Promise.resolve()

  async waitForControlPlane(): Promise<void> {
    await this.pendingControl
  }

  private dropControl(machineId: string): void {
    this.control.get(machineId)?.close()
    this.control.delete(machineId)
    this.controlProbes.delete(machineId)
  }

  /**
   * Second connection, `hello.role=phone`, same secret as the daemon.
   * Desktop hosts welcome; headless vavd refuses — client keeps local agent.
   */
  private async attachControlPlane(
    machineId: string,
    target: DialTarget,
    secret: string
  ): Promise<void> {
    const probe = this.probeControlPlane(machineId, target, secret)
    this.controlProbes.set(machineId, probe)
    await probe
  }

  private async probeControlPlane(
    machineId: string,
    target: DialTarget,
    secret: string
  ): Promise<boolean> {
    const dial = new RemoteControlDial()
    try {
      await dial.connect({
        host: target.host,
        port: target.port,
        secret,
        device: this.identity.name
      })
      this.control.set(machineId, dial)
      dial.onFrame((_state, message) => this.opts.onControlEvent?.(machineId, message))
      this.opts.onHostsChanged(this.opts.registry.list())
      return true
    } catch {
      dial.close()
      return false
    }
  }

  private async notifyHostAttached(machineId: string): Promise<void> {
    if (!this.opts.onHostAttached) return
    try {
      await this.opts.onHostAttached(machineId)
    } catch (err) {
      console.error('[daemon] host catalog pull failed', err)
    }
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
      this.mount(client, welcome, target, row.secret)
      await this.pendingControl
      await this.notifyHostAttached(welcome.host.id)
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
