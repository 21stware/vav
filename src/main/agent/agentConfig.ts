import type { CliHostKind } from '../../shared/cliHost.ts'
import { enabledCliAgents, type AgentConfig } from '../../shared/types.ts'

/** Resolve AgentConfig for a host kind from settings. */
export function agentConfigForHost(
  kind: CliHostKind,
  cliAgents: AgentConfig[] | null | undefined
): AgentConfig | null {
  return enabledCliAgents(cliAgents).find((a) => a.id === kind) ?? null
}
