import { spawn } from 'node:child_process'
import type { CliHostKind, ModelOption } from '@shared/types'
import { PRESET_MODELS } from '@shared/types'
import { enabledCliAgents, isStructuredCliHost } from '@shared/types'
import type { SettingsStore } from '../store/SettingsStore'
import { resolveHostBinary } from './drivers'

const CACHE_TTL_MS = 30 * 60_000
const RUN_TIMEOUT_MS = 12_000

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
}

const cache = new Map<string, CacheEntry>()

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

/**
 * Warm the catalogue for VAV + every structured host (enabled agents first).
 * Safe to call repeatedly; respects cache unless `force`.
 */
export async function preloadHostModels(
  settings: SettingsStore,
  options?: { force?: boolean }
): Promise<Record<string, ListHostModelsResult>> {
  // Only warm hosts the user actually has enabled — probing every catalogue
  // CLI (including missing ones) spikes CPU and blocked the UI.
  const enabled = enabledCliAgents(settings.get().cliAgents)
    .map((a) => a.id)
    .filter((id): id is CliHostKind => isStructuredCliHost(id))
  const hosts: Array<CliHostKind | null> = [null, ...enabled]
  // Parallel but capped — spawning every CLI at once can spike CPU.
  const concurrency = 3
  for (let i = 0; i < hosts.length; i += concurrency) {
    const slice = hosts.slice(i, i + concurrency)
    await Promise.all(slice.map((h) => listHostModels(h, settings, options)))
  }
  return getModelCatalogSnapshot()
}

export async function listHostModels(
  host: string | null,
  settings: SettingsStore,
  options?: { force?: boolean }
): Promise<ListHostModelsResult> {
  if (!host || host === 'vav') {
    const custom = settings.get().customModels ?? []
    const presetIds = new Set(PRESET_MODELS.map((m) => m.id))
    const extras = custom
      .filter((id) => id.trim() && !presetIds.has(id))
      .map((id) => ({ id, label: id }))
    const models = extras.length ? [...PRESET_MODELS, ...extras] : [...PRESET_MODELS]
    const result: ListHostModelsResult = { host: 'vav', models, source: 'static' }
    cache.set('vav', { at: Date.now(), models, source: 'static' })
    return result
  }

  if (!isStructuredCliHost(host)) {
    return { host: 'vav', models: [...PRESET_MODELS], source: 'fallback', error: 'unknown host' }
  }

  const cacheKey = host
  const hit = cache.get(cacheKey)
  if (!options?.force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { host, models: hit.models, source: hit.source }
  }

  const agent = enabledCliAgents(settings.get().cliAgents).find((a) => a.id === host) ?? null
  const binary = await resolveHostBinary(host, agent)
  if (!binary) {
    const fallback = staticFallback(host)
    const error = `${host} CLI not found`
    cache.set(cacheKey, { at: Date.now(), models: fallback, source: 'fallback', error })
    return { host, models: fallback, source: 'fallback', error }
  }

  try {
    const live = await probeLiveModels(host, binary, agent?.envVars)
    if (live.length > 0) {
      cache.set(cacheKey, { at: Date.now(), models: live, source: 'live' })
      return { host, models: live, source: 'live' }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const fallback = staticFallback(host)
    cache.set(cacheKey, {
      at: Date.now(),
      models: fallback,
      source: 'fallback',
      error: message
    })
    return { host, models: fallback, source: 'fallback', error: message }
  }

  const fallback = staticFallback(host)
  cache.set(cacheKey, { at: Date.now(), models: fallback, source: 'fallback' })
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
    models.push({ id, label: id })
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
