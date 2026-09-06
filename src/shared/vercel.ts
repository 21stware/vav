/** Shared Vercel workspace status types (main ↔ renderer). */

export type VercelDeployStatus = 'ready' | 'error' | 'building' | 'queued' | 'canceled' | 'unknown'

export type VercelErrorCode = 'no-config' | 'auth' | 'not-found' | 'network'

export type VercelResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: VercelErrorCode }

export type VercelTokenSource = 'settings' | 'env' | 'cli' | null

export interface VercelConfig {
  path: string
  relativePath: string
  projectName: string | null
  projectId: string | null
  orgId: string | null
}

export interface VercelDeployment {
  id: string
  name: string
  status: VercelDeployStatus
  createdAt: string | null
  url: string | null
  target: string | null
}

export interface VercelRemote {
  found: boolean
  name: string
  dashboardUrl: string | null
  latest: VercelDeployment | null
  recent: VercelDeployment[]
}

export interface VercelStatus {
  workdir: string
  present: boolean
  config: VercelConfig | null
  extraConfigs: number
  tokenPresent: boolean
  tokenSource: VercelTokenSource
  remote: VercelRemote | null
  remoteError: string | null
  remoteCode: VercelErrorCode | null
}

export interface VercelStatusQuery {
  remote?: boolean
}

export function mapVercelReadyState(raw: unknown): VercelDeployStatus {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'ready') return 'ready'
  if (s === 'error' || s === 'failed') return 'error'
  if (s === 'building') return 'building'
  if (s === 'queued' || s === 'initializing') return 'queued'
  if (s === 'canceled' || s === 'cancelled') return 'canceled'
  return 'unknown'
}

export function vercelDashboardUrl(orgId: string | null, projectName: string | null): string | null {
  if (!projectName) return null
  if (orgId) return `https://vercel.com/${orgId}/${projectName}`
  return `https://vercel.com/${projectName}`
}
