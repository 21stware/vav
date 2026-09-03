import type { ConversationPtyLayouts, TerminalLayoutNode, TerminalSplitAxis, TerminalTab } from '../../../shared/types.ts'
import type { PtyActivityStatus, PtyCreateOptions, PtyListResult, PtySessionMeta } from '../../../shared/ipc.ts'
import { collectLeaves, layoutDirectionKey, layoutFromTabIds, removeLeaf, splitLeaf } from './workspaceLayout.ts'
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

/** Live PTY statuses plus exited tombstones the user has not dismissed. */
export function mergePtyStatusPreservingExited(
  current: Record<string, PtyActivityStatus>,
  sessions: Array<{ id: string; status: PtyActivityStatus }>
): { next: Record<string, PtyActivityStatus>; unchanged: boolean } {
  const next: Record<string, PtyActivityStatus> = {}
  for (const meta of sessions) next[meta.id] = meta.status
  for (const [tabId, status] of Object.entries(current)) {
    if (status === 'exited' && !(tabId in next)) next[tabId] = status
  }
  const keys = Object.keys(next)
  const unchanged =
    keys.length === Object.keys(current).length &&
    keys.every((tabId) => current[tabId] === next[tabId])
  return { next, unchanged }
}

/** Drop leaked CLI-agent tabs from the tools-tray bash list after activate. */
export function toolsTrayAfterScrubbingAgentTabs(s: {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  activeTabId: string
}): { tabs: TerminalTab[]; layout: TerminalLayoutNode | null; activeTabId: string } {
  const bash = userBashTabsOnly(s.tabs)
  const layoutStillValid =
    s.layout && collectLeaves(s.layout).every((leaf) => bash.some((t) => t.id === leaf))
  return {
    tabs: bash,
    layout: layoutStillValid ? s.layout : bash[0] ? { type: 'leaf', tabId: bash[0].id, weight: 1 } : null,
    activeTabId: bash.some((t) => t.id === s.activeTabId) ? s.activeTabId : (bash[0]?.id ?? '')
  }
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

/** Snapshot bash + agent layouts for main (`pty.setLayouts`). */
export function buildConversationPtyLayouts(slice: {
  layout: TerminalLayoutNode | null
  cliMode: boolean
  agentHostSessions: Record<string, { layout: TerminalLayoutNode | null }>
}): ConversationPtyLayouts {
  const agents: ConversationPtyLayouts['agents'] = {}
  for (const [agentId, host] of Object.entries(slice.agentHostSessions)) {
    agents[agentId] = host.layout
  }
  return {
    bash: slice.layout,
    agents,
    cliMode: slice.cliMode === true
  }
}

export type BashPaneExtras = {
  title?: string
  purpose?: TerminalTab['purpose']
  installAgentId?: string
}

/** First tools-tray bash pane: single leaf, keep install labels. */
export function planFirstBashPane(
  tabs: TerminalTab[],
  tabId: string,
  extras?: BashPaneExtras
): { tabs: TerminalTab[]; layout: TerminalLayoutNode; activeTabId: string } {
  return {
    tabs: bashThenAgentTabs(
      userBashTabsOnly(tabs).map((t) =>
        t.id === tabId
          ? {
              ...t,
              title: extras?.title?.trim() || t.title,
              purpose: extras?.purpose ?? t.purpose,
              installAgentId: extras?.installAgentId ?? t.installAgentId
            }
          : t
      )
    ),
    layout: { type: 'leaf', tabId, weight: 1 },
    activeTabId: tabId
  }
}

/** Split tools-tray bash after create; drop a hydrate-race duplicate id. */
export function planBashSplit(
  s: { tabs: TerminalTab[]; layout: TerminalLayoutNode | null },
  opts: {
    focusId: string
    newTabId: string
    axis: TerminalSplitAxis
    extras?: BashPaneExtras
  }
): { tabs: TerminalTab[]; layout: TerminalLayoutNode; activeTabId: string } {
  let baseTabs = userBashTabsOnly(s.tabs).filter((t) => t.id !== opts.newTabId)
  let layout = s.layout ?? { type: 'leaf', tabId: opts.focusId, weight: 1 }
  if (collectLeaves(layout).includes(opts.newTabId)) {
    layout = removeLeaf(layout, opts.newTabId) ?? {
      type: 'leaf',
      tabId: opts.focusId,
      weight: 1
    }
  }
  const focusInLayout = collectLeaves(layout).includes(opts.focusId)
  const splitAt = focusInLayout ? opts.focusId : (collectLeaves(layout)[0] ?? opts.focusId)
  const nextLayout = splitLeaf(layout, splitAt, opts.axis, opts.newTabId)
  if (!baseTabs.some((t) => t.id === opts.newTabId)) {
    baseTabs = [
      ...baseTabs,
      {
        id: opts.newTabId,
        title: opts.extras?.title?.trim() || `bash-${baseTabs.length + 1}`,
        isAgent: false,
        agentId: null,
        purpose: opts.extras?.purpose,
        installAgentId: opts.extras?.installAgentId,
        splitWeight: 1
      }
    ]
  } else if (opts.extras?.purpose === 'install' || opts.extras?.title) {
    baseTabs = baseTabs.map((t) =>
      t.id === opts.newTabId
        ? {
            ...t,
            title: opts.extras?.title?.trim() || t.title,
            purpose: opts.extras?.purpose ?? t.purpose,
            installAgentId: opts.extras?.installAgentId ?? t.installAgentId
          }
        : t
    )
  }
  return {
    tabs: bashThenAgentTabs(baseTabs),
    layout: nextLayout,
    activeTabId: opts.newTabId
  }
}

/** Explicit CLI agent id (not VAV / bash) owns an agent-host PTY. */
export function isCliAgentHostId(agentIdOverride: string | null | undefined): agentIdOverride is string {
  return typeof agentIdOverride === 'string' && agentIdOverride.length > 0 && agentIdOverride !== 'vav'
}

/** Options for `pty.create` — agent binary vs plain bash. */
export function ptyCreateOptions(opts: {
  preferredId?: string
  agent?: {
    binaryPath?: string | null
    defaultArgs?: string[]
    binaryCandidates?: string[]
    envVars?: Record<string, string>
    id: string
    name: string
  } | null
  launchContext?: string | null
  contextLaunchStrategy?: PtyCreateOptions['contextLaunchStrategy']
  extras?: BashPaneExtras & {
    sessionTitle?: string | null
    resumeCursor?: PtyCreateOptions['resumeCursor']
  }
}): PtyCreateOptions {
  const preferred = opts.preferredId ? { preferredId: opts.preferredId } : {}
  if (opts.agent?.binaryPath) {
    return {
      ...preferred,
      command: opts.agent.binaryPath,
      args: opts.agent.defaultArgs ?? [],
      commandCandidates: opts.agent.binaryCandidates,
      env: opts.agent.envVars,
      launchContext: opts.launchContext?.trim() || null,
      contextLaunchStrategy: opts.contextLaunchStrategy,
      agentId: opts.agent.id,
      title: opts.extras?.sessionTitle?.trim() || opts.agent.name,
      resumeCursor: opts.extras?.resumeCursor ?? null,
      sessionTitle: opts.extras?.sessionTitle ?? null
    }
  }
  return {
    ...preferred,
    agentId: null,
    title: opts.extras?.title?.trim() || 'bash',
    pinTitle: opts.extras?.purpose === 'install',
    purpose: opts.extras?.purpose,
    installAgentId: opts.extras?.installAgentId
  }
}

/** Append a user bash tab after spawn (agent hosts skip this). */
export function planAppendUserBashTab(
  tabs: TerminalTab[],
  tabId: string,
  extras: BashPaneExtras | undefined,
  index: number
): { tabs: TerminalTab[]; activeTabId: string } {
  return {
    tabs: bashThenAgentTabs([
      ...userBashTabsOnly(tabs),
      {
        id: tabId,
        title: extras?.title?.trim() || `bash-${index}`,
        isAgent: false,
        agentId: null,
        purpose: extras?.purpose,
        installAgentId: extras?.installAgentId,
        splitWeight: 1
      }
    ]),
    activeTabId: tabId
  }
}

/** First-time VAV mirror tab in the tools tray; layout leaf so TerminalPanel paints. */
export function ensureVavAgentTabPatch(s: {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
}): { tabs: TerminalTab[]; activeTabId: string; layout: TerminalLayoutNode } {
  return {
    tabs: bashThenAgentTabs([
      ...s.tabs,
      {
        id: AGENT_TAB_ID,
        title: 'VAV',
        isAgent: true,
        agentId: 'vav',
        splitWeight: 1
      }
    ]),
    activeTabId: AGENT_TAB_ID,
    layout: s.layout ?? { type: 'leaf', tabId: AGENT_TAB_ID, weight: 1 }
  }
}

/** Close a user bash pane; keep remaining tabs and pick a new active leaf. */
export function closeBashTabSlicePatch(
  s: { tabs: TerminalTab[]; layout: TerminalLayoutNode | null; activeTabId: string },
  tabId: string
): { tabs: TerminalTab[]; layout: TerminalLayoutNode | null; activeTabId: string } {
  const tabs = bashThenAgentTabs(userBashTabsOnly(s.tabs).filter((t) => t.id !== tabId))
  const layout = s.layout ? removeLeaf(s.layout, tabId) : null
  const nextActive = s.activeTabId === tabId ? (tabs[0]?.id ?? '') : s.activeTabId
  return {
    tabs,
    layout,
    activeTabId: nextActive
  }
}

/** Stamp one PTY tab's activity; null when the status is already current. */
export function ptyTabStatusPatch(
  ptyStatus: Record<string, Record<string, PtyActivityStatus>>,
  conversationId: string,
  tabId: string,
  status: PtyActivityStatus
): { ptyStatus: Record<string, Record<string, PtyActivityStatus>> } | null {
  const forConversation = ptyStatus[conversationId]
  if (forConversation?.[tabId] === status) return null
  return {
    ptyStatus: {
      ...ptyStatus,
      [conversationId]: { ...forConversation, [tabId]: status }
    }
  }
}

/** Drop a closed tab's status so the next hydrate cannot resurrect a tombstone. */
export function omitPtyTabStatusPatch(
  ptyStatus: Record<string, Record<string, PtyActivityStatus>>,
  conversationId: string,
  tabId: string
): { ptyStatus: Record<string, Record<string, PtyActivityStatus>> } | null {
  const forConversation = ptyStatus[conversationId]
  if (!forConversation || !(tabId in forConversation)) return null
  return { ptyStatus: { ...ptyStatus, [conversationId]: omitRecord(forConversation, tabId) } }
}
