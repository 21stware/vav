import { spawn } from 'node:child_process'
import type { CliHostKind, ModelOption } from '@shared/types'
import { enabledCliAgents, isStructuredCliHost } from '@shared/types'
import {
  agentModelHostKey,
  deepseekOfficialModels,
  isOfficialDeepSeekEndpoint,
  orderVavModels,
  pickVavDefaultModel,
  prettyVavModelLabel,
  vavFallbackModels
} from '@shared/agentModels'
import { vendorIdFromEndpoint } from '@shared/llmVendors'
import type { SettingsStore } from '../store/SettingsStore'
import { ensureLoginPath } from '../terminal/loginPath'
import { resolveHostBinary } from './drivers'
import { contextWindowFor, lookupCatalogModel } from './modelMeta'
import { resolveModelModalities } from '../../shared/modelModalities.ts'
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
  /** VAV catalogue is per endpoint — switching profiles must not reuse another host's list. */
  endpoint?: string
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
  /** Current VAV profile endpoint. Falls back to settings.apiEndpoint. */
  endpoint?: string | null
  /** Additional VAV accounts to probe (accountId -> { apiKey, endpoint, accountId }). */
  vavAccounts?: Record<string, { apiKey: string | null; endpoint: string; accountId: string }>
}

export interface ListHostModelsOptions {
  force?: boolean
  /** Unlocked VAV api key; enables the live /models probe for the vav host. */
  apiKey?: string | null
  /** Current VAV profile endpoint. Falls back to settings.apiEndpoint. */
  endpoint?: string | null
}

export interface ListHostModelsResult {
  host: string
  models: ModelOption[]
  source: 'live' | 'static' | 'fallback'
  error?: string
  /** Normalized VAV endpoint this catalogue was fetched for. */
  endpoint?: string
}

/** Snapshot of every host’s catalogue (may be empty before preload finishes). */
export function getModelCatalogSnapshot(): Record<string, ListHostModelsResult> {
  const out: Record<string, ListHostModelsResult> = {}
  for (const [host, entry] of cache) {
    out[host] = resultFromCache(host, entry)
  }
  return out
}

function resultFromCache(host: string, entry: CacheEntry): ListHostModelsResult {
  return {
    host,
    models: entry.models,
    source: entry.source,
    error: entry.error,
    ...(entry.endpoint ? { endpoint: entry.endpoint } : {})
  }
}

function decorateVavModel(model: ModelOption): ModelOption {
  const label =
    model.label && model.label !== model.id ? model.label : prettyVavModelLabel(model.id)
  const contextWindow = contextWindowFor(model.id)
  const { input, output } = resolveModelModalities(model, lookupCatalogModel(model.id)?.input)
  return contextWindow > 0
    ? { ...model, label, contextWindow, input, output }
    : { ...model, label, input, output }
}

function vavSeedModels(settings: SettingsStore): ModelOption[] {
  return vavFallbackModels(settings.get().defaultModel).map(decorateVavModel)
}

/** Instant catalogue so the picker never waits on CLI spawn. */
export function seedModelCatalog(
  settings: SettingsStore,
  options?: Pick<PreloadHostModelsOptions, 'endpoint' | 'vavAccounts'>
): Record<string, ListHostModelsResult> {
  seedHost('vav', settings, options?.endpoint)
  if (options?.vavAccounts) {
    for (const creds of Object.values(options.vavAccounts)) {
      const vendorId = vendorIdFromEndpoint(creds.endpoint)
      seedHost(agentModelHostKey(null, vendorId, creds.accountId), settings, creds.endpoint)
    }
  }
  for (const agent of enabledCliAgents(settings.get().cliAgents)) {
    if (isStructuredCliHost(agent.id)) seedHost(agent.id, settings)
  }
  return getModelCatalogSnapshot()
}

function normalizeVavEndpoint(endpoint: string | null | undefined): string {
  return (endpoint ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

function seedHost(
  host: string,
  settings: SettingsStore,
  endpoint?: string | null
): ListHostModelsResult {
  if (host === 'vav' || host.startsWith('vav:')) {
    const endpointKey = normalizeVavEndpoint(endpoint)
    const existing = cache.get(host)
    const endpointMatches = !endpointKey || existing?.endpoint === endpointKey
    if (existing && endpointMatches) {
      return resultFromCache(host, existing)
    }

    const parts = host.split(':')
    const vendorId = parts[1] || vendorIdFromEndpoint(endpoint || settings.get().apiEndpoint)

    const models =
      endpointKey && isOfficialDeepSeekEndpoint(endpoint ?? '')
        ? applyLiveVavModels(settings, deepseekOfficialModels())
        : vavFallbackModels(settings.get().defaultModel, vendorId).map(decorateVavModel)

    const entry: CacheEntry = {
      at: Date.now(),
      models,
      source: 'fallback',
      settled: false,
      ...(endpointKey ? { endpoint: endpointKey } : {})
    }
    cache.set(host, entry)
    return resultFromCache(host, entry)
  }
  const existing = cache.get(host)
  if (existing) return resultFromCache(host, existing)
  const models = staticFallback(host as CliHostKind)
  const needsProbe = LIVE_PROBE_HOSTS.has(host as CliHostKind)
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
  seedModelCatalog(settings, options)
  options?.onProgress?.(getModelCatalogSnapshot())

  // VAV first — the picker's own host is the most-visited list.
  const vavWork: Promise<unknown>[] = []
  vavWork.push(listHostModels('vav', settings, options))
  if (options?.vavAccounts) {
    for (const creds of Object.values(options.vavAccounts)) {
      const vendorId = vendorIdFromEndpoint(creds.endpoint)
      vavWork.push(
        listHostModels(agentModelHostKey(null, vendorId, creds.accountId), settings, {
          ...options,
          apiKey: creds.apiKey,
          endpoint: creds.endpoint
        })
      )
    }
  }
  await Promise.all(vavWork)
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
  const hostId = host || 'vav'
  if (hostId === 'vav' || hostId.startsWith('vav:')) {
    return listVavModels(hostId, settings, options)
  }

  if (!isStructuredCliHost(hostId)) {
    return {
      host: hostId,
      models: vavSeedModels(settings),
      source: 'fallback',
      error: 'unknown host'
    }
  }

  const cacheKey = hostId
  const hit = cache.get(cacheKey)
  const fresh = !!hit && Date.now() - hit.at < CACHE_TTL_MS
  if (!options?.force && hit && fresh && hit.settled) {
    return resultFromCache(hostId, hit)
  }

  if (!LIVE_PROBE_HOSTS.has(hostId as CliHostKind)) {
    return seedHost(hostId, settings)
  }

  const running = inflight.get(cacheKey)
  if (running && !options?.force) return running

  const work = probeAndCache(hostId as CliHostKind, settings)
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
 * Live model list for the VAV host. The catalogue is whatever the configured
 * endpoint publishes on /models — no shipped presets, no hand-typed ids.
 * Without a key the list stays empty (picker uses a one-row local fallback).
 */
/** Bumped on every new VAV probe so a slower OpenRouter list cannot overwrite DeepSeek. */
const vavProbeGenerations = new Map<string, number>()

async function listVavModels(
  host: string,
  settings: SettingsStore,
  options?: ListHostModelsOptions
): Promise<ListHostModelsResult> {
  const endpoint = options?.endpoint?.trim() || settings.get().apiEndpoint?.trim() || ''
  const apiKey = options?.apiKey?.trim() || null
  const endpointKey = normalizeVavEndpoint(endpoint)
  const seeded = seedHost(host, settings, endpoint)
  const entry = cache.get(host)
  if (!entry) return seeded

  const endpointChanged = Boolean(endpointKey && entry.endpoint !== endpointKey)
  const force = options?.force === true || endpointChanged
  if (!force) {
    if (entry.source === 'live' && Date.now() - entry.at < CACHE_TTL_MS) {
      return resultFromCache(host, entry)
    }
    if (entry.error && Date.now() - entry.at < VAV_PROBE_RETRY_MS) {
      return resultFromCache(host, entry)
    }
  }
  if (!endpoint || !apiKey) return seeded

  const cacheKey = `probe:${host}:${endpointKey}`
  const running = inflight.get(cacheKey)
  if (running && !force) return running

  const generation = (vavProbeGenerations.get(host) ?? 0) + 1
  vavProbeGenerations.set(host, generation)
  const work = (async (): Promise<ListHostModelsResult> => {
    const probe = await fetchVavModels({ endpoint, apiKey })
    if (generation !== vavProbeGenerations.get(host)) {
      const current = cache.get(host)
      return current ? resultFromCache(host, current) : seeded
    }
    if (probe.models.length > 0) {
      const models = applyLiveVavModels(settings, probe.models)
      const nextDefault = pickVavDefaultModel(
        settings.get().defaultModel,
        models.map((m) => m.id)
      )
      if (nextDefault !== settings.get().defaultModel && host === 'vav') {
        settings.update({ defaultModel: nextDefault })
      }
      const next: CacheEntry = {
        at: Date.now(),
        models: orderVavModels(models, nextDefault),
        source: 'live',
        settled: true,
        endpoint: endpointKey
      }
      cache.set(host, next)
      return resultFromCache(host, next)
    }
    const parts = host.split(':')
    const vendorId = parts[1] || vendorIdFromEndpoint(endpoint || settings.get().apiEndpoint)
    const official =
      !probe.error && isOfficialDeepSeekEndpoint(endpoint)
        ? applyLiveVavModels(settings, deepseekOfficialModels())
        : vavFallbackModels(settings.get().defaultModel, vendorId).map(decorateVavModel)
    const fallback: CacheEntry = {
      at: Date.now(),
      models: official,
      source: 'fallback',
      settled: true,
      endpoint: endpointKey,
      ...(official.length > 0 && !official[0]?.id.includes('deepseek')
        ? {}
        : probe.error
          ? { error: probe.error }
          : { error: 'empty catalogue' })
    }
    cache.set(host, fallback)
    return resultFromCache(host, fallback)
  })()
  inflight.set(cacheKey, work)
  try {
    return await work
  } finally {
    if (inflight.get(cacheKey) === work) inflight.delete(cacheKey)
  }
}

function applyLiveVavModels(settings: SettingsStore, live: ModelOption[]): ModelOption[] {
  return orderVavModels(live.map(decorateVavModel), settings.get().defaultModel)
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
