import type { CliHostKind } from '../../shared/cliHost.ts'
import { enabledCliAgents, type AgentConfig } from '../../shared/types.ts'

/** Resolve AgentConfig for a host kind from settings. */
export function agentConfigForHost(
  kind: CliHostKind,
  cliAgents: AgentConfig[] | null | undefined
): AgentConfig | null {
  return enabledCliAgents(cliAgents).find((a) => a.id === kind) ?? null
}

/** Overlay the session's VAV account endpoint onto live settings. */
export function mergeVavCredentials<S extends { apiEndpoint: string }>(
  settings: S,
  resolved: { apiKey: string | null; endpoint: string } | null | undefined,
  fallbackKey: string | null
): { apiKey: string | null; settings: S } {
  if (!resolved) return { apiKey: fallbackKey, settings }
  return {
    apiKey: resolved.apiKey,
    settings: {
      ...settings,
      apiEndpoint: resolved.endpoint.trim() || settings.apiEndpoint
    }
  }
}
