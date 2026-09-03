export type AgentProbeSpec = { id: string; candidates: string[] }

/** Normalize renderer probe payloads into `{ id, candidates }` rows. */
export function parseAgentProbeSpecs(items: unknown): AgentProbeSpec[] {
  const list = Array.isArray(items) ? items : []
  const specs: AgentProbeSpec[] = []
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { id?: unknown; candidates?: unknown }
    const id = typeof rec.id === 'string' ? rec.id.trim() : ''
    if (!id) continue
    const candidates = Array.isArray(rec.candidates)
      ? rec.candidates.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : []
    specs.push({ id, candidates })
  }
  return specs
}

export function parseAgentBinaryCandidates(candidates: unknown): string[] {
  return Array.isArray(candidates)
    ? candidates.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : []
}
