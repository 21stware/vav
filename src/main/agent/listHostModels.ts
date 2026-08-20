import { spawn } from 'node:child_process'
import type { CliHostKind, ModelOption } from '@shared/types'
import { PRESET_MODELS } from '@shared/types'
import { enabledCliAgents, isStructuredCliHost } from '@shared/types'
import type { SettingsStore } from '../store/SettingsStore'
import { ensureLoginPath } from '../terminal/loginPath'
import { resolveHostBinary } from './drivers'
import { contextWindowFor } from './modelMeta'
import { fetchVavModels } from './vavModelProbe'

const CACHE_TTL_MS = 30 * 60_000
const RUN_TIMEOUT_MS = 12_000

/** Hosts whose CLI can actually print a catalogue. Others stay on static fallback. */
const LIVE_PROBE_HOSTS = new Set<CliHostKind>(['cursor', 'grok', 'opencode', 'pi'])

/** Empty id = omit `--model` / use the CLI's own default. */
export const CLI_DEFAULT_MODEL: ModelOption = { id: '', label: 'Default' }

/**
 * Documented Claude Code aliases from `claude --help` (`--model`).
 * Not a guessed catalogue of full model ids.
 */
const CLAUDE_ALIASES: ModelOption[] = [
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'fable', label: 'Fable' }
]

interface CacheEntry {
  at: number
  models: ModelOption[]
  source: 'live' | 'static' | 'fallback'
  error?: string
  /** False = seeded fallback, live probe still outstanding. */
  settled: boolean
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<ListHostModelsResult>>()

export interface PreloadHostModelsOptions {
  force?: boolean
  /** Probe these live hosts first (recent picks / open sessions). */
  prefer?: Array<CliHostKind | null | string>
  onProgress?: (catalog: Record<string, ListHostModelsResult>) => void
  /** Unlocked VAV api key; enables the live /models probe for the vav host. */
  apiKey?: string | null
}

export interface ListHostModelsOptions {
  force?: boolean
  /** Unlocked VAV api key; enables the live /models probe for the vav host. */
  apiKey?: string | null
}

export interface ListHostModelsResult {
  host: CliHostKind | 'vav'
  models: ModelOption[]
  source: 'live' | 'static' | 'fallback'
  error?: string
}

/** Snapshot of every host’s catalogue (may be empty before preload finishes). */
export function getModelCatalogSnapshot(): Record<string, ListHostModelsResult> {
  const out: Record<string, ListHostModelsResult> = {}
  for (const [host, entry] of cache) {
    out[host] = {
      host: host === 'vav' ? 'vav' : (host as CliHostKind),
      models: entry.models,
      source: entry.source,
      error: entry.error
    }
  }
  return out
}

function resultFromCache(host: CliHostKind | 'vav', entry: CacheEntry): ListHostModelsResult {
  return {
    host,
    models: entry.models,
    source: entry.source,
    error: entry.error
  }
}

function vavModels(settings: SettingsStore): ModelOption[] {
  const custom = settings.get().customModels ?? []
  const presetIds = new Set(PRESET_MODELS.map((m) => m.id))
  const extras = custom
    .filter((id) => id.trim() && !presetIds.has(id))
    .map((id) => ({ id, label: id }))
  const models = extras.length ? [...PRESET_MODELS, ...extras] : [...PRESET_MODELS]
  // Badge picker rows with the catalog context window when pi-ai knows the id.
  return models.map((m) => {
    const contextWindow = contextWindowFor(m.id)
    return contextWindow > 0 ? { ...m, contextWindow } : m
  })
}

/** Instant catalogue so the picker never waits on CLI spawn. */
export function seedModelCatalog(
  settings: SettingsStore
): Record<string, ListHostModelsResult> {
  seedHost('vav', settings)
  for (const agent of enabledCliAgents(settings.get().cliAgents)) {
    if (isStructuredCliHost(agent.id)) seedHost(agent.id, settings)
  }
  return getModelCatalogSnapshot()
}

function seedHost(host: CliHostKind | 'vav', settings: SettingsStore): ListHostModelsResult {
  if (host === 'vav') {
    // Never downgrade a fresh live probe back to the static seed; anything
    // else re-seeds so custom-model edits surface immediately.
    const existing = cache.get('vav')
    if (existing?.source === 'live' && Date.now() - existing.at < CACHE_TTL_MS) {
      return resultFromCache('vav', existing)
    }
    const models = vavModels(settings)
    const entry: CacheEntry = { at: Date.now(), models, source: 'static', settled: true }
    cache.set('vav', entry)
    return resultFromCache('vav', entry)
  }
  const existing = cache.get(host)
  if (existing) return resultFromCache(host, existing)
  const models = staticFallback(host)
  const needsProbe = LIVE_PROBE_HOSTS.has(host)
  const entry: CacheEntry = {
    at: Date.now(),
    models,
    source: host === 'claude' ? 'static' : 'fallback',
    settled: !needsProbe
  }
  cache.set(host, entry)
  return resultFromCache(host, entry)
}

function preferredLiveHosts(
  enabled: CliHostKind[],
  prefer?: Array<CliHostKind | null | string>
): CliHostKind[] {
  const enabledSet = new Set(enabled)
  const live = enabled.filter((id) => LIVE_PROBE_HOSTS.has(id))
  const liveSet = new Set(live)
  const ordered: CliHostKind[] = []
  const seen = new Set<CliHostKind>()
  for (const raw of prefer ?? []) {
    if (!raw || raw === 'vav' || !isStructuredCliHost(raw)) continue
    if (!liveSet.has(raw) || seen.has(raw)) continue
    seen.add(raw)
    ordered.push(raw)
  }
  for (const id of live) {
    if (seen.has(id)) continue
    if (!enabledSet.has(id)) continue
    seen.add(id)
    ordered.push(id)
  }
  return ordered
}

/**
 * Warm the catalogue for VAV + every structured host (enabled agents first).
 * Seeds static fallbacks immediately, then live-probes only CLIs that can list.
 */
export async function preloadHostModels(
  settings: SettingsStore,
  options?: PreloadHostModelsOptions
): Promise<Record<string, ListHostModelsResult>> {
  seedModelCatalog(settings)
  options?.onProgress?.(getModelCatalogSnapshot())

  // VAV first — the picker's own host is the most-visited list.
  await listHostModels('vav', settings, options)
  options?.onProgress?.(getModelCatalogSnapshot())

  const enabled = enabledCliAgents(settings.get().cliAgents)
    .map((a) => a.id)
    .filter((id): id is CliHostKind => isStructuredCliHost(id))
  const hosts = preferredLiveHosts(enabled, options?.prefer)
  const concurrency = 3
  for (let i = 0; i < hosts.length; i += concurrency) {
    const slice = hosts.slice(i, i + concurrency)
    await Promise.all(
      slice.map(async (h) => {
        await listHostModels(h, settings, options)
        options?.onProgress?.(getModelCatalogSnapshot())
      })
    )
  }
  return getModelCatalogSnapshot()
}

export async function listHostModels(
  host: string | null,
  settings: SettingsStore,
  options?: ListHostModelsOptions
): Promise<ListHostModelsResult> {
  if (!host || host === 'vav') {
    return listVavModels(settings, options)
  }

  if (!isStructuredCliHost(host)) {
    return { host: 'vav', models: [...PRESET_MODELS], source: 'fallback', error: 'unknown host' }
  }

  const cacheKey = host
  const hit = cache.get(cacheKey)
  const fresh = !!hit && Date.now() - hit.at < CACHE_TTL_MS
  if (!options?.force && hit && fresh && hit.settled) {
    return resultFromCache(host, hit)
  }

  if (!LIVE_PROBE_HOSTS.has(host)) {
    return seedHost(host, settings)
  }

  const running = inflight.get(cacheKey)
  if (running && !options?.force) return running

  const work = probeAndCache(host, settings)
  inflight.set(cacheKey, work)
  try {
    return await work
  } finally {
    if (inflight.get(cacheKey) === work) inflight.delete(cacheKey)
  }
}

/** Cooldown before re-probing a failing endpoint (live hits get CACHE_TTL_MS). */
const VAV_PROBE_RETRY_MS = 60_000

/**
 * Live model list for the VAV host. The static seed (presets + customs) is the
 * instant answer; when an endpoint and an unlocked key exist, the provider's
 * own /models route is probed and merged in. Without a key the seed is final —
 * the CLI-agent probes are keyless, this one is not.
 */
async function listVavModels(
  settings: SettingsStore,
  options?: ListHostModelsOptions
): Promise<ListHostModelsResult> {
  const seeded = seedHost('vav', settings)
  const entry = cache.get('vav')
  if (!entry) return seeded

  const force = options?.force === true
  if (!force) {
    if (entry.source === 'live' && Date.now() - entry.at < CACHE_TTL_MS) return seeded
    if (entry.error && Date.now() - entry.at < VAV_PROBE_RETRY_MS) return seeded
  }

  const endpoint = settings.get().apiEndpoint?.trim() || ''
  const apiKey = options?.apiKey?.trim() || null
  if (!endpoint || !apiKey) return seeded

  const running = inflight.get('vav')
  if (running && !force) return running

  const work = (async (): Promise<ListHostModelsResult> => {
    const probe = await fetchVavModels({ endpoint, apiKey })
    if (probe.models.length > 0) {
      const next: CacheEntry = {
        at: Date.now(),
        models: mergeVavModels(settings, probe.models),
        source: 'live',
        settled: true
      }
      cache.set('vav', next)
      return resultFromCache('vav', next)
    }
    // Probe failed or empty: keep the static list, cool down before retrying.
    const fallback: CacheEntry = {
      at: Date.now(),
      models: entry.models,
      source: 'static',
      settled: true,
      ...(probe.error ? { error: probe.error } : {})
    }
    cache.set('vav', fallback)
    return resultFromCache('vav', fallback)
  })()
  inflight.set('vav', work)
  try {
    return await work
  } finally {
    if (inflight.get('vav') === work) inflight.delete('vav')
  }
}

/** Presets + customs stay in front; live-discovered ids append behind them. */
function mergeVavModels(settings: SettingsStore, live: ModelOption[]): ModelOption[] {
  const base = vavModels(settings)
  const known = new Set(base.map((m) => m.id.toLowerCase()))
  const extras = live
    .filter((m) => m.id && !known.has(m.id.toLowerCase()))
    .map((m) => {
      const contextWindow = contextWindowFor(m.id)
      return contextWindow > 0 ? { ...m, contextWindow } : m
    })
  return [...base, ...extras]
}

async function probeAndCache(
  host: CliHostKind,
  settings: SettingsStore
): Promise<ListHostModelsResult> {
  seedHost(host, settings)
  await ensureLoginPath()
  const agent = enabledCliAgents(settings.get().cliAgents).find((a) => a.id === host) ?? null
  const binary = await resolveHostBinary(host, agent)
  if (!binary) {
    const fallback = staticFallback(host)
    const error = `${host} CLI not found`
    cache.set(host, {
      at: Date.now(),
      models: fallback,
      source: 'fallback',
      error,
      settled: true
    })
    return { host, models: fallback, source: 'fallback', error }
  }

  try {
    const live = await probeLiveModels(host, binary, agent?.envVars)
    if (live.length > 0) {
      cache.set(host, { at: Date.now(), models: live, source: 'live', settled: true })
      return { host, models: live, source: 'live' }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const fallback = staticFallback(host)
    cache.set(host, {
      at: Date.now(),
      models: fallback,
      source: 'fallback',
      error: message,
      settled: true
    })
    return { host, models: fallback, source: 'fallback', error: message }
  }

  const fallback = staticFallback(host)
  cache.set(host, { at: Date.now(), models: fallback, source: 'fallback', settled: true })
  return { host, models: fallback, source: 'fallback' }
}

function staticFallback(host: CliHostKind): ModelOption[] {
  if (host === 'claude') return [...CLAUDE_ALIASES]
  return [CLI_DEFAULT_MODEL]
}

async function probeLiveModels(
  host: CliHostKind,
  binary: string,
  env?: Record<string, string>
): Promise<ModelOption[]> {
  switch (host) {
    case 'cursor': {
      const out = await runText(binary, ['--list-models'], env)
      return parseCursorModels(out)
    }
    case 'grok': {
      const out = await runText(binary, ['models'], env)
      return parseGrokModels(out)
    }
    case 'opencode': {
      const out = await runText(binary, ['models'], env)
      return parseLineIds(out)
    }
    case 'pi': {
      const out = await runText(binary, ['--list-models'], env)
      return parsePiModels(out)
    }
    case 'claude':
      // No machine-readable list in the CLI; aliases are the supported surface.
      return [...CLAUDE_ALIASES]
    case 'codex':
    case 'devin':
    case 'antigravity':
    case 'kiro':
    case 'cline':
      // No reliable non-interactive catalogue yet.
      return []
  }
}

function parseCursorModels(text: string): ModelOption[] {
  const models: ModelOption[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^available models$/i.test(line)) continue
    const m = line.match(/^(\S+)\s+-\s+(.+)$/)
    if (!m) continue
    const id = m[1]!
    const label = m[2]!.trim()
    models.push({ id, label })
  }
  return dedupe(models)
}

function parseGrokModels(text: string): ModelOption[] {
  const models: ModelOption[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    // "* grok-4.5 (default)" or "* grok-4.5"
    const m = line.match(/^\*\s+(\S+)(?:\s+\((default)\))?/i)
    if (!m) continue
    const id = m[1]!
    const isDefault = !!m[2]
    models.push({ id, label: isDefault ? `${id} (default)` : id })
  }
  return dedupe(models)
}

function parseLineIds(text: string): ModelOption[] {
  const models: ModelOption[] = []
  for (const raw of text.split(/\r?\n/)) {
    const id = raw.trim()
    if (!id || id.includes(' ')) continue
    models.push({ id, label: id })
  }
  return dedupe(models)
}

function parseContextSize(raw: string): number | undefined {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)(k|m|b)?$/i)
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const unit = (m[2] || '').toLowerCase()
  if (unit === 'k') return Math.round(n * 1_000)
  if (unit === 'm') return Math.round(n * 1_000_000)
  if (unit === 'b') return Math.round(n * 1_000_000_000)
  if (n >= 1_024) return Math.round(n)
  return undefined
}

function parsePiModels(text: string): ModelOption[] {
  const models: ModelOption[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^provider\s+model/i.test(line)) continue
    // "deepseek  deepseek-v4-flash  1M  ..."
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const provider = parts[0]!
    const model = parts[1]!
    if (!provider || !model) continue
    const id = `${provider}/${model}`
    const contextWindow = parts[2] ? parseContextSize(parts[2]) : undefined
    models.push(contextWindow ? { id, label: id, contextWindow } : { id, label: id })
  }
  return dedupe(models)
}

function dedupe(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>()
  const out: ModelOption[] = []
  for (const m of models) {
    // Allow empty id (= CLI Default).
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out
}

function runText(
  binary: string,
  args: string[],
  env?: Record<string, string>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: { ...process.env, ...(env ?? {}), CI: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Timed out listing models (${binary} ${args.join(' ')})`))
    }, RUN_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 || stdout.trim()) resolve(stdout)
      else reject(new Error(stderr.trim() || `exit ${code ?? '?'}`))
    })
  })
}
