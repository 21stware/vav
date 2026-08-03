/**
 * Renderer-side memory of CLI binary probes + localStorage so next launch can
 * paint the agent terminal optimistically without an install-gate flash.
 */

type CacheEntry =
  | { status: 'ready'; path: string; at: number }
  | { status: 'missing'; at: number }

const READY_TTL_MS = 7 * 24 * 60 * 60_000 // 7d — re-validate by spawn, not PATH probe
const MISSING_TTL_MS = 30_000 // short: failed once, still allow optimistic retry soon
const STORAGE_KEY = 'vav.agentBinaryCache.v1'

const byAgentId = new Map<string, CacheEntry>()

function loadFromStorage(): void {
  if (byAgentId.size > 0) return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry || (entry.status !== 'ready' && entry.status !== 'missing')) continue
      if (typeof entry.at !== 'number') continue
      byAgentId.set(id, entry)
    }
  } catch {
    // ignore corrupt cache
  }
}

function persist(): void {
  try {
    const obj: Record<string, CacheEntry> = {}
    for (const [id, entry] of byAgentId) {
      // Only persist ready — missing should not sticky-block across restarts.
      if (entry.status === 'ready') obj[id] = entry
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // quota / private mode
  }
}

export function getAgentBinaryCache(agentId: string): CacheEntry | null {
  loadFromStorage()
  const hit = byAgentId.get(agentId)
  if (!hit) return null
  const ttl = hit.status === 'ready' ? READY_TTL_MS : MISSING_TTL_MS
  if (Date.now() - hit.at > ttl) {
    byAgentId.delete(agentId)
    if (hit.status === 'ready') persist()
    return null
  }
  return hit
}

export function markAgentBinaryReady(agentId: string, path: string): void {
  loadFromStorage()
  byAgentId.set(agentId, { status: 'ready', path, at: Date.now() })
  persist()
}

export function markAgentBinaryMissing(agentId: string): void {
  loadFromStorage()
  byAgentId.set(agentId, { status: 'missing', at: Date.now() })
  // Do not persist missing — next launch optimistically tries spawn again.
}

export function clearAgentBinaryCache(agentId?: string): void {
  loadFromStorage()
  if (agentId) byAgentId.delete(agentId)
  else byAgentId.clear()
  persist()
}
