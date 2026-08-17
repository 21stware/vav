/** Shared Supabase workspace status types (main ↔ renderer). */

export type SupabaseProjectStatus =
  | 'healthy'
  | 'unhealthy'
  | 'coming-up'
  | 'paused'
  | 'unknown'

export type SupabaseFunctionStatus =
  | 'active'
  | 'unhealthy'
  | 'coming-up'
  | 'removed'
  | 'local'
  | 'unknown'

export type SupabaseErrorCode = 'no-config' | 'no-ref' | 'auth' | 'not-found' | 'network'

export type SupabaseTokenSource = 'settings' | 'env' | 'cli' | null

export type SupabaseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: SupabaseErrorCode }

export interface SupabaseConfig {
  path: string
  relativePath: string
  /** `project_id` from config.toml — a local label, not the cloud ref. */
  projectId: string | null
}

export interface SupabaseLocalFunction {
  slug: string
  path: string
  relativePath: string
  verifyJwt: boolean | null
}

export interface SupabaseRemoteFunction {
  id: string | null
  slug: string
  name: string
  status: SupabaseFunctionStatus
  version: number | null
  createdAt: string | null
  updatedAt: string | null
  verifyJwt: boolean | null
  importMap: boolean | null
  entrypoint: string | null
}

export interface SupabaseFunction {
  slug: string
  name: string
  status: SupabaseFunctionStatus
  version: number | null
  updatedAt: string | null
  verifyJwt: boolean | null
  importMap: boolean | null
  entrypoint: string | null
  local: boolean
  remote: boolean
  localPath: string | null
  localRelativePath: string | null
  invokeUrl: string | null
}

export interface SupabaseRemoteProject {
  ref: string
  name: string
  region: string | null
  status: SupabaseProjectStatus
  postgresVersion: string | null
  createdAt: string | null
  dashboardUrl: string
}

export interface SupabaseRemote {
  found: boolean
  project: SupabaseRemoteProject | null
  functions: SupabaseRemoteFunction[]
}

export interface SupabaseStatus {
  workdir: string
  present: boolean
  config: SupabaseConfig | null
  extraConfigs: number
  projectRef: string | null
  localFunctions: SupabaseLocalFunction[]
  tokenPresent: boolean
  tokenSource: SupabaseTokenSource
  remote: SupabaseRemote | null
  remoteError: string | null
  remoteCode: SupabaseErrorCode | null
  functions: SupabaseFunction[]
}

export interface SupabaseStatusQuery {
  /** When false, skip the Management API and return local scan only. */
  remote?: boolean
}

export function supabaseDashboardProjectUrl(ref: string): string {
  return `https://supabase.com/dashboard/project/${encodeURIComponent(ref)}`
}

export function supabaseDashboardFunctionsUrl(ref: string): string {
  return `${supabaseDashboardProjectUrl(ref)}/functions`
}

export function supabaseDashboardFunctionUrl(ref: string, slug: string): string {
  return `${supabaseDashboardFunctionsUrl(ref)}/${encodeURIComponent(slug)}`
}

export function supabaseFunctionInvokeUrl(ref: string, slug: string): string {
  return `https://${ref}.supabase.co/functions/v1/${encodeURIComponent(slug)}`
}

export function mapSupabaseProjectStatus(raw: string | null | undefined): SupabaseProjectStatus {
  const value = String(raw ?? '').toUpperCase()
  if (value === 'ACTIVE_HEALTHY') return 'healthy'
  if (value === 'ACTIVE_UNHEALTHY' || value === 'INIT_FAILED' || value === 'RESTORING_FAILED') {
    return 'unhealthy'
  }
  if (
    value === 'COMING_UP' ||
    value === 'RESTORING' ||
    value === 'UPGRADING' ||
    value === 'RESTARTING' ||
    value === 'RESIZING'
  ) {
    return 'coming-up'
  }
  if (value === 'INACTIVE' || value === 'PAUSING' || value === 'GOING_DOWN') return 'paused'
  return 'unknown'
}

export function mapSupabaseFunctionStatus(raw: string | null | undefined): SupabaseFunctionStatus {
  const value = String(raw ?? '').toUpperCase()
  if (value === 'ACTIVE') return 'active'
  if (value === 'ACTIVE_UNHEALTHY') return 'unhealthy'
  if (value === 'COMING_UP') return 'coming-up'
  if (value === 'REMOVED') return 'removed'
  return 'unknown'
}

export function mergeSupabaseFunctions(
  local: SupabaseLocalFunction[],
  remote: SupabaseRemoteFunction[],
  projectRef: string | null
): SupabaseFunction[] {
  const bySlug = new Map<string, SupabaseFunction>()
  for (const row of local) {
    bySlug.set(row.slug, {
      slug: row.slug,
      name: row.slug,
      status: 'local',
      version: null,
      updatedAt: null,
      verifyJwt: row.verifyJwt,
      importMap: null,
      entrypoint: null,
      local: true,
      remote: false,
      localPath: row.path,
      localRelativePath: row.relativePath,
      invokeUrl: projectRef ? supabaseFunctionInvokeUrl(projectRef, row.slug) : null
    })
  }
  for (const row of remote) {
    const prev = bySlug.get(row.slug)
    bySlug.set(row.slug, {
      slug: row.slug,
      name: row.name || row.slug,
      status: row.status,
      version: row.version,
      updatedAt: row.updatedAt,
      verifyJwt: row.verifyJwt ?? prev?.verifyJwt ?? null,
      importMap: row.importMap,
      entrypoint: row.entrypoint ?? prev?.entrypoint ?? null,
      local: Boolean(prev?.local),
      remote: true,
      localPath: prev?.localPath ?? null,
      localRelativePath: prev?.localRelativePath ?? null,
      invokeUrl: projectRef ? supabaseFunctionInvokeUrl(projectRef, row.slug) : null
    })
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

export function isSupabaseWorkspace(status: Pick<SupabaseStatus, 'config' | 'projectRef' | 'localFunctions'>): boolean {
  return Boolean(status.config || status.projectRef || status.localFunctions.length > 0)
}
