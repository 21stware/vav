import type { AgentConfig } from './types'

/** Deduped PATH names / absolute paths to try for one agent. */
export function agentBinaryCandidates(
  agent: Pick<AgentConfig, 'id' | 'binaryPath' | 'binaryCandidates'>,
  catalogue: Array<Pick<AgentConfig, 'id' | 'binaryPath' | 'binaryCandidates'>> = []
): string[] {
  const builtin = catalogue.find((row) => row.id === agent.id)
  return [
    ...new Set(
      [
        agent.binaryPath,
        ...(agent.binaryCandidates ?? []),
        builtin?.binaryPath,
        ...(builtin?.binaryCandidates ?? [])
      ].filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    )
  ]
}

export function cloneAgentConfig(agent: AgentConfig): AgentConfig {
  return {
    ...agent,
    envVars: { ...agent.envVars },
    defaultArgs: [...(agent.defaultArgs ?? [])],
    binaryCandidates: agent.binaryCandidates ? [...agent.binaryCandidates] : undefined
  }
}

/** Official install / product page — used when the CLI is not on PATH. */
export function agentWebsiteUrl(agent: Pick<AgentConfig, 'installDocsUrl'>): string | null {
  const url = agent.installDocsUrl?.trim() ?? ''
  return url && /^https?:\/\//i.test(url) ? url : null
}

/**
 * Catalogue rows that are now on PATH but missing from the user's provider
 * list (first-boot seed only included what was installed then).
 */
export function newlyInstalledCatalogueAgents(
  presentIds: Iterable<string>,
  installedById: Record<string, string | null | undefined>,
  catalogue: AgentConfig[]
): AgentConfig[] {
  const present = new Set(presentIds)
  const added: AgentConfig[] = []
  for (const agent of catalogue) {
    if (present.has(agent.id)) continue
    if (!installedById[agent.id]) continue
    added.push(
      cloneAgentConfig({
        ...agent,
        enabled: true,
        builtin: true
      })
    )
  }
  return added
}

export function configuredAgentList(
  cliAgents: AgentConfig[] | null | undefined,
  fallback: AgentConfig[]
): AgentConfig[] {
  if (Array.isArray(cliAgents) && cliAgents.length > 0) {
    return cliAgents.map((agent) => cloneAgentConfig(agent))
  }
  return fallback.map((agent) => cloneAgentConfig(agent))
}
