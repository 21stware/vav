import type { CliHostKind } from '@shared/cliHost'
import type { QuotaWindow } from '@shared/types'
import { fetchClaudeAccountQuota } from './claudeUsage'
import { fetchCodexAccountQuota } from './codexUsage'
import { fetchGrokAccountQuota } from './grokUsage'

export type QuotaAccountHost = 'claude' | 'codex' | 'grok'

const POLL_MS = 15 * 60_000
const PANEL_REFETCH_MS = 5 * 60_000

const FETCHERS: Record<QuotaAccountHost, () => Promise<QuotaWindow[]>> = {
  claude: fetchClaudeAccountQuota,
  codex: fetchCodexAccountQuota,
  grok: fetchGrokAccountQuota
}

function isQuotaAccountHost(host: CliHostKind | null | undefined): host is QuotaAccountHost {
  return host === 'claude' || host === 'codex' || host === 'grok'
}

export class QuotaService {
  private readonly cache = new Map<QuotaAccountHost, QuotaWindow[]>()
  private readonly lastFetchAt = new Map<QuotaAccountHost, number>()
  private readonly inFlight = new Map<QuotaAccountHost, Promise<void>>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly onUpdate: () => void

  constructor(options?: { onUpdate?: () => void }) {
    this.onUpdate = options?.onUpdate ?? (() => undefined)
  }

  get(host: CliHostKind | null | undefined): QuotaWindow[] {
    if (!isQuotaAccountHost(host)) return []
    return this.cache.get(host) ?? []
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

  private async refreshAll(): Promise<void> {
    await Promise.all((Object.keys(FETCHERS) as QuotaAccountHost[]).map((host) => this.refresh(host, true)))
  }

  private async refresh(host: QuotaAccountHost, force: boolean): Promise<void> {
    const pending = this.inFlight.get(host)
    if (pending) return pending
    const last = this.lastFetchAt.get(host) ?? 0
    const staleMs = this.get(host).length === 0 ? 30_000 : PANEL_REFETCH_MS
    if (!force && Date.now() - last < staleMs) return
    const run = this.fetchHost(host).finally(() => {
      this.inFlight.delete(host)
    })
    this.inFlight.set(host, run)
    await run
  }

  private async fetchHost(host: QuotaAccountHost): Promise<void> {
    try {
      const windows = await FETCHERS[host]()
      this.lastFetchAt.set(host, Date.now())
      if (windows.length === 0) return
      this.cache.set(host, windows)
      this.onUpdate()
    } catch {
      // Keep the last good snapshot — usage is informational.
    }
  }
}
