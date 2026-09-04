import type { ConversationPtyLayouts, TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import type { PtyActivityStatus } from '../../../shared/ipc.ts'
import { ensureBashGroups, reconcileBashGroups } from './bashTabGroups.ts'
import { resolveHydratedCliMode } from './cliSurfaceAuthority.ts'
import { retainInstallMeta } from './retainInstallMeta.ts'
import {
  collectLeaves,
  layoutDirectionKey
} from './workspaceLayout.ts'
import {
  hydratedActiveHostAgentId,
  reconcileAgentHosts,
  type AgentHostSession
} from './workspaceCliSurface.ts'
import {
  agentHostsEqual,
  bashThenAgentTabs,
  tabsEqual,
  userBashTabsOnly,
  withTombstones
} from './workspacePty.ts'

/** Next tools-tray + CLI host map after listing live PTYs. */
export function planHydratedPtySlice(
  s: {
    cliMode: boolean
    activeHostAgentId: string | null
    tabs: TerminalTab[]
    layout: TerminalLayoutNode | null
    bashGroups: ConversationPtyLayouts['bashGroups']
    agentHostSessions: Record<string, AgentHostSession>
    activeTabId: string
  },
  opts: {
    followRemote: boolean
    remoteLayouts: ConversationPtyLayouts
    projected: {
      tabs: TerminalTab[]
      agentHostSessions: Record<string, AgentHostSession>
    }
    status: Record<string, PtyActivityStatus>
  }
): Partial<{
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  bashGroups: ConversationPtyLayouts['bashGroups']
  activeTabId: string
  agentHostSessions: Record<string, AgentHostSession>
  activeHostAgentId: string | null
  cliMode: boolean
}> {
  const cliMode = resolveHydratedCliMode({
    remoteCli: opts.remoteLayouts.cliMode,
    localCli: s.cliMode === true,
    followRemote: opts.followRemote
  })
  const activeHostAgentId = hydratedActiveHostAgentId(
    cliMode,
    s.activeHostAgentId,
    opts.projected.agentHostSessions
  )

  const tabs = bashThenAgentTabs(
    retainInstallMeta(withTombstones(opts.projected.tabs, s.tabs, opts.status), s.tabs)
  )
  const liveBashIds = userBashTabsOnly(tabs).map((t) => t.id)
  const reconciled = reconcileBashGroups(
    opts.remoteLayouts.bashGroups ?? s.bashGroups,
    liveBashIds,
    opts.remoteLayouts.bash ?? s.layout,
    s.activeTabId
  )
  const bashGroups = reconciled.groups
  const groupLayout = reconciled.layout
  const prevGroups = ensureBashGroups(
    s.bashGroups,
    userBashTabsOnly(s.tabs).map((t) => t.id),
    s.layout,
    s.activeTabId
  )
  const agentHostSessions = reconcileAgentHosts(
    s.agentHostSessions,
    opts.projected.agentHostSessions,
    opts.remoteLayouts.agents
  )

  if (
    tabsEqual(s.tabs, tabs) &&
    agentHostsEqual(s.agentHostSessions, agentHostSessions) &&
    s.activeHostAgentId === activeHostAgentId &&
    s.cliMode === cliMode &&
    collectLeaves(s.layout).join(',') === collectLeaves(groupLayout).join(',') &&
    layoutDirectionKey(s.layout) === layoutDirectionKey(groupLayout) &&
    JSON.stringify(prevGroups) === JSON.stringify(bashGroups ?? { order: [], layouts: {}, activeGroupId: '' })
  ) {
    return {}
  }

  const activeTabId = tabs.some((t) => t.id === s.activeTabId)
    ? s.activeTabId
    : (tabs[0]?.id ?? '')

  return {
    tabs,
    layout: groupLayout,
    bashGroups,
    activeTabId,
    agentHostSessions,
    activeHostAgentId,
    cliMode
  }
}
