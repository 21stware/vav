import { agentBinaryCandidates } from '@shared/agentBinary'
import { STRUCTURED_CLI_HOSTS } from '@shared/cliHost'
import { DEFAULT_CLI_AGENTS, type AppSettings } from '@shared/types'
import { warmHostAuthIdentities } from '../agent/hostAuth'
import { ensureLoginPath, probeAgentExecutables } from './loginPath'

/**
 * Boot-time work so the first "start Claude" click is a cache hit:
 * login PATH, binary resolve, auth fingerprints. Never on the click path.
 */
export async function warmAgentLaunchCache(settings: AppSettings): Promise<void> {
  await ensureLoginPath()
  const seen = new Set<string>()
  const specs: Array<{ id: string; candidates: string[] }> = []
  for (const agent of [...DEFAULT_CLI_AGENTS, ...(settings.cliAgents ?? [])]) {
    if (!agent.id || seen.has(agent.id)) continue
    seen.add(agent.id)
    specs.push({
      id: agent.id,
      candidates: agentBinaryCandidates(agent, DEFAULT_CLI_AGENTS)
    })
  }
  if (specs.length > 0) probeAgentExecutables(specs)
  warmHostAuthIdentities([...STRUCTURED_CLI_HOSTS])
}
