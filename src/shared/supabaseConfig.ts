/**
 * Parse local Supabase project files (no filesystem). Used by the main
 * status service and unit tests.
 */

const ENV_REF_KEYS =
  /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_)?SUPABASE_(?:URL|PROJECT_(?:ID|REF)|REF)\s*=\s*(.*)$/i

const PROJECT_ID_LINE = /^\s*project_id\s*=\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9._-]+))\s*$/m

const FUNCTION_SECTION = /^\s*\[functions\.([A-Za-z0-9_-]+)\]\s*$/gm

const SUPABASE_HOST_REF =
  /https?:\/\/([a-z0-9]{15,40})\.supabase\.(?:co|in)(?:\/|$)/i

const BARE_REF = /^[a-z0-9]{15,40}$/i

export function isSupabaseConfigName(name: string): boolean {
  return /^config\.toml$/i.test(name)
}

export function isSupabaseEnvName(name: string): boolean {
  return /^\.env(?:\..+)?$/i.test(name) && !name.endsWith('.example')
}

export function extractSupabaseRefFromUrl(value: string): string | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed) return null
  const hosted = trimmed.match(SUPABASE_HOST_REF)
  if (hosted?.[1]) return hosted[1].toLowerCase()
  if (BARE_REF.test(trimmed)) return trimmed.toLowerCase()
  return null
}

export function parseSupabaseProjectId(source: string): string | null {
  const match = source.match(PROJECT_ID_LINE)
  const value = match?.[1] ?? match?.[2] ?? match?.[3]
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

export function parseSupabaseFunctionMeta(
  source: string
): Record<string, { verifyJwt: boolean | null }> {
  const out: Record<string, { verifyJwt: boolean | null }> = {}
  const matches = [...source.matchAll(FUNCTION_SECTION)]
  for (let i = 0; i < matches.length; i++) {
    const slug = matches[i]?.[1]
    if (!slug) continue
    const start = (matches[i]!.index ?? 0) + matches[i]![0].length
    const end = matches[i + 1]?.index ?? source.length
    const body = source.slice(start, end)
    const jwt = body.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/im)
    out[slug] = {
      verifyJwt: jwt ? jwt[1]!.toLowerCase() === 'true' : null
    }
  }
  return out
}

/** Collect project refs from dotenv-style text. First match wins for callers. */
export function parseSupabaseEnvRefs(source: string): string[] {
  const refs: string[] = []
  const seen = new Set<string>()
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(ENV_REF_KEYS)
    if (!match) continue
    const ref = extractSupabaseRefFromUrl(stripEnvValue(match[1] ?? ''))
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    refs.push(ref)
  }
  return refs
}

export function parseSupabaseProjectRefFile(source: string): string | null {
  const first = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  return first ? extractSupabaseRefFromUrl(first) : null
}

function stripEnvValue(raw: string): string {
  let value = raw.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  const hash = value.search(/\s+#/)
  if (hash >= 0) value = value.slice(0, hash)
  return value.trim()
}
