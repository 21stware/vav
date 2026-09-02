import { makePendingCliTab } from './cliPendingLayout.ts'
import { CLI_SURFACE_KEY, type AgentHostSession } from './workspaceCliSurface.ts'
import type { WorkspaceSlice } from './workspaceSlice.ts'
import { cliLiveTab, replaceSurfaceTab } from './workspaceTabs.ts'
import type { TerminalTab } from '../../../shared/types.ts'

export function getCliSurface(slice: WorkspaceSlice | undefined): AgentHostSession | undefined {
  return slice?.agentHostSessions[CLI_SURFACE_KEY]
}

/** Agent main-surface session from agentHostSessions (never user bash tabs). */
export function getAgentHost(slice: WorkspaceSlice, agentId: string): AgentHostSession | undefined {
  return slice.agentHostSessions[agentId]
}

export function patchedCliSurfaceTab(
  s: WorkspaceSlice,
  fromId: string,
  tab: TerminalTab
): Partial<WorkspaceSlice> {
  const surface = getCliSurface(s)
  if (!surface) return {}
  return {
    cliMode: true,
    activeHostAgentId: CLI_SURFACE_KEY,
    agentHostSessions: {
      ...s.agentHostSessions,
      [CLI_SURFACE_KEY]: replaceSurfaceTab(surface, fromId, tab)
    }
  }
}

export function paintedPrimaryAgentPane(
  s: WorkspaceSlice,
  agentId: string,
  preferredId: string,
  title: string
): Partial<WorkspaceSlice> {
  const tab = cliLiveTab(preferredId, agentId, title)
  const surface = getCliSurface(s)
  const pending = surface?.tabs.find((t) => t.pendingCli)
  const nextSurface =
    pending && surface
      ? replaceSurfaceTab(surface, pending.id, tab)
      : surface && surface.tabs.length > 0
        ? { ...surface, activeTabId: preferredId }
        : {
            tabs: [tab],
            layout: { type: 'leaf' as const, tabId: preferredId, weight: 1 },
            activeTabId: preferredId
          }
  return {
    cliMode: true,
    activeHostAgentId: CLI_SURFACE_KEY,
    agentHostSessions: {
      ...s.agentHostSessions,
      [CLI_SURFACE_KEY]: nextSurface,
      [agentId]: {
        tabs: [tab],
        layout: { type: 'leaf', tabId: preferredId, weight: 1 },
        activeTabId: preferredId
      }
    }
  }
}

export function unpaintedPrimaryAgentPane(
  s: WorkspaceSlice,
  agentId: string,
  preferredId: string
): Partial<WorkspaceSlice> {
  const sessions = { ...s.agentHostSessions }
  delete sessions[agentId]
  const surface = sessions[CLI_SURFACE_KEY]
  if (!surface) return { activeHostAgentId: null, agentHostSessions: sessions }
  if (surface.tabs.length === 1 && surface.tabs[0]?.id === preferredId) {
    delete sessions[CLI_SURFACE_KEY]
    return { activeHostAgentId: null, agentHostSessions: sessions }
  }
  if (surface.tabs.some((t) => t.id === preferredId)) {
    const pending = makePendingCliTab()
    sessions[CLI_SURFACE_KEY] = replaceSurfaceTab(surface, preferredId, pending)
    return { activeHostAgentId: CLI_SURFACE_KEY, agentHostSessions: sessions }
  }
  return {
    activeHostAgentId: sessions[CLI_SURFACE_KEY] ? CLI_SURFACE_KEY : null,
    agentHostSessions: sessions
  }
}
