import { create } from 'zustand'
import type { AgentInstallRun } from '@shared/agentInstall'

type InstallRunState = {
  /** Keyed by agent id — at most one install per provider. */
  runs: Record<string, AgentInstallRun>
  setRuns: (runs: AgentInstallRun[]) => void
  load: () => Promise<void>
}

function byAgent(list: AgentInstallRun[]): Record<string, AgentInstallRun> {
  const next: Record<string, AgentInstallRun> = {}
  for (const run of list) {
    if (run?.agentId) next[run.agentId] = run
  }
  return next
}

export const useInstallRunStore = create<InstallRunState>((set) => ({
  runs: {},
  setRuns(list) {
    set({ runs: byAgent(list) })
  },
  async load() {
    const list = window.vav.agents.listInstallRuns
    if (typeof list !== 'function') return
    try {
      const runs = await list()
      if (Array.isArray(runs)) set({ runs: byAgent(runs) })
    } catch {
      // ignore
    }
  }
}))

/** Mirror main's installer state into this window. */
export function installInstallRunBridge(): () => void {
  const onChanged = window.vav.agents.onInstallRunsChanged
  if (typeof onChanged !== 'function') return () => undefined
  const off = onChanged((runs) => {
    useInstallRunStore.getState().setRuns(Array.isArray(runs) ? runs : [])
  })
  void useInstallRunStore.getState().load()
  return off
}
