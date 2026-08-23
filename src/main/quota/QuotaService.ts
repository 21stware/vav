import type { CliHostKind } from '../../shared/cliHost.ts'
import { withTimeout } from '../../shared/asyncTimeout.ts'
import {
  attachQuotaNamespace,
  hostMayHaveAccountQuota,
  quotaIdentityOf,
  quotaNamespace,
  type AccountQuotaHost
} from '../../shared/quotaWindows.ts'
import type { QuotaWindow } from '../../shared/types.ts'

export type QuotaAccountHost = AccountQuotaHost
export type QuotaSyncStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type QuotaFetchContext = { token?: string }
export type QuotaFetcher = (ctx?: QuotaFetchContext) => Promise<QuotaWindow[]>
export type QuotaIdentityRef = { identity: string; token?: string }

export interface QuotaHostState {
  windows: QuotaWindow[]
  status: QuotaSyncStatus
  updatedAt: number | null
  error: string | null
}

const POLL_MS = 15 * 60_000
const PANEL_REFETCH_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 12_000

function isQuotaAccountHost(host: string | null | undefined): host is QuotaAccountHost {
  return hostMayHaveAccountQuota(host)
}

const EMPTY_STATE: QuotaHostState = {
  windows: [],
  status: 'idle',
  updatedAt: null,
  error: null
}

export class QuotaService {
  /** Keyed by `host:identity` — never a bare host. */
  private readonly cache = new Map<string, QuotaWindow[]>()
  private readonly lastFetchAt = new Map<string, number>()
  private readonly meta = new Map<string, Omit<QuotaHostState, 'windows'>>()
  private readonly inFlight = new Map<QuotaAccountHost, Promise<void>>()
  private readonly liveIdentity = new Map<QuotaAccountHost, string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly onUpdate: () => void
  private readonly identityOf: (host: QuotaAccountHost) => Promise<string | null>
  private readonly identitiesOf: (host: QuotaAccountHost) => Promise<QuotaIdentityRef[]>
  private readonly fetchers: Partial<Record<QuotaAccountHost, QuotaFetcher>>

  constructor(options?: {
    onUpdate?: () => void
    identityOf?: (host: QuotaAccountHost) => Promise<string | null>
    identitiesOf?: (host: QuotaAccountHost) => Promise<QuotaIdentityRef[]>
    fetchers?: Partial<Record<QuotaAccountHost, QuotaFetcher>>
  }) {
    this.onUpdate = options?.onUpdate ?? (() => undefined)
    this.identityOf = options?.identityOf ?? (async () => null)
    this.identitiesOf = options?.identitiesOf ?? (async () => [])
    this.fetchers = { ...options?.fetchers }
  }

  identity(host: CliHostKind | null | undefined): string | null {
    if (!isQuotaAccountHost(host)) return null
    return this.liveIdentity.get(host) ?? null
  }

  get(host: CliHostKind | null | undefined, identity?: string | null): QuotaWindow[] {
    if (!isQuotaAccountHost(host)) return []
    const id = identity !== undefined ? quotaIdentityOf(identity) : (this.liveIdentity.get(host) ?? '')
    if (!id) return []
    return this.cache.get(quotaNamespace(host, id)) ?? []
  }

  getState(
    host: CliHostKind | null | undefined,
    identity?: string | null
  ): QuotaHostState {
    if (!isQuotaAccountHost(host)) return EMPTY_STATE
    const id = identity !== undefined ? quotaIdentityOf(identity) : (this.liveIdentity.get(host) ?? '')
    if (!id) return EMPTY_STATE
    const ns = quotaNamespace(host, id)
    const windows = this.cache.get(ns) ?? []
    const meta = this.meta.get(ns)
    return {
      windows,
      status: meta?.status ?? (windows.length > 0 ? 'ready' : 'idle'),
      updatedAt: meta?.updatedAt ?? this.lastFetchAt.get(ns) ?? null,
      error: meta?.error ?? null
    }
  }

  start(): void {
    this.stop()
    void this.refreshAll()
    this.timer = setInterval(() => {
      void this.refreshAll()
    }, POLL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async refreshForPanel(host: CliHostKind | null | undefined): Promise<void> {
    if (!isQuotaAccountHost(host)) return
    await this.refresh(host, false)
  }

  /** Bypass the panel debounce — used when a turn fails and we need a fresh read. */
  async forceRefresh(host: CliHostKind | null | undefined): Promise<QuotaWindow[]> {
    if (!isQuotaAccountHost(host)) return []
    await this.refresh(host, true)
    return this.get(host)
  }

  /** Refresh every host that exposes an account usage API. */
  async refreshAllHosts(force = false): Promise<void> {
    await Promise.all(
      (Object.keys(this.fetchers) as QuotaAccountHost[]).map((host) => this.refresh(host, force))
    )
  }

  async refreshHosts(hosts: Iterable<CliHostKind | string>, force = false): Promise<void> {
    const unique = [...new Set([...hosts])].filter(isQuotaAccountHost)
    await Promise.all(unique.map((host) => this.refresh(host, force)))
  }

  private async refreshAll(): Promise<void> {
    await Promise.all(
      (Object.keys(this.fetchers) as QuotaAccountHost[]).map((host) => this.refresh(host, true))
    )
  }

  private async refresh(host: QuotaAccountHost, force: boolean): Promise<void> {
    if (!this.fetchers[host]) return
    const pending = this.inFlight.get(host)
    if (pending) return pending
    const liveId = this.liveIdentity.get(host) ?? ''
    const last = liveId ? (this.lastFetchAt.get(quotaNamespace(host, liveId)) ?? 0) : 0
    const staleMs = this.get(host).length === 0 ? 30_000 : PANEL_REFETCH_MS
    if (!force && Date.now() - last < staleMs) return
    const run = this.fetchHost(host).finally(() => {
      this.inFlight.delete(host)
    })
    this.inFlight.set(host, run)
    await run
  }

  private async fetchHost(host: QuotaAccountHost): Promise<void> {
    const liveId = quotaIdentityOf(await this.identityOf(host))
    if (liveId) this.liveIdentity.set(host, liveId)
    else this.liveIdentity.delete(host)

    const seen = new Set<string>()
    const jobs: Array<{ identity: string; token?: string }> = []
    if (liveId) {
      jobs.push({ identity: liveId })
      seen.add(liveId)
    }
    for (const row of await this.identitiesOf(host)) {
      const identity = quotaIdentityOf(row.identity)
      const token = row.token?.trim()
      if (!identity || seen.has(identity) || !token) continue
      jobs.push({ identity, token })
      seen.add(identity)
    }
    if (jobs.length === 0) {
      this.onUpdate()
      return
    }
    await Promise.all(jobs.map((job) => this.fetchHostIdentity(host, job)))
  }

  private async fetchHostIdentity(
    host: QuotaAccountHost,
    job: { identity: string; token?: string }
  ): Promise<void> {
    const fetch = this.fetchers[host]
    if (!fetch) return
    const ns = quotaNamespace(host, job.identity)
    const previous = this.meta.get(ns)
    this.meta.set(ns, {
      status: 'loading',
      updatedAt: previous?.updatedAt ?? this.lastFetchAt.get(ns) ?? null,
      error: null
    })
    try {
      const windows = attachQuotaNamespace(
        await withTimeout(
          fetch(job.token ? { token: job.token } : undefined),
          FETCH_TIMEOUT_MS,
          `${host} quota timeout`
        ),
        host,
        job.identity
      )
      const now = Date.now()
      this.lastFetchAt.set(ns, now)
      this.cache.set(ns, windows)
      this.meta.set(ns, {
        status: windows.length > 0 ? 'ready' : 'empty',
        updatedAt: now,
        error: null
      })
      this.onUpdate()
    } catch (err) {
      const now = Date.now()
      this.lastFetchAt.set(ns, now)
      this.meta.set(ns, {
        status: 'error',
        updatedAt: previous?.updatedAt ?? null,
        error: err instanceof Error ? err.message : String(err)
      })
      this.onUpdate()
    }
  }
}
