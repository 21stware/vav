/**
 * Renderer-side memory of CLI binary probes.
 * Avoids flashing "checking…" when switching back to an agent we already resolved.
 */

type CacheEntry =
  | { status: 'ready'; path: string; at: number }
  | { status: 'missing'; at: number }

const READY_TTL_MS = 60 * 60_000
const MISSING_TTL_MS = 15_000

const byAgentId = new Map<string, CacheEntry>()

export function getAgentBinaryCache(agentId: string): CacheEntry | null {
  const hit = byAgentId.get(agentId)
  if (!hit) return null
  const ttl = hit.status === 'ready' ? READY_TTL_MS : MISSING_TTL_MS
  if (Date.now() - hit.at > ttl) {
    byAgentId.delete(agentId)
    return null
  }
  return hit
}

export function markAgentBinaryReady(agentId: string, path: string): void {
  byAgentId.set(agentId, { status: 'ready', path, at: Date.now() })
}

export function markAgentBinaryMissing(agentId: string): void {
  byAgentId.set(agentId, { status: 'missing', at: Date.now() })
}

export function clearAgentBinaryCache(agentId?: string): void {
  if (agentId) byAgentId.delete(agentId)
  else byAgentId.clear()
}
