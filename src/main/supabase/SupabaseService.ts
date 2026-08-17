import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { isIgnoredName } from '@shared/types'
import type {
  SupabaseConfig,
  SupabaseErrorCode,
  SupabaseLocalFunction,
  SupabaseRemote,
  SupabaseRemoteFunction,
  SupabaseRemoteProject,
  SupabaseResult,
  SupabaseStatus,
  SupabaseStatusQuery
} from '@shared/supabase'
import {
  isSupabaseWorkspace,
  mapSupabaseFunctionStatus,
  mapSupabaseProjectStatus,
  mergeSupabaseFunctions,
  supabaseDashboardProjectUrl
} from '@shared/supabase'
import {
  extractSupabaseRefFromUrl,
  isSupabaseConfigName,
  isSupabaseEnvName,
  parseSupabaseEnvRefs,
  parseSupabaseFunctionMeta,
  parseSupabaseProjectId,
  parseSupabaseProjectRefFile
} from '@shared/supabaseConfig'
import { peekSupabaseAuth, resolveSupabaseToken, supabaseBin, supabaseCliJson } from './cliAuth'

const API = 'https://api.supabase.com/v1'
const API_TIMEOUT_MS = 20_000
const WALK_DIR_CAP = 80
const EXTRA_SKIP = new Set([
  'dist',
  'out',
  'build',
  'release',
  'coverage',
  '.wrangler',
  '.next',
  '.output',
  '.turbo',
  '.cache',
  'target',
  'node_modules'
])

export interface SupabaseAuth {
  token: string | null
  projectRef: string | null
}

type Scan = Pick<
  SupabaseStatus,
  'workdir' | 'present' | 'config' | 'extraConfigs' | 'projectRef' | 'localFunctions'
>

function fail<T>(error: string, code: SupabaseErrorCode): SupabaseResult<T> {
  return { ok: false, error, code }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function walkFiles(root: string, pred: (name: string) => boolean): string[] {
  const out: string[] = []
  const stack = [root]
  let dirs = 0
  while (stack.length && dirs < WALK_DIR_CAP) {
    const dir = stack.pop()!
    dirs += 1
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (isIgnoredName(entry.name) || EXTRA_SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.isFile() && pred(entry.name)) out.push(full)
    }
  }
  return out
}

function listDirNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '_shared')
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function firstExistingFile(dir: string, names: string[]): string | null {
  for (const name of names) {
    const full = join(dir, name)
    try {
      if (existsSync(full) && statSync(full).isFile()) return full
    } catch {
      // ignore
    }
  }
  return null
}

function parentNamedSupabase(configPath: string): boolean {
  return basename(resolve(configPath, '..')).toLowerCase() === 'supabase'
}

function collectLocalFunctions(
  root: string,
  configPath: string | null,
  meta: Record<string, { verifyJwt: boolean | null }>
): SupabaseLocalFunction[] {
  const functionRoots = new Set<string>()
  if (configPath) functionRoots.add(join(resolve(configPath, '..'), 'functions'))
  for (const file of walkFiles(root, (name) => name === 'index.ts' || name === 'index.js')) {
    const dir = resolve(file, '..')
    const parent = resolve(dir, '..')
    if (basename(parent).toLowerCase() !== 'functions') continue
    if (basename(resolve(parent, '..')).toLowerCase() !== 'supabase') continue
    functionRoots.add(parent)
  }

  const bySlug = new Map<string, SupabaseLocalFunction>()
  for (const functionsDir of functionRoots) {
    for (const slug of listDirNames(functionsDir)) {
      const entry =
        firstExistingFile(join(functionsDir, slug), ['index.ts', 'index.js', 'index.tsx']) ??
        join(functionsDir, slug)
      bySlug.set(slug, {
        slug,
        path: entry,
        relativePath: relative(root, entry) || entry,
        verifyJwt: meta[slug]?.verifyJwt ?? null
      })
    }
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

function collectProjectRefs(root: string, configPath: string | null): string[] {
  const refs: string[] = []
  const seen = new Set<string>()
  const push = (value: string | null): void => {
    if (!value || seen.has(value)) return
    seen.add(value)
    refs.push(value)
  }

  const candidates: string[] = []
  if (configPath) {
    const supabaseDir = resolve(configPath, '..')
    candidates.push(join(supabaseDir, '.temp', 'project-ref'))
    candidates.push(join(supabaseDir, '.temp', 'project-ref.txt'))
  }
  candidates.push(join(root, '.supabase', 'project-ref'))
  for (const file of candidates) {
    const text = readText(file)
    if (text) push(parseSupabaseProjectRefFile(text))
  }

  const envFiles = walkFiles(root, isSupabaseEnvName)
  envFiles.sort((a, b) => a.length - b.length || a.localeCompare(b))
  for (const file of envFiles) {
    const text = readText(file)
    if (!text) continue
    for (const ref of parseSupabaseEnvRefs(text)) push(ref)
  }
  return refs
}

export function scanSupabaseWorkspace(cwd: string): SupabaseResult<Scan> {
  const abs = resolve(cwd)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return fail('Working directory not found', 'network')
  }

  const configPaths = walkFiles(abs, isSupabaseConfigName)
    .filter(parentNamedSupabase)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))

  const parsed = configPaths
    .map((path): SupabaseConfig | null => {
      const text = readText(path)
      if (text == null) return null
      return {
        path,
        relativePath: relative(abs, path) || basename(path),
        projectId: parseSupabaseProjectId(text)
      }
    })
    .filter((row): row is SupabaseConfig => Boolean(row))

  const config = parsed[0] ?? null
  const meta = config ? parseSupabaseFunctionMeta(readText(config.path) ?? '') : {}
  const localFunctions = collectLocalFunctions(abs, config?.path ?? null, meta)
  const refs = collectProjectRefs(abs, config?.path ?? null)
  const scan: Scan = {
    workdir: abs,
    present: false,
    config,
    extraConfigs: Math.max(0, parsed.length - 1),
    projectRef: refs[0] ?? null,
    localFunctions
  }
  scan.present = isSupabaseWorkspace(scan)
  return { ok: true, data: scan }
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

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function normalizeSupabaseTimestamp(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Date.parse(trimmed)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : trimmed
  }
  const n = num(value)
  if (n == null) return null
  const ms = n < 1e12 ? n * 1000 : n
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function mapRemoteProject(raw: Record<string, unknown>): SupabaseRemoteProject | null {
  const ref =
    extractSupabaseRefFromUrl(str(raw.ref) ?? str(raw.id) ?? '') ?? str(raw.ref) ?? str(raw.id)
  if (!ref) return null
  const database = asRecord(raw.database)
  return {
    ref,
    name: str(raw.name) ?? ref,
    region: str(raw.region),
    status: mapSupabaseProjectStatus(str(raw.status)),
    postgresVersion: str(database?.version) ?? str(database?.postgres_engine),
    createdAt: normalizeSupabaseTimestamp(raw.created_at),
    dashboardUrl: supabaseDashboardProjectUrl(ref)
  }
}

function mapRemoteFunction(raw: Record<string, unknown>): SupabaseRemoteFunction | null {
  const slug = str(raw.slug) ?? str(raw.name)
  if (!slug) return null
  return {
    id: str(raw.id),
    slug,
    name: str(raw.name) ?? slug,
    status: mapSupabaseFunctionStatus(str(raw.status)),
    version: num(raw.version),
    createdAt: normalizeSupabaseTimestamp(raw.created_at),
    updatedAt: normalizeSupabaseTimestamp(raw.updated_at ?? raw.created_at),
    verifyJwt: typeof raw.verify_jwt === 'boolean' ? raw.verify_jwt : null,
    importMap: typeof raw.import_map === 'boolean' ? raw.import_map : null,
    entrypoint: str(raw.entrypoint_path)
  }
}

async function sbFetch<T>(
  token: string,
  path: string
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctrl.signal
    })
    const json = (await res.json().catch(() => null)) as T | { message?: string } | null
    if (!res.ok) {
      const msg =
        json && typeof json === 'object' && json !== null && 'message' in json
          ? String((json as { message?: string }).message || '')
          : ''
      return { ok: false, status: res.status, error: msg || `Supabase API ${res.status}` }
    }
    return { ok: true, data: json as T }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, error: message }
  } finally {
    clearTimeout(timer)
  }
}

function codeFromHttp(status: number): SupabaseErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not-found'
  return 'network'
}

async function fetchRemote(
  token: string,
  preferredRef: string | null,
  projectId: string | null
): Promise<
  | { ok: true; remote: SupabaseRemote }
  | { ok: false; error: string; code: SupabaseErrorCode }
> {
  let project: SupabaseRemoteProject | null = null
  if (preferredRef) {
    const one = await sbFetch<Record<string, unknown>>(token, `/projects/${preferredRef}`)
    if (one.ok) project = mapRemoteProject(asRecord(one.data) ?? one.data)
    else if (one.status !== 404) {
      return { ok: false, error: one.error, code: codeFromHttp(one.status) }
    }
  }

  if (!project) {
    const listed = await sbFetch<unknown[]>(token, '/projects')
    if (!listed.ok) return { ok: false, error: listed.error, code: codeFromHttp(listed.status) }
    const rows = (Array.isArray(listed.data) ? listed.data : [])
      .map((row) => mapRemoteProject(asRecord(row) ?? {}))
      .filter((row): row is SupabaseRemoteProject => Boolean(row))
    if (preferredRef) {
      project = rows.find((row) => row.ref === preferredRef) ?? null
    }
    if (!project && projectId) {
      const needle = projectId.toLowerCase()
      project = rows.find((row) => row.name.toLowerCase() === needle) ?? null
    }
  }

  if (!project) {
    return { ok: false, error: 'Supabase project not found', code: preferredRef ? 'not-found' : 'no-ref' }
  }

  const fns = await sbFetch<unknown[]>(token, `/projects/${project.ref}/functions`)
  if (!fns.ok) return { ok: false, error: fns.error, code: codeFromHttp(fns.status) }
  const functions = (Array.isArray(fns.data) ? fns.data : [])
    .map((row) => mapRemoteFunction(asRecord(row) ?? {}))
    .filter((row): row is SupabaseRemoteFunction => Boolean(row))

  return { ok: true, remote: { found: true, project, functions } }
}

function asList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  const rec = asRecord(data)
  if (!rec) return []
  for (const key of ['projects', 'functions', 'data', 'items']) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[]
  }
  return []
}

async function fetchRemoteViaCli(
  cwd: string,
  preferredRef: string | null,
  projectId: string | null
): Promise<
  | { ok: true; remote: SupabaseRemote }
  | { ok: false; error: string; code: SupabaseErrorCode }
> {
  let project: SupabaseRemoteProject | null = null
  const listed = await supabaseCliJson(['projects', 'list'], cwd)
  if (!listed.ok) {
    const authish = /access token|not logged|unauthorized|401|403/i.test(listed.error)
    return { ok: false, error: listed.error, code: authish ? 'auth' : 'network' }
  }
  const rows = asList(listed.data)
    .map((row) => mapRemoteProject(asRecord(row) ?? {}))
    .filter((row): row is SupabaseRemoteProject => Boolean(row))
  if (preferredRef) project = rows.find((row) => row.ref === preferredRef) ?? null
  if (!project && projectId) {
    const needle = projectId.toLowerCase()
    project = rows.find((row) => row.name.toLowerCase() === needle) ?? null
  }
  if (!project && preferredRef) {
    // Linked ref may still be valid even if list omitted it.
    project = {
      ref: preferredRef,
      name: projectId || preferredRef,
      region: null,
      status: 'unknown',
      postgresVersion: null,
      createdAt: null,
      dashboardUrl: supabaseDashboardProjectUrl(preferredRef)
    }
  }
  if (!project) {
    return { ok: false, error: 'Supabase project not found', code: preferredRef ? 'not-found' : 'no-ref' }
  }

  const fnArgs = ['functions', 'list', '--project-ref', project.ref]
  const fns = await supabaseCliJson(fnArgs, cwd)
  if (!fns.ok) return { ok: false, error: fns.error, code: 'network' }
  const functions = asList(fns.data)
    .map((row) => mapRemoteFunction(asRecord(row) ?? {}))
    .filter((row): row is SupabaseRemoteFunction => Boolean(row))
  return { ok: true, remote: { found: true, project, functions } }
}

export async function getSupabaseStatus(
  cwd: string,
  auth: SupabaseAuth,
  query?: SupabaseStatusQuery
): Promise<SupabaseResult<SupabaseStatus>> {
  const scanned = scanSupabaseWorkspace(cwd)
  if (!scanned.ok) return scanned

  const preferredRef = auth.projectRef?.trim() || scanned.data.projectRef
  const peeked = await peekSupabaseAuth(auth.token)

  const status: SupabaseStatus = {
    ...scanned.data,
    projectRef: preferredRef,
    present: isSupabaseWorkspace({ ...scanned.data, projectRef: preferredRef }),
    tokenPresent: peeked.present,
    tokenSource: peeked.source,
    remote: null,
    remoteError: null,
    remoteCode: null,
    functions: mergeSupabaseFunctions(scanned.data.localFunctions, [], preferredRef)
  }

  if (query?.remote === false || !status.present) {
    return { ok: true, data: status }
  }

  const resolved = await resolveSupabaseToken(auth.token)
  if (resolved.token) {
    status.tokenPresent = true
    status.tokenSource = resolved.source
    const remote = await fetchRemote(resolved.token, preferredRef, scanned.data.config?.projectId ?? null)
    if (!remote.ok) {
      status.remoteError = remote.error
      status.remoteCode = remote.code
      return { ok: true, data: status }
    }
    status.remote = remote.remote
    status.projectRef = remote.remote.project?.ref ?? preferredRef
    status.functions = mergeSupabaseFunctions(
      scanned.data.localFunctions,
      remote.remote.functions,
      status.projectRef
    )
    return { ok: true, data: status }
  }

  if (peeked.present || supabaseBin()) {
    const viaCli = await fetchRemoteViaCli(cwd, preferredRef, scanned.data.config?.projectId ?? null)
    if (viaCli.ok) {
      status.tokenPresent = true
      status.tokenSource = 'cli'
      status.remote = viaCli.remote
      status.projectRef = viaCli.remote.project?.ref ?? preferredRef
      status.functions = mergeSupabaseFunctions(
        scanned.data.localFunctions,
        viaCli.remote.functions,
        status.projectRef
      )
      return { ok: true, data: status }
    }
    status.remoteError = viaCli.error
    status.remoteCode = viaCli.code
    if (viaCli.code === 'auth' && !peeked.present) {
      status.tokenPresent = false
      status.tokenSource = null
    }
    return { ok: true, data: status }
  }

  return { ok: true, data: status }
}
