/**
 * Third-party connectors: detect a workspace, resolve auth, read status,
 * and (later) run actions like deploy / invoke.
 *
 * GitHub / Cloudflare / Supabase already have status services. This module
 * is the shared catalogue so trays, agent tools, and vavd share one list.
 */

export type ConnectorId = 'github' | 'cloudflare' | 'supabase' | 'vercel'

export type ConnectorActionId = 'status' | 'deploy' | 'invoke' | 'merge'

export interface ConnectorDetect {
  id: ConnectorId
  present: boolean
  /** Config / project label when we can name it without a network call. */
  label: string | null
  configPath: string | null
}

export interface ConnectorDescriptor {
  id: ConnectorId
  /** Human name (GitHub, Cloudflare, …). */
  title: string
  /** What “implement” means for this connector. */
  implements: string
  actions: ConnectorActionId[]
}

export const CONNECTORS: readonly ConnectorDescriptor[] = [
  {
    id: 'github',
    title: 'GitHub',
    implements: 'PRs, Actions, Releases, Pages',
    actions: ['status', 'merge']
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare',
    implements: 'Workers / Pages hosting',
    actions: ['status', 'deploy']
  },
  {
    id: 'supabase',
    title: 'Supabase',
    implements: 'Project health + Edge Functions',
    actions: ['status', 'deploy', 'invoke']
  },
  {
    id: 'vercel',
    title: 'Vercel',
    implements: 'Web hosting / preview URLs',
    actions: ['status', 'deploy']
  }
]

export function connectorById(id: string): ConnectorDescriptor | null {
  return CONNECTORS.find((row) => row.id === id) ?? null
}
