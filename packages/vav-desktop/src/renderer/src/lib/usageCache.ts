import { useSyncExternalStore } from 'react'
import type { HostAuthKind } from '@shared/cliAccountParse'
import type { HostAccountQuota } from '@shared/ipc'
import type { CliHostKind, QuotaWindow } from '@shared/types'

export interface UsageQuotaSnap {
  authKind: HostAuthKind
  accountId: string | null
  windows: QuotaWindow[]
}

export interface UsageCacheEntry {
  snap: UsageQuotaSnap | null
  /** First load — no cached snap yet. */
  syncing: boolean
  /** Background or forced refresh while a snap is on screen. */
  updating: boolean
}

type UsageReader = (
  conversationId: string,
  host: CliHostKind | null
) => Promise<HostAccountQuota | null>

const EMPTY: UsageCacheEntry = { snap: null, syncing: false, updating: false }

const entries = new Map<string, UsageCacheEntry>()
const inflight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let reader: UsageReader | null = null

export function usageCacheKey(host: string, accountId?: string | null): string {
  return `${host}:${accountId?.trim() || ''}`
}

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getEntry(key: string): UsageCacheEntry {
  return entries.get(key) ?? EMPTY
}

function writeEntry(key: string, patch: Partial<UsageCacheEntry>): void {
  const prev = entries.get(key) ?? { snap: null, syncing: false, updating: false }
  entries.set(key, { ...prev, ...patch })
  emit()
}

function snapFromQuota(next: HostAccountQuota): UsageQuotaSnap {
  const kind = next.authKind
  return {
    authKind: kind && kind !== 'unknown' ? kind : next.signedIn ? 'oauth' : 'unknown',
    accountId: next.accountId?.trim() || null,
    windows: next.windows ?? []
  }
}

async function readQuota(
  conversationId: string,
  host: CliHostKind | null
): Promise<HostAccountQuota | null> {
  if (reader) return reader(conversationId, host)
  return window.vav.conversations.accountQuota(conversationId, host)
}

export function peekUsageCache(host: string, accountId?: string | null): UsageQuotaSnap | null {
  return getEntry(usageCacheKey(host, accountId)).snap
}

export function applyUsageQuota(
  host: string,
  accountId: string | null | undefined,
  quota: HostAccountQuota
): void {
  writeEntry(usageCacheKey(host, accountId), {
    snap: snapFromQuota(quota),
    syncing: false,
    updating: false
  })
}

export function refreshUsage(options: {
  conversationId: string
  host: CliHostKind
  accountId?: string | null
  force?: boolean
}): Promise<void> {
  const key = usageCacheKey(options.host, options.accountId)
  const pending = inflight.get(key)
  if (pending && !options.force) return pending
  const had = Boolean(getEntry(key).snap)
  const run = (async () => {
    let delayed: ReturnType<typeof setTimeout> | null = null
    if (had) {
      // Cache-hit IPC is usually instant — don't flash shimmer for one frame.
      delayed = setTimeout(() => writeEntry(key, { updating: true }), 160)
    } else {
      writeEntry(key, { syncing: true })
    }
    try {
      const next = await readQuota(options.conversationId, options.host)
      if (next) {
        writeEntry(key, { snap: snapFromQuota(next), syncing: false, updating: false })
        return
      }
      if (!had) writeEntry(key, { snap: { authKind: 'unknown', accountId: null, windows: [] } })
    } catch {
      // Keep the last snap — a failed refresh must not blank the UI.
    } finally {
      if (delayed) clearTimeout(delayed)
      writeEntry(key, { syncing: false, updating: false })
      inflight.delete(key)
    }
  })()
  inflight.set(key, run)
  return run
}

export function useUsageCache(
  host: string | null | undefined,
  accountId?: string | null
): UsageCacheEntry {
  const key = host ? usageCacheKey(host, accountId) : ''
  return useSyncExternalStore(subscribe, () => (key ? getEntry(key) : EMPTY))
}

/** Tests only. */
export function setUsageQuotaReader(fn: UsageReader | null): void {
  reader = fn
}

/** Tests only. */
export function resetUsageCacheForTests(): void {
  entries.clear()
  inflight.clear()
  reader = null
}
