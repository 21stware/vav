/** Shared Cloudflare workspace status types (main ↔ renderer). */

export type CloudflareKind = 'workers' | 'pages' | 'unknown'

export type CloudflareDeployStatus = 'success' | 'failure' | 'pending' | 'canceled' | 'unknown'

export type CloudflareErrorCode = 'no-config' | 'no-account' | 'auth' | 'not-found' | 'network'

export type CloudflareResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: CloudflareErrorCode }

export interface CloudflareBinding {
  kind: string
  binding: string
  target?: string
}

export interface CloudflareEnvironment {
  name: string
  projectName: string | null
}

export interface CloudflareConfig {
  path: string
  relativePath: string
  format: 'toml' | 'jsonc'
  kind: CloudflareKind
  name: string | null
  accountId: string | null
  compatibilityDate: string | null
  main: string | null
  pagesOutputDir: string | null
  bindings: CloudflareBinding[]
  environments: CloudflareEnvironment[]
}

export interface CloudflareCiHint {
  kind: 'github-action' | 'script'
  label: string
}

export interface CloudflareDeployment {
  id: string
  status: CloudflareDeployStatus
  createdAt: string | null
  url: string | null
  environment: string | null
  source: string | null
}

export interface CloudflareRemote {
  found: boolean
  kind: CloudflareKind
  name: string
  dashboardUrl: string | null
  latest: CloudflareDeployment | null
  recent: CloudflareDeployment[]
}

export interface CloudflareStatus {
  workdir: string
  config: CloudflareConfig | null
  extraConfigs: number
  ciHints: CloudflareCiHint[]
  tokenPresent: boolean
  accountId: string | null
  remote: CloudflareRemote | null
  remoteError: string | null
  remoteCode: CloudflareErrorCode | null
}
