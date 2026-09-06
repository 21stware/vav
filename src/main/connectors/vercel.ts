import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { isIgnoredName } from '@shared/types'
import type {
  VercelConfig,
  VercelDeployment,
  VercelErrorCode,
  VercelResult,
  VercelStatus,
  VercelStatusQuery,
  VercelTokenSource
} from '@shared/vercel'
import { mapVercelReadyState, vercelDashboardUrl } from '@shared/vercel'
import { isVercelConfigName, parseVercelJsonName, parseVercelProjectJson } from '@shared/vercelConfig'

const API = 'https://api.vercel.com'
const API_TIMEOUT_MS = 20_000
const WALK_DIR_CAP = 80

export interface VercelAuth {
  token: string | null
}

type Scan = Pick<VercelStatus, 'workdir' | 'present' | 'config' | 'extraConfigs'>

function fail<T>(error: string, code: VercelErrorCode): VercelResult<T> {
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
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (isIgnoredName(entry.name) || entry.name === 'node_modules' || entry.name === '.next') continue
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

function scanVercelWorkspace(cwd: string): VercelResult<Scan> {
  const abs = resolve(cwd)
  if (!existsSync(abs)) return fail('Working directory not found', 'not-found')
  const configs = walkFiles(abs, isVercelConfigName)
  const projectFile = join(abs, '.vercel', 'project.json')
  const linked = existsSync(projectFile) && statSync(projectFile).isFile() ? projectFile : null
  const present = configs.length > 0 || Boolean(linked)
  if (!present) return fail('No vercel.json or .vercel/project.json', 'no-config')

  const primary = linked ?? configs[0]!
  const relativePath = relative(abs, primary).replaceAll('\\', '/')
  let projectId: string | null = null
  let orgId: string | null = null
  let projectName: string | null = null
  if (linked) {
    const parsed = parseVercelProjectJson(readText(linked) ?? '')
    projectId = parsed.projectId
    orgId = parsed.orgId
    projectName = parsed.projectName
  }
  if (!projectName && configs[0]) {
    projectName = parseVercelJsonName(readText(configs[0]) ?? '')
  }
  const config: VercelConfig = {
    path: primary,
    relativePath,
    projectName,
    projectId,
    orgId
  }
  return {
    ok: true,
    data: {
      workdir: abs,
      present: true,
      config,
      extraConfigs: Math.max(0, configs.length - (linked ? 0 : 1))
    }
  }
}

function peekVercelAuth(token: string | null): { present: boolean; source: VercelTokenSource } {
  if (token?.trim()) return { present: true, source: 'settings' }
  if ((process.env.VERCEL_TOKEN || '').trim()) return { present: true, source: 'env' }
  return { present: false, source: null }
}

function resolveVercelToken(token: string | null): { token: string | null; source: VercelTokenSource } {
  const settings = token?.trim() || null
  if (settings) return { token: settings, source: 'settings' }
  const env = (process.env.VERCEL_TOKEN || '').trim() || null
  if (env) return { token: env, source: 'env' }
  return { token: null, source: null }
}

type VercelApiDeployment = {
  uid?: string
  id?: string
  name?: string
  url?: string
  readyState?: string
  createdAt?: number
  target?: string | null
}

function mapDeployment(row: VercelApiDeployment): VercelDeployment {
  const id = String(row.uid || row.id || '')
  const url = row.url ? (row.url.startsWith('http') ? row.url : `https://${row.url}`) : null
  return {
    id,
    name: row.name || id,
    status: mapVercelReadyState(row.readyState),
    createdAt: typeof row.createdAt === 'number' ? new Date(row.createdAt).toISOString() : null,
    url,
    target: row.target ?? null
  }
}

async function fetchDeployments(
  token: string,
  projectId: string | null
): Promise<VercelResult<{ recent: VercelDeployment[] }>> {
  const params = new URLSearchParams({ limit: '10' })
  if (projectId) params.set('projectId', projectId)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(`${API}/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctrl.signal
    })
    const json = (await res.json().catch(() => null)) as {
      deployments?: VercelApiDeployment[]
      error?: { message?: string }
    } | null
    if (!res.ok) {
      const msg = json?.error?.message || `Vercel API ${res.status}`
      return fail(msg, res.status === 401 || res.status === 403 ? 'auth' : 'network')
    }
    const recent = (json?.deployments ?? []).map(mapDeployment)
    return { ok: true, data: { recent } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network'
    return fail(message, 'network')
  } finally {
    clearTimeout(timer)
  }
}

export function isVercelWorkspace(cwd: string): boolean {
  return scanVercelWorkspace(cwd).ok
}

export async function getVercelStatus(
  cwd: string,
  auth: VercelAuth,
  query?: VercelStatusQuery
): Promise<VercelResult<VercelStatus>> {
  const scanned = scanVercelWorkspace(cwd)
  if (!scanned.ok) return scanned
  const peeked = peekVercelAuth(auth.token)
  const status: VercelStatus = {
    ...scanned.data,
    tokenPresent: peeked.present,
    tokenSource: peeked.source,
    remote: null,
    remoteError: null,
    remoteCode: null
  }
  if (query?.remote === false) return { ok: true, data: status }

  const resolved = resolveVercelToken(auth.token)
  status.tokenPresent = Boolean(resolved.token)
  status.tokenSource = resolved.source
  if (!resolved.token) return { ok: true, data: status }

  const remote = await fetchDeployments(resolved.token, scanned.data.config?.projectId ?? null)
  if (!remote.ok) {
    status.remoteError = remote.error
    status.remoteCode = remote.code
    return { ok: true, data: status }
  }
  const recent = remote.data.recent
  const name = scanned.data.config?.projectName || recent[0]?.name || 'Vercel'
  status.remote = {
    found: recent.length > 0,
    name,
    dashboardUrl: vercelDashboardUrl(scanned.data.config?.orgId ?? null, scanned.data.config?.projectName ?? name),
    latest: recent[0] ?? null,
    recent
  }
  return { ok: true, data: status }
}
