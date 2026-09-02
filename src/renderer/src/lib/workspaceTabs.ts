import type { TerminalTab } from '../../../shared/types.ts'
import { replaceLayoutTabId } from './cliPendingLayout.ts'
import type { AgentHostSession } from './workspaceCliSurface.ts'

export function cliLiveTab(tabId: string, agentId: string, title: string): TerminalTab {
  return {
    id: tabId,
    title,
    isAgent: false,
    agentId,
    pendingCli: false,
    splitWeight: 1
  }
}

/** Swap a surface tab (pending picker → live PTY) and retarget the layout leaf. */
export function replaceSurfaceTab(
  surface: AgentHostSession,
  fromId: string,
  tab: TerminalTab
): AgentHostSession {
  const tabs = surface.tabs
    .filter((t) => t.id !== tab.id)
    .map((t) => (t.id === fromId ? tab : t))
  if (!tabs.some((t) => t.id === tab.id)) tabs.push(tab)
  const layout = surface.layout
    ? (replaceLayoutTabId(surface.layout, fromId, tab.id) ?? {
        type: 'leaf' as const,
        tabId: tab.id,
        weight: 1
      })
    : { type: 'leaf' as const, tabId: tab.id, weight: 1 }
  return { tabs, layout, activeTabId: tab.id }
}
