import type { ConversationPtyLayouts, TerminalLayoutNode, TerminalTab } from '../../../shared/types.ts'
import type { PtyActivityStatus, PtyListResult, PtySessionMeta } from '../../../shared/ipc.ts'
import { layoutDirectionKey, layoutFromTabIds } from './workspaceLayout.ts'
import type { AgentHostSession } from './workspaceCliSurface.ts'

export const AGENT_TAB_ID = 'agent'

export function emptyPtyLayouts(): ConversationPtyLayouts {
  return { bash: null, agents: {}, cliMode: false }
}

export function normalizePtyListResult(raw: PtyListResult | PtySessionMeta[]): PtyListResult {
  if (Array.isArray(raw)) {
    return { sessions: raw, layouts: emptyPtyLayouts() }
  }
  return {
    sessions: raw?.sessions ?? [],
    layouts: raw?.layouts ?? emptyPtyLayouts()
  }
}

export function tabsEqual(a: TerminalTab[], b: TerminalTab[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (
      x.id !== y.id ||
      x.agentId !== y.agentId ||
      x.title !== y.title ||
      !!x.isAgent !== !!y.isAgent ||
      !!x.pendingCli !== !!y.pendingCli ||
      x.purpose !== y.purpose ||
      x.installAgentId !== y.installAgentId
    ) {
      return false
    }
  }
  return true
}

/** Drop any CLI-agent tabs that leaked into the user-bash list (legacy). */
export function userBashTabsOnly(tabs: TerminalTab[]): TerminalTab[] {
  return tabs.filter((t) => !t.agentId || t.agentId === 'vav' || t.isAgent)
}

export function isVavMirrorTab(tab: TerminalTab): boolean {
  return tab.isAgent || tab.agentId === 'vav' || tab.id === AGENT_TAB_ID
}

/** VAV mirror sits after user bash — never pinned to the front of the tray. */
export function bashThenAgentTabs(tabs: TerminalTab[]): TerminalTab[] {
  const bash: TerminalTab[] = []
  const agent: TerminalTab[] = []
  for (const tab of tabs) {
    if (isVavMirrorTab(tab)) agent.push(tab)
    else bash.push(tab)
  }
  return [...bash, ...agent]
}

/** A host session is restorable only if it has panes that launched this agent. */
export function isLiveAgentSession(session: AgentHostSession | undefined, agentId: string): boolean {
  if (!session?.layout || session.tabs.length === 0) return false
  return session.tabs.some((t) => t.agentId === agentId)
}

export function agentHostsEqual(
  a: Record<string, AgentHostSession>,
  b: Record<string, AgentHostSession>
): boolean {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  if (ak.length !== bk.length) return false
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false
    const ha = a[ak[i]!]!
    const hb = b[bk[i]!]!
    if (ha.activeTabId !== hb.activeTabId) return false
    if (!tabsEqual(ha.tabs, hb.tabs)) return false
    if (layoutDirectionKey(ha.layout) !== layoutDirectionKey(hb.layout)) return false
  }
  return true
}

/**
 * Re-insert panes whose process exited but which the user has not closed.
 *
 * Main only reports live PTYs, so a straight projection would yank the tab out
 * from under whatever the dead process last printed. A tombstone keeps its
 * original slot — and its xterm buffer — until the user dismisses it.
 */
export function withTombstones(
  projected: TerminalTab[],
  previous: TerminalTab[],
  status: Record<string, PtyActivityStatus>
): TerminalTab[] {
  const live = new Set(projected.map((t) => t.id))
  const merged = [...projected]
  previous.forEach((tab, index) => {
    if (live.has(tab.id) || status[tab.id] !== 'exited') return
    merged.splice(Math.min(index, merged.length), 0, tab)
  })
  return merged
}

export function omitRecord<T extends Record<string, unknown>>(record: T, key: string): T {
  const next = { ...record }
  delete next[key]
  return next
}

/** Project main-process PTY snapshots into renderer tab/host maps. */
export function projectPtySessions(sessions: PtySessionMeta[]): {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  activeTabId: string
  agentHostSessions: Record<string, AgentHostSession>
} {
  const bashMetas = sessions.filter((s) => !s.agentId || s.agentId === 'vav')
  const agentMetas = sessions.filter((s) => s.agentId && s.agentId !== 'vav')

  const tabs: TerminalTab[] = bashMetas.map((s, index) => {
    const isVavMirror = s.agentId === 'vav' || s.id === AGENT_TAB_ID
    return {
      id: s.id,
      title: isVavMirror ? 'VAV' : s.title || `bash-${index + 1}`,
      isAgent: isVavMirror,
      agentId: isVavMirror ? 'vav' : null,
      purpose: s.purpose,
      installAgentId: s.installAgentId,
      splitWeight: 1
    }
  })
  const ordered = bashThenAgentTabs(tabs)
  const bashIds = ordered.map((t) => t.id)
  const layout = layoutFromTabIds(bashIds)
  const activeTabId = bashIds[0] ?? ''

  const byAgent = new Map<string, PtySessionMeta[]>()
  for (const s of agentMetas) {
    const key = s.agentId!
    const list = byAgent.get(key) ?? []
    list.push(s)
    byAgent.set(key, list)
  }
  const agentHostSessions: Record<string, AgentHostSession> = {}
  for (const [agentId, list] of byAgent) {
    const hostTabs: TerminalTab[] = list.map((s, i) => ({
      id: s.id,
      title: s.title || (i === 0 ? agentId : `${agentId}-${i + 1}`),
      isAgent: false,
      agentId,
      splitWeight: 1
    }))
    const hostLayout = layoutFromTabIds(hostTabs.map((t) => t.id))
    agentHostSessions[agentId] = {
      tabs: hostTabs,
      layout: hostLayout,
      activeTabId: hostTabs[0]?.id ?? ''
    }
  }

  return { tabs: ordered, layout, activeTabId, agentHostSessions }
}
