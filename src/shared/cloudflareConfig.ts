/**
 * Parse Wrangler / Pages config text (no filesystem). Used by the main
 * Cloudflare status service and unit tests.
 */

import type {
  CloudflareBinding,
  CloudflareConfig,
  CloudflareEnvironment,
  CloudflareKind
} from './cloudflare'

const WRANGLE_NAME = /(?:^|[/\\])wrangler\.(toml|jsonc?|json5)$/i

export function isWranglerConfigName(name: string): boolean {
  return /^(wrangler\.(toml|jsonc?|json5))$/i.test(name)
}

export function wranglerFormatFromPath(
  filePath: string
): CloudflareConfig['format'] | null {
  if (!WRANGLE_NAME.test(filePath)) return null
  return filePath.toLowerCase().endsWith('.toml') ? 'toml' : 'jsonc'
}

export function stripJsonc(source: string): string {
  let out = ''
  let i = 0
  let inStr = false
  let quote = ''
  let escape = false
  while (i < source.length) {
    const c = source[i]!
    if (inStr) {
      out += c
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === quote) inStr = false
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      quote = c
      out += c
      i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function collectBindingsFromJson(root: Record<string, unknown>): CloudflareBinding[] {
  const out: CloudflareBinding[] = []
  const pushList = (kind: string, raw: unknown, nameKey: 'name' | 'binding' = 'binding'): void => {
    if (!Array.isArray(raw)) return
    for (const item of raw) {
      const rec = asRecord(item)
      if (!rec) continue
      const binding = str(rec[nameKey]) ?? str(rec.binding) ?? str(rec.name)
      if (!binding) continue
      const target =
        str(rec.id) ??
        str(rec.database_name) ??
        str(rec.bucket_name) ??
        str(rec.queue) ??
        str(rec.index_name) ??
        str(rec.script_name) ??
        str(rec.service)
      out.push({ kind, binding, target: target ?? undefined })
    }
  }
  pushList('kv', root.kv_namespaces)
  pushList('d1', root.d1_databases)
  pushList('r2', root.r2_buckets)
  pushList('vectorize', root.vectorize)
  pushList('hyperdrive', root.hyperdrive)
  pushList('service', root.services)
  const queues = asRecord(root.queues)
  if (queues) {
    pushList('queue', queues.producers)
    pushList('queue-consumer', queues.consumers, 'name')
  }
  const durable = asRecord(root.durable_objects)
  if (durable) pushList('durable-object', durable.bindings, 'name')
  if (asRecord(root.ai)) out.push({ kind: 'ai', binding: str(asRecord(root.ai)?.binding) ?? 'AI' })
  if (asRecord(root.browser)) {
    out.push({ kind: 'browser', binding: str(asRecord(root.browser)?.binding) ?? 'BROWSER' })
  }
  if (asRecord(root.images)) {
    out.push({ kind: 'images', binding: str(asRecord(root.images)?.binding) ?? 'IMAGES' })
  }
  return out
}

function collectEnvsFromJson(root: Record<string, unknown>): CloudflareEnvironment[] {
  const env = asRecord(root.env)
  if (!env) return []
  const out: CloudflareEnvironment[] = []
  for (const [name, value] of Object.entries(env)) {
    const rec = asRecord(value)
    out.push({ name, projectName: rec ? str(rec.name) : null })
  }
  return out
}

function inferKind(input: {
  main: string | null
  pagesOutputDir: string | null
}): CloudflareKind {
  if (input.pagesOutputDir && !input.main) return 'pages'
  if (input.main) return 'workers'
  if (input.pagesOutputDir) return 'pages'
  return 'unknown'
}

function fromJsonObject(
  raw: unknown,
  meta: Pick<CloudflareConfig, 'path' | 'relativePath' | 'format'>
): CloudflareConfig | null {
  const root = asRecord(raw)
  if (!root) return null
  const name = str(root.name)
  const accountId = str(root.account_id)
  const compatibilityDate = str(root.compatibility_date)
  const main = str(root.main)
  const pagesOutputDir = str(root.pages_build_output_dir)
  return {
    ...meta,
    kind: inferKind({ main, pagesOutputDir }),
    name,
    accountId,
    compatibilityDate,
    main,
    pagesOutputDir,
    bindings: collectBindingsFromJson(root),
    environments: collectEnvsFromJson(root)
  }
}

function unquoteToml(raw: string): string {
  const t = raw.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

function tomlTopString(source: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'im')
  const m = re.exec(source.split(/\n\[/)[0] ?? source)
  if (!m) return null
  return unquoteToml(m[1]!) || null
}

function tomlTableArrays(source: string, table: string): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  const re = new RegExp(`^\\[\\[${table}\\]\\]\\s*$`, 'gim')
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    const start = match.index + match[0].length
    const rest = source.slice(start)
    const end = rest.search(/\n\[/)
    const body = end === -1 ? rest : rest.slice(0, end)
    const rec: Record<string, string> = {}
    for (const line of body.split('\n')) {
      const kv = /^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line)
      if (!kv) continue
      rec[kv[1]!] = unquoteToml(kv[2]!)
    }
    rows.push(rec)
  }
  return rows
}

function tomlInlineBindings(source: string): CloudflareBinding[] {
  const out: CloudflareBinding[] = []
  const block = /\[durable_objects\][\s\S]*?bindings\s*=\s*\[([\s\S]*?)\]/i.exec(source)
  if (!block) return out
  const nameRe = /name\s*=\s*"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = nameRe.exec(block[1]!))) {
    out.push({ kind: 'durable-object', binding: m[1]! })
  }
  return out
}

function parseTomlConfig(
  source: string,
  meta: Pick<CloudflareConfig, 'path' | 'relativePath' | 'format'>
): CloudflareConfig {
  const name = tomlTopString(source, 'name')
  const accountId = tomlTopString(source, 'account_id')
  const compatibilityDate = tomlTopString(source, 'compatibility_date')
  const main = tomlTopString(source, 'main')
  const pagesOutputDir = tomlTopString(source, 'pages_build_output_dir')
  const bindings: CloudflareBinding[] = []
  const add = (kind: string, rows: Record<string, string>[], bindingKey = 'binding'): void => {
    for (const row of rows) {
      const binding = row[bindingKey] || row.name
      if (!binding) continue
      const target =
        row.id || row.database_name || row.bucket_name || row.queue || row.index_name || row.service
      bindings.push({ kind, binding, target: target || undefined })
    }
  }
  add('kv', tomlTableArrays(source, 'kv_namespaces'))
  add('d1', tomlTableArrays(source, 'd1_databases'))
  add('r2', tomlTableArrays(source, 'r2_buckets'))
  add('vectorize', tomlTableArrays(source, 'vectorize'))
  add('hyperdrive', tomlTableArrays(source, 'hyperdrive'))
  add('service', tomlTableArrays(source, 'services'))
  add('queue', tomlTableArrays(source, 'queues.producers'))
  bindings.push(...tomlInlineBindings(source))
  if (/^\[ai\]/im.test(source) || /^ai\s*=/im.test(source)) {
    bindings.push({ kind: 'ai', binding: 'AI' })
  }

  const environments: CloudflareEnvironment[] = []
  const envRe = /^\[env\.([A-Za-z0-9_-]+)\]/gm
  let envMatch: RegExpExecArray | null
  while ((envMatch = envRe.exec(source))) {
    const envName = envMatch[1]!
    const start = envMatch.index + envMatch[0].length
    const rest = source.slice(start)
    const end = rest.search(/\n\[/)
    const body = end === -1 ? rest : rest.slice(0, end)
    environments.push({ name: envName, projectName: tomlTopString(body, 'name') })
  }

  return {
    ...meta,
    kind: inferKind({ main, pagesOutputDir }),
    name,
    accountId,
    compatibilityDate,
    main,
    pagesOutputDir,
    bindings,
    environments
  }
}

export function parseWranglerConfig(
  source: string,
  filePath: string,
  relativePath = filePath
): CloudflareConfig | null {
  const format = wranglerFormatFromPath(filePath)
  if (!format) return null
  const meta = { path: filePath, relativePath, format }
  if (format === 'jsonc') {
    try {
      return fromJsonObject(JSON.parse(stripJsonc(source)), meta)
    } catch {
      return null
    }
  }
  return parseTomlConfig(source, meta)
}

export function parsePackageDeployScripts(pkgJson: string): string[] {
  try {
    const rec = asRecord(JSON.parse(stripJsonc(pkgJson)))
    const scripts = rec ? asRecord(rec.scripts) : null
    if (!scripts) return []
    const out: string[] = []
    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value !== 'string') continue
      if (/\bwrangler\b|cloudflare|pages deploy|pages:deploy/i.test(`${name} ${value}`)) {
        out.push(name)
      }
    }
    return out
  } catch {
    return []
  }
}

export function parseWorkflowCloudflareHints(yaml: string, fileName: string): string[] {
  const hits: string[] = []
  if (/cloudflare\/wrangler-action|wrangler-action@/i.test(yaml)) {
    hits.push(`${fileName} · wrangler-action`)
  }
  if (/cloudflare\/pages-action|pages-action@/i.test(yaml)) {
    hits.push(`${fileName} · pages-action`)
  }
  if (hits.length === 0 && /\bwrangler\s+(deploy|pages)\b/i.test(yaml)) {
    hits.push(`${fileName} · wrangler`)
  }
  return hits
}
