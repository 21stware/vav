import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { isIgnoredName } from '@shared/types'
import type {
  CloudflareCiHint,
  CloudflareDeployStatus,
  CloudflareDeployment,
  CloudflareErrorCode,
  CloudflareKind,
  CloudflareRemote,
  CloudflareResult,
  CloudflareStatus,
  CloudflareStatusQuery
} from '@shared/cloudflare'
import {
  isWranglerConfigName,
  parsePackageDeployScripts,
  parseWorkflowCloudflareHints,
  parseWranglerConfig,
  wranglerFormatFromPath
} from '@shared/cloudflareConfig'
import { peekCloudflareAuth, resolveCloudflareToken } from './wranglerAuth'

const API = 'https://api.cloudflare.com/client/v4'
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
  'target'
])

export interface CloudflareAuth {
  token: string | null
  accountId: string | null
}

type CfEnvelope<T> = {
  success?: boolean
  result?: T
  errors?: { message?: string; code?: number }[]
}

function fail<T>(error: string, code: CloudflareErrorCode): CloudflareResult<T> {
  return { ok: false, error, code }
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

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function dashboardUrl(accountId: string | null, kind: CloudflareKind, name: string): string | null {
  if (!accountId || !name) return null
  if (kind === 'pages') return `https://dash.cloudflare.com/${accountId}/pages/view/${name}`
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${name}`
}

function mapPagesStatus(raw: unknown): CloudflareDeployStatus {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'success') return 'success'
  if (s === 'failure' || s === 'failed') return 'failure'
  if (s === 'canceled' || s === 'cancelled') return 'canceled'
  if (s === 'active' || s === 'idle' || s === 'pending') return 'pending'
  return 'unknown'
}

async function cfFetch<T>(
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
    // Workers static-asset scripts return 204 (no module body) on GET /scripts/:name.
    if (res.status === 204) return { ok: true, data: null as T }
    const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null
    if (!res.ok || json?.success === false) {
      const msg =
        json?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
        `Cloudflare API ${res.status}`
      return { ok: false, status: res.status, error: msg }
    }
    if (json == null) {
      return { ok: false, status: res.status, error: `Empty Cloudflare API ${res.status}` }
    }
    return { ok: true, data: json.result as T }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, error: message }
  } finally {
    clearTimeout(timer)
  }
}

async function resolveAccountId(token: string, preferred: string | null): Promise<string | null> {
  if (preferred?.trim()) return preferred.trim()
  const listed = await cfFetch<{ id?: string }[]>(token, '/accounts?per_page=20')
  if (!listed.ok || !Array.isArray(listed.data)) return null
  return listed.data.find((a) => typeof a?.id === 'string' && a.id)?.id ?? null
}

function pagesDeployments(raw: unknown): CloudflareDeployment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row): CloudflareDeployment | null => {
      if (!row || typeof row !== 'object') return null
      const rec = row as Record<string, unknown>
      const stage = rec.latest_stage as Record<string, unknown> | undefined
      const trigger = rec.deployment_trigger as Record<string, unknown> | undefined
      const meta = trigger?.metadata as Record<string, unknown> | undefined
      const id = typeof rec.id === 'string' ? rec.id : typeof rec.short_id === 'string' ? rec.short_id : ''
      if (!id) return null
      return {
        id,
        status: mapPagesStatus(stage?.status ?? rec.latest_stage),
        createdAt: typeof rec.created_on === 'string' ? rec.created_on : null,
        url: typeof rec.url === 'string' ? rec.url : null,
        environment: typeof rec.environment === 'string' ? rec.environment : null,
        source:
          typeof meta?.branch === 'string'
            ? meta.branch
            : typeof trigger?.type === 'string'
              ? trigger.type
              : null
      }
    })
    .filter((row): row is CloudflareDeployment => Boolean(row))
}

function workersDeployments(raw: unknown): CloudflareDeployment[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { deployments?: unknown }).deployments)
      ? (raw as { deployments: unknown[] }).deployments
      : []
  return list
    .map((row, index): CloudflareDeployment | null => {
      if (!row || typeof row !== 'object') return null
      const rec = row as Record<string, unknown>
      const id = typeof rec.id === 'string' ? rec.id : `deploy-${index}`
      return {
        id,
        status: 'success',
        createdAt: typeof rec.created_on === 'string' ? rec.created_on : null,
        url: null,
        environment: typeof rec.strategy === 'string' ? rec.strategy : 'production',
        source: typeof rec.source === 'string' ? rec.source : null
      }
    })
    .filter((row): row is CloudflareDeployment => Boolean(row))
}

async function fetchRemote(
  token: string,
  accountId: string,
  name: string,
  preferred: CloudflareKind
): Promise<
  | { ok: true; remote: CloudflareRemote }
  | { ok: false; error: string; code: CloudflareErrorCode }
> {
  const tryPages = preferred !== 'workers'
  const order: CloudflareKind[] = tryPages ? ['pages', 'workers'] : ['workers', 'pages']
  let lastNotFound: string | null = null
  for (const kind of order) {
    if (kind === 'pages') {
      const project = await cfFetch<Record<string, unknown>>(
        token,
        `/accounts/${accountId}/pages/projects/${encodeURIComponent(name)}`
      )
      if (!project.ok) {
        if (project.status === 401 || project.status === 403) {
          return { ok: false, error: project.error, code: 'auth' }
        }
        if (project.status === 404) {
          lastNotFound = project.error
          continue
        }
        return { ok: false, error: project.error, code: 'network' }
      }
      const deploys = await cfFetch<unknown>(
        token,
        `/accounts/${accountId}/pages/projects/${encodeURIComponent(name)}/deployments?per_page=8`
      )
      const recent = deploys.ok ? pagesDeployments(deploys.data) : []
      const canonical = latestFromProject(project.data ?? {}) ?? recent[0] ?? null
      return {
        ok: true,
        remote: {
          found: true,
          kind: 'pages',
          name,
          dashboardUrl: dashboardUrl(accountId, 'pages', name),
          latest: canonical,
          recent
        }
      }
    }
    const script = await cfFetch<Record<string, unknown>>(
      token,
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`
    )
    if (!script.ok) {
      if (script.status === 401 || script.status === 403) {
        return { ok: false, error: script.error, code: 'auth' }
      }
      if (script.status === 404) {
        lastNotFound = script.error
        continue
      }
      return { ok: false, error: script.error, code: 'network' }
    }
    const deploys = await cfFetch<unknown>(
      token,
      `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}/deployments`
    )
    const recent = deploys.ok ? workersDeployments(deploys.data) : []
    const scriptData = script.data && typeof script.data === 'object' ? script.data : {}
    const modified = typeof scriptData.modified_on === 'string' ? scriptData.modified_on : null
    const latest =
      recent[0] ??
      (modified
        ? {
            id: 'current',
            status: 'success' as const,
            createdAt: modified,
            url: null,
            environment: 'production',
            source: null
          }
        : null)
    return {
      ok: true,
      remote: {
        found: true,
        kind: 'workers',
        name,
        dashboardUrl: dashboardUrl(accountId, 'workers', name),
        latest,
        recent
      }
    }
  }
  return { ok: false, error: lastNotFound || 'Project not found', code: 'not-found' }
}

function latestFromProject(project: Record<string, unknown> | null | undefined): CloudflareDeployment | null {
  if (!project) return null
  const latest = project.latest_deployment
  if (!latest || typeof latest !== 'object') return null
  const rec = latest as Record<string, unknown>
  const stage = rec.latest_stage as Record<string, unknown> | undefined
  const id = typeof rec.id === 'string' ? rec.id : typeof rec.short_id === 'string' ? rec.short_id : ''
  if (!id) return null
  return {
    id,
    status: mapPagesStatus(stage?.status),
    createdAt: typeof rec.created_on === 'string' ? rec.created_on : null,
    url: typeof rec.url === 'string' ? rec.url : typeof project.canonical_deployment === 'object'
      ? null
      : typeof project.subdomain === 'string'
        ? `https://${project.subdomain}`
        : null,
    environment: typeof rec.environment === 'string' ? rec.environment : 'production',
    source: null
  }
}

function collectCiHints(root: string): CloudflareCiHint[] {
  const hints: CloudflareCiHint[] = []
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    const scripts = parsePackageDeployScripts(readText(pkgPath) ?? '')
    for (const name of scripts) hints.push({ kind: 'script', label: `npm run ${name}` })
  }
  const workflows = join(root, '.github', 'workflows')
  if (existsSync(workflows)) {
    let files: string[] = []
    try {
      files = readdirSync(workflows)
    } catch {
      files = []
    }
    for (const name of files) {
      if (!/\.ya?ml$/i.test(name)) continue
      const labels = parseWorkflowCloudflareHints(readText(join(workflows, name)) ?? '', name)
      for (const label of labels) hints.push({ kind: 'github-action', label })
    }
  }
  return hints
}

export function scanCloudflareWorkspace(
  cwd: string
): CloudflareResult<Pick<CloudflareStatus, 'workdir' | 'config' | 'extraConfigs' | 'ciHints'>> {
  const abs = resolve(cwd)
  try {
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      return fail('Working directory not found', 'network')
    }
  } catch {
    return fail('Working directory not found', 'network')
  }

  const configPaths = walkFiles(abs, isWranglerConfigName).filter((p) => wranglerFormatFromPath(p))
  configPaths.sort((a, b) => a.length - b.length || a.localeCompare(b))
  const parsed = configPaths
    .map((path) => {
      const text = readText(path)
      if (text == null) return null
      return parseWranglerConfig(text, path, relative(abs, path) || basename(path))
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))

  return {
    ok: true,
    data: {
      workdir: abs,
      config: parsed[0] ?? null,
      extraConfigs: Math.max(0, parsed.length - 1),
      ciHints: collectCiHints(abs)
    }
  }
}

export async function getCloudflareStatus(
  cwd: string,
  auth: CloudflareAuth,
  query?: CloudflareStatusQuery
): Promise<CloudflareResult<CloudflareStatus>> {
  try {
    return await loadCloudflareStatus(cwd, auth, query)
  } catch (err) {
    const scanned = scanCloudflareWorkspace(cwd)
    const message = err instanceof Error ? err.message : String(err)
    if (scanned.ok) {
      const peeked = peekCloudflareAuth(auth.token)
      return {
        ok: true,
        data: {
          ...scanned.data,
          tokenPresent: peeked.present,
          tokenSource: peeked.source,
          accountId: auth.accountId,
          remote: null,
          remoteError: message,
          remoteCode: 'network'
        }
      }
    }
    return fail(message, 'network')
  }
}

async function loadCloudflareStatus(
  cwd: string,
  auth: CloudflareAuth,
  query?: CloudflareStatusQuery
): Promise<CloudflareResult<CloudflareStatus>> {
  const scanned = scanCloudflareWorkspace(cwd)
  if (!scanned.ok) return scanned

  const envAccount = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim() || null
  const preferredAccount = auth.accountId?.trim() || scanned.data.config?.accountId || envAccount
  const peeked = peekCloudflareAuth(auth.token)

  const status: CloudflareStatus = {
    ...scanned.data,
    tokenPresent: peeked.present,
    tokenSource: peeked.source,
    accountId: preferredAccount,
    remote: null,
    remoteError: null,
    remoteCode: null
  }

  if (query?.remote === false) return { ok: true, data: status }

  const resolved = await resolveCloudflareToken(auth.token)
  status.tokenPresent = Boolean(resolved.token)
  status.tokenSource = resolved.source
  const token = resolved.token
  if (!token) return { ok: true, data: status }

  const accountId = await resolveAccountId(token, preferredAccount)
  status.accountId = accountId
  if (!accountId) {
    status.remoteError = 'No Cloudflare account id'
    status.remoteCode = 'no-account'
    return { ok: true, data: status }
  }
  const config = scanned.data.config
  if (!config?.name) return { ok: true, data: status }

  const remote = await fetchRemote(token, accountId, config.name, config.kind)
  if (!remote.ok) {
    status.remoteError = remote.error
    status.remoteCode = remote.code
    return { ok: true, data: status }
  }
  status.remote = remote.remote
  return { ok: true, data: status }
}
