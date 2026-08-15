import { useSyncExternalStore } from 'react'
import {
  agentBinaryCandidates,
  agentWebsiteUrl,
  configuredAgentList,
  newlyInstalledCatalogueAgents
} from '@shared/agentBinary'
import { CLI_AGENT_CATALOGUE, DEFAULT_CLI_AGENTS, type AgentConfig } from '@shared/types'
import {
  getAgentBinaryCache,
  markAgentBinaryMissing,
  markAgentBinaryReady
} from './agentBinaryCache'

export type AgentInstallState = 'ready' | 'missing' | 'unknown'

const statusById = new Map<string, AgentInstallState>()
const listeners = new Set<() => void>()
let snap: Record<string, AgentInstallState> = {}

function emit(): void {
  const next: Record<string, AgentInstallState> = {}
  for (const [id, status] of statusById) next[id] = status
  snap = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Record<string, AgentInstallState> {
  return snap
}

export function getAgentInstallStatus(id: string): AgentInstallState {
  const live = statusById.get(id)
  if (live) return live
  const cached = getAgentBinaryCache(id)
  if (cached?.status === 'ready') return 'ready'
  if (cached?.status === 'missing') return 'missing'
  return 'unknown'
}

export function useAgentInstallMap(): Record<string, AgentInstallState> {
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function openAgentWebsite(agent: Pick<AgentConfig, 'installDocsUrl'>): boolean {
  const url = agentWebsiteUrl(agent)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

type ProbeSpec = { id: string; candidates: string[] }

function specsToProbe(configured: AgentConfig[]): ProbeSpec[] {
  const seen = new Set<string>()
  const specs: ProbeSpec[] = []
  for (const agent of [...configured, ...CLI_AGENT_CATALOGUE]) {
    if (!agent.id || seen.has(agent.id)) continue
    seen.add(agent.id)
    specs.push({
      id: agent.id,
      candidates: agentBinaryCandidates(agent, CLI_AGENT_CATALOGUE)
    })
  }
  return specs
}

let inFlight: Promise<void> | null = null
let queuedForce = false
let queuedDiscover = false

async function runProbe(options: { force: boolean; discover: boolean }): Promise<void> {
  const { useSessionStore } = await import('../state/sessionStore')
  const configured = configuredAgentList(
    useSessionStore.getState().settings.cliAgents,
    DEFAULT_CLI_AGENTS
  )
  const specs = specsToProbe(configured)
  let result: Record<string, string | null> = {}
  const probe = window.vav.agents?.probeBinaries
  if (probe) {
    result = await probe(specs, options.force)
  } else if (window.vav.agents?.resolveBinary) {
    for (const spec of specs) {
      result[spec.id] = await window.vav.agents.resolveBinary(spec.candidates, options.force)
    }
  }

  for (const spec of specs) {
    const path = result[spec.id] ?? null
    if (path) {
      statusById.set(spec.id, 'ready')
      markAgentBinaryReady(spec.id, path)
    } else {
      statusById.set(spec.id, 'missing')
      markAgentBinaryMissing(spec.id)
    }
  }
  emit()

  if (!options.discover) return
  const added = newlyInstalledCatalogueAgents(
    configured.map((agent) => agent.id),
    result,
    CLI_AGENT_CATALOGUE
  )
  if (added.length === 0) return
  const next = [...configured, ...added]
  await useSessionStore.getState().updateSettings({ cliAgents: next })
}

/** Re-walk login PATH. `discover` appends newly installed catalogue agents. */
export function refreshAgentInstallStatus(options?: {
  force?: boolean
  discover?: boolean
}): Promise<void> {
  queuedForce ||= options?.force === true
  queuedDiscover ||= options?.discover === true
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      do {
        const force = queuedForce
        const discover = queuedDiscover
        queuedForce = false
        queuedDiscover = false
        await runProbe({ force, discover })
      } while (queuedForce || queuedDiscover)
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}
