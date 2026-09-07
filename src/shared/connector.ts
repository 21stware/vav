/**
 * Connectors are first-class bindings to a third-party account/service.
 * Skills teach the model how to work. Plugins (MCP, extra tools) consume
 * connectors. Connectors own credentials, workspace detection, and actions.
 */

export const CONNECTOR_IDS = ['github', 'cloudflare', 'supabase', 'vercel'] as const
export type ConnectorId = (typeof CONNECTOR_IDS)[number]

export type ConnectorCapability = 'status' | 'list' | 'read' | 'write' | 'deploy'

export type ConnectorAuthSource = 'settings' | 'env' | 'cli' | null

export interface ConnectorDescriptor {
  id: ConnectorId
  /** i18n key for the product name */
  labelKey: `connector.${ConnectorId}.name`
  capabilities: ConnectorCapability[]
  trayDefault: boolean
}

export interface ConnectorAuth {
  present: boolean
  source: ConnectorAuthSource
}

export interface ConnectorWorkspaceBinding {
  present: boolean
  label: string | null
  configPath: string | null
}

export interface ConnectorProbe {
  id: ConnectorId
  binding: ConnectorWorkspaceBinding
  auth: ConnectorAuth
  capabilities: ConnectorCapability[]
}

export type ConnectorActionKind = 'deploy'

export interface ConnectorActionRequest {
  connector: ConnectorId
  action: ConnectorActionKind
  cwd: string
  conversationId?: string
  params?: Record<string, unknown>
}

export type ConnectorActionResult =
  | { ok: true; summary: string; url?: string; output?: string }
  | { ok: false; error: string; code?: string }

export const CONNECTOR_CATALOG: readonly ConnectorDescriptor[] = [
  {
    id: 'github',
    labelKey: 'connector.github.name',
    capabilities: ['status', 'list', 'read'],
    trayDefault: true
  },
  {
    id: 'cloudflare',
    labelKey: 'connector.cloudflare.name',
    capabilities: ['status', 'list', 'read', 'deploy'],
    trayDefault: false
  },
  {
    id: 'supabase',
    labelKey: 'connector.supabase.name',
    capabilities: ['status', 'list', 'read', 'deploy'],
    trayDefault: false
  },
  {
    id: 'vercel',
    labelKey: 'connector.vercel.name',
    capabilities: ['status', 'list', 'read', 'deploy'],
    trayDefault: false
  }
]

export function isConnectorId(value: unknown): value is ConnectorId {
  return typeof value === 'string' && (CONNECTOR_IDS as readonly string[]).includes(value)
}

export function connectorDescriptor(id: ConnectorId): ConnectorDescriptor {
  return CONNECTOR_CATALOG.find((row) => row.id === id)!
}

export function connectorCan(id: ConnectorId, capability: ConnectorCapability): boolean {
  return connectorDescriptor(id).capabilities.includes(capability)
}

export function parseConnectorAction(raw: unknown): ConnectorActionKind | null {
  return raw === 'deploy' ? 'deploy' : null
}

export function connectorCliName(id: ConnectorId): string {
  if (id === 'github') return 'gh'
  if (id === 'cloudflare') return 'wrangler'
  if (id === 'supabase') return 'supabase'
  return 'vercel'
}

export type ConnectorLoginStatus = 'idle' | 'running' | 'ok' | 'error' | 'cancelled'

export interface ConnectorAuthRow {
  id: ConnectorId
  present: boolean
  source: ConnectorAuthSource
  settingsPresent: boolean
  cliPresent: boolean
}

export interface ConnectorLoginState {
  connector: ConnectorId | null
  status: ConnectorLoginStatus
  message?: string
}

export interface ConnectorAuthPage {
  rows: ConnectorAuthRow[]
  login: ConnectorLoginState
}
