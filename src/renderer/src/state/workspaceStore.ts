import { create } from 'zustand'
import {
  contextLaunchStrategyForAgent,
  encodePtyPaste
} from '@shared/agentContextInject'

/** Last prompt-paste fingerprint per PTY tab — avoids stacking identical injects. */
const lastInjectFingerprint = new Map<string, string>()
/** Pending delayed inject timers keyed by conversation id. */
const pendingInjectTimers = new Map<string, number>()
import type { PtyActivityStatus, PtyListResult, PtySessionMeta } from '@shared/ipc'
import { retainInstallMeta } from '../lib/retainInstallMeta'
import {
  adoptRemotePendingTabs,
  CLI_PENDING_PREFIX,
  pendingTabFromId,
  replaceLayoutTabId
} from '../lib/cliPendingLayout'
import {
  collectLeaves,
  layoutDirectionKey,
  layoutFromTabIds,
  layoutHasColumn,
  pickCliLayoutBase,
  reconcileLayout,
  removeLeaf,
  scoreLayoutLeaves,
  splitLeaf
} from '../lib/workspaceLayout'
import { resolveSpawnGrid } from '../lib/spawnGrid'
import { resolveHydratedCliMode } from '../lib/cliSurfaceAuthority'
import { isCompanionSessionShell } from '../lib/windowKind'
import {
  disposeTerminal,
  markTerminalProcessExited,
  resetTerminalForNewProcess
} from '../lib/terminalRegistryHandle'
import {
  enabledCliAgents,
  normalizeFileSortKey,
  type AgentConfig,
  type ConversationPtyLayouts,
  type FileEntry,
  type FileSortKey,
  type ProviderResumeCursor,
  type TerminalLayoutNode,
  type TerminalSplitAxis,
  type TerminalTab
} from '@shared/types'
import { longEdgeSplitAxis } from '@shared/cliSessionHistory'
import {
  shouldAutoAssignSingleCliAgent,
  type SkipCliPickerReason
} from '@shared/skipCliPicker'
import { focusedCliPaneId, measureCliPaneRects } from '../lib/cliPaneNavigate'

export type { TerminalLayoutNode, TerminalSplitAxis }

/**
 * After ENOENT on a workspace root, remove it from recent/pinned lists.
 * Uses settings.update so main broadcasts the pruned list to all windows.
 */
import {
  isLocalMachine,
  normalizeMachineId,
  parseWorkspaceRefList,
  sameWorkspaceRef,
  workspaceRef
} from '@shared/workspaceHost'

async function forgetMissingWorkspaceDir(path: string, machineId?: string | null): Promise<void> {
  try {
    const { useSessionStore } = await import('./sessionStore')
    const settings = useSessionStore.getState().settings
    const recent = parseWorkspaceRefList(settings.recentWorkspaceDirectories)
    const pinned = settings.pinnedWorkspaceDirectories ?? []
    const drop = workspaceRef(path, machineId)
    const nextRecent = recent.filter((entry) =>
      machineId == null || machineId === ''
        ? entry.path !== path
        : !sameWorkspaceRef(entry, drop)
    )
    if (nextRecent.length === recent.length && !pinned.includes(path)) return
    await window.vav.settings.update({
      recentWorkspaceDirectories: nextRecent,
      pinnedWorkspaceDirectories: pinned.filter((entry) => entry !== path)
    })
  } catch {
    // settings may be mid-bootstrap
  }
}

/**
 * When settings say so and exactly one CLI agent is enabled, launch it into
 * a pending picker pane instead of leaving the chooser open.
 * Last-pane reseed never auto-assigns — the picker stays so ⌘W can close.
 */
function maybeAutoAssignSingleAgent(
  conversationId: string,
  pendingTabId: string,
  reason: SkipCliPickerReason
): void {
  void (async () => {
    try {
      const { useSessionStore } = await import('./sessionStore')
      const settings = useSessionStore.getState().settings
      const enabled = enabledCliAgents(settings.cliAgents)
      if (
        !shouldAutoAssignSingleCliAgent({
          skipWhenSingle: settings.skipCliAgentPickerWhenSingle === true,
          enabledCount: enabled.length,
          reason
        })
      ) {
        return
      }
      const sole = enabled[0]
      if (!sole?.id) return
      const { getAgentInstallStatus, refreshAgentInstallStatus } = await import(
        '../lib/agentInstallStatus'
      )
      await refreshAgentInstallStatus({ force: false, discover: false })
      if (getAgentInstallStatus(sole.id) === 'missing') return
      // Pane may have been closed already.
      const surface = getCliSurface(useWorkspaceStore.getState().workspaces[conversationId])
      if (!surface?.tabs.some((t) => t.id === pendingTabId && t.pendingCli)) return
      await useWorkspaceStore
        .getState()
        .assignCliPane(conversationId, pendingTabId, sole.id, 80, 24)
    } catch {
      // settings / store not ready
    }
  })()
}

/**
 * Resolve a CLI agent from renderer settings when available (no IPC).
 * Falls back to main-process settings. Lazy-requires sessionStore to avoid a
 * circular import (sessionStore → workspaceStore).
 */
async function resolveCliAgentConfig(agentId: string): Promise<AgentConfig | null> {
  try {
    const { useSessionStore } = await import('./sessionStore')
    const fromRenderer = enabledCliAgents(useSessionStore.getState().settings.cliAgents).find(
      (a) => a.id === agentId
    )
    if (fromRenderer) return fromRenderer
  } catch {
    // sessionStore may not be ready in isolated tests
  }
  try {
    const settings = await window.vav.settings.get()
    return enabledCliAgents(settings.cliAgents).find((a) => a.id === agentId) ?? null
  } catch {
    return null
  }
}

/** Working directory for a conversation without listing all metas when possible. */
async function resolveTerminalCwd(conversationId: string, sliceRoot: string | null): Promise<string> {
  if (sliceRoot && sliceRoot !== '~') return sliceRoot
  try {
    const { useSessionStore } = await import('./sessionStore')
    const state = useSessionStore.getState()
    const meta = state.conversations.find((c) => c.id === conversationId)
    const fromMeta = meta?.workingDirectory
    if (fromMeta && fromMeta !== '~') return fromMeta
    if (!meta || isLocalMachine(meta.machineId)) {
      const fromSettings = state.settings.defaultWorkingDirectory?.trim()
      if (fromSettings) return fromSettings
    } else {
      const host = state.hosts.find((h) => h.id === normalizeMachineId(meta.machineId))
      if (host?.home) return host.home
    }
  } catch {
    // fall through to IPC
  }
  try {
    const [settings, metas] = await Promise.all([
      window.vav.settings.get(),
      window.vav.conversations.list()
    ])
    const meta = metas.find((c) => c.id === conversationId)
    const fromMeta = meta?.workingDirectory
    if (fromMeta && fromMeta !== '~') return fromMeta
    if (!meta || isLocalMachine(meta.machineId)) {
      const fromSettings = settings.defaultWorkingDirectory?.trim()
      if (fromSettings) return fromSettings
    }
  } catch {
    // bootstrap below
  }
  try {
    const boot = await window.vav.bootstrap()
    return boot.home || boot.tmp || '/'
  } catch {
    return '/'
  }
}

export const AGENT_TAB_ID = 'agent'

/**
 * Stable primary pane id for a conversation's CLI agent host.
 * Multi-window activate races resolve to one live process (Herdr ensure).
 * Extra splits use random UUIDs via {@link newUserTerminal} without preferredId.
 */
export function primaryAgentPaneId(conversationId: string, agentId: string): string {
  return `agent-host:${agentId}:${conversationId}`
}

/** One CLI agent's terminal host layout — survives agent switching. */
export interface AgentHostSession {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  activeTabId: string
}

/**
 * Unified CLI Agent surface key — holds mixed pending + multi-type panes.
 * (Per-agent keys may still exist for legacy hydrate; display uses this.)
 */
export const CLI_SURFACE_KEY = '__cli__'

export function makePendingCliTab(): TerminalTab {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? `${CLI_PENDING_PREFIX}${crypto.randomUUID()}`
      : `${CLI_PENDING_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return pendingTabFromId(id)
}

export interface WorkspaceSlice {
  root: string | null
  /** Directory path → its entries. One key per loaded level, nothing nested. */
  dirs: Record<string, FileEntry[]>
  dirErrors: Record<string, string>
  dirTruncated: Record<string, number>
  loadingDirs: string[]
  expanded: string[]
  selectedPath: string | null
  sort: FileSortKey
  ascending: boolean
  /** Files this conversation's agent has written, for the 本次改动 strip. */

  /**
   * User bash surface (Tools tray Terminal) — always plain shells, never a
   * CLI agent binary. Independent of {@link agentHostSessions}.
   */
  tabs: TerminalTab[]
  activeTabId: string
  /** Binary tree of pane splits for user bash. Null until first bash exists. */
  layout: TerminalLayoutNode | null
  /**
   * Main session is CLI Agent surface (not built-in VAV chat).
   * Layout lives at {@link CLI_SURFACE_KEY} in agentHostSessions.
   */
  cliMode: boolean
  /**
   * Which CLI agent is shown in the main session surface (null = vav chat).
   * Agent PTYs live only in {@link agentHostSessions}, not in `tabs`.
   */
  activeHostAgentId: string | null
  /**
   * Main-surface CLI agent layouts keyed by agent id. Switching agents parks
   * here without touching user bash tabs. PTYs are not killed.
   * Unified surface: {@link CLI_SURFACE_KEY}.
   */
  agentHostSessions: Record<string, AgentHostSession>
  /** PTY body under the tab strip; default collapsed (terminal-panel.rpml). */
  terminalOutputExpanded: boolean
  terminalHasUnseenOutput: boolean
}

function emptySlice(root: string | null): WorkspaceSlice {
  return {
    root,
    dirs: {},
    dirErrors: {},
    dirTruncated: {},
    loadingDirs: [],
    expanded: root ? [root] : [],
    selectedPath: null,
    sort: 'name',
    ascending: true,

    tabs: [],
    activeTabId: '',
    layout: null,
    cliMode: false,
    activeHostAgentId: null,
    agentHostSessions: {},
    terminalOutputExpanded: false,
    terminalHasUnseenOutput: false
  }
}

function getCliSurface(slice: WorkspaceSlice | undefined): AgentHostSession | undefined {
  return slice?.agentHostSessions[CLI_SURFACE_KEY]
}

/** Agent main-surface session from agentHostSessions (never user bash tabs). */
function getAgentHost(slice: WorkspaceSlice, agentId: string): AgentHostSession | undefined {
  return slice.agentHostSessions[agentId]
}

/** Drop any CLI-agent tabs that leaked into the user-bash list (legacy). */
function userBashTabsOnly(tabs: TerminalTab[]): TerminalTab[] {
  return tabs.filter((t) => !t.agentId || t.agentId === 'vav' || t.isAgent)
}

function isVavMirrorTab(tab: TerminalTab): boolean {
  return tab.isAgent || tab.agentId === 'vav' || tab.id === AGENT_TAB_ID
}

/** VAV mirror sits after user bash — never pinned to the front of the tray. */
function bashThenAgentTabs(tabs: TerminalTab[]): TerminalTab[] {
  const bash: TerminalTab[] = []
  const agent: TerminalTab[] = []
  for (const tab of tabs) {
    if (isVavMirrorTab(tab)) agent.push(tab)
    else bash.push(tab)
  }
  return [...bash, ...agent]
}

/** A host session is restorable only if it has panes that launched this agent. */
function isLiveAgentSession(session: AgentHostSession | undefined, agentId: string): boolean {
  if (!session?.layout || session.tabs.length === 0) return false
  return session.tabs.some((t) => t.agentId === agentId)
}

/**
 * Merge projected agent hosts while preserving each host's split topology.
 */
function reconcileAgentHosts(
  prev: Record<string, AgentHostSession>,
  projected: Record<string, AgentHostSession>,
  remoteAgents?: Record<string, TerminalLayoutNode | null>
): Record<string, AgentHostSession> {
  const out: Record<string, AgentHostSession> = {}
  for (const [agentId, proj] of Object.entries(projected)) {
    if (agentId === CLI_SURFACE_KEY) continue
    const old = prev[agentId]
    const tabIds = proj.tabs.map((t) => t.id)
    // Main-process layouts win so a detached window does not flatten ⌘⇧D → row.
    const base = remoteAgents?.[agentId] ?? old?.layout ?? null
    const layout = reconcileLayout(base, tabIds)
    const activeTabId =
      old && tabIds.includes(old.activeTabId)
        ? old.activeTabId
        : (proj.activeTabId || tabIds[0] || '')
    out[agentId] = {
      tabs: proj.tabs,
      layout,
      activeTabId
    }
  }
  // Unified CLI Screen: keep layout + pending picker panes across hydrate.
  // Live PTYs of any agent type are folded into this single surface.
  const prevSurface = prev[CLI_SURFACE_KEY]
  const remoteSurface = remoteAgents?.[CLI_SURFACE_KEY] ?? null
  const mergedSurface = mergeCliSurface(prevSurface, projected, remoteSurface)
  if (mergedSurface) {
    out[CLI_SURFACE_KEY] = mergedSurface
  }
  return out
}

/**
 * Screen-level CLI surface: panes are not grouped by agent type.
 * Pending picker leaves stay until the user assigns a CLI.
 * Hydrate must never drop an existing Screen when re-entering from VAV.
 */
function mergeCliSurface(
  prev: AgentHostSession | undefined,
  projected: Record<string, AgentHostSession>,
  remoteLayout: TerminalLayoutNode | null
): AgentHostSession | null {
  const liveById = new Map<string, TerminalTab>()
  for (const [agentId, host] of Object.entries(projected)) {
    if (agentId === CLI_SURFACE_KEY) continue
    for (const t of host.tabs) {
      liveById.set(t.id, {
        ...t,
        pendingCli: false,
        agentId: t.agentId ?? agentId
      })
    }
  }

  // Map pending picker leaves → newly spawned PTYs in order so we never treat
  // "pending + live" as two panes and re-split with row.
  // Optimistic assign marks the picker live (preferred id) before spawn
  // returns; that tab is not pendingCli but also has no PTY yet — treat it
  // the same so a minted id does not become a second pane beside the chooser.
  let layoutSeed = prev?.layout ?? null
  const pendingQueue = (prev?.tabs ?? [])
    .filter((t) => t.pendingCli || !liveById.has(t.id))
    .map((t) => t.id)
  const prevKnown = new Set((prev?.tabs ?? []).map((t) => t.id))
  const brandNewLives = [...liveById.keys()].filter((id) => !prevKnown.has(id))
  const pendingToLive = new Map<string, string>()
  for (const pendingId of pendingQueue) {
    if (brandNewLives.length === 0) break
    // Prefer when layout still names this pending leaf.
    const leaves = layoutSeed ? collectLeaves(layoutSeed) : []
    if (!leaves.includes(pendingId) && !prevKnown.has(pendingId)) continue
    const liveId = brandNewLives.shift()!
    pendingToLive.set(pendingId, liveId)
    layoutSeed = replaceLayoutTabId(layoutSeed, pendingId, liveId)
  }

  const tabs: TerminalTab[] = []
  const seen = new Set<string>()

  // Preserve previous pane order (Screen topology).
  for (const t of prev?.tabs ?? []) {
    const mapped = pendingToLive.get(t.id)
    if (mapped) {
      const live = liveById.get(mapped)
      if (live && !seen.has(mapped)) {
        tabs.push(live)
        seen.add(mapped)
        liveById.delete(mapped)
      }
      continue
    }
    if (t.pendingCli) {
      // Keep unassigned picker panes (no PTY in main yet).
      if (!seen.has(t.id)) {
        tabs.push({ ...t, pendingCli: true, agentId: null })
        seen.add(t.id)
      }
      continue
    }
    const live = liveById.get(t.id)
    if (live && !seen.has(t.id)) {
      tabs.push(live)
      seen.add(t.id)
      liveById.delete(t.id)
    }
  }
  // Attach any newly discovered live PTYs (other window / restore).
  for (const live of liveById.values()) {
    if (seen.has(live.id)) continue
    tabs.push(live)
    seen.add(live.id)
  }

  if (tabs.length === 0) {
    // Companion closed every live pane and reseeded a picker. Main still holds
    // those dead PTY tabs — adopt the persisted pending leaves so reclaim is
    // not a blank Screen.
    const adopted = adoptRemotePendingTabs(prev?.tabs, remoteLayout)
    if (adopted) {
      const tabIds = adopted.map((t) => t.id)
      return {
        tabs: adopted,
        layout: reconcileLayout(remoteLayout, tabIds) ?? layoutFromTabIds(tabIds),
        activeTabId: adopted[0]!.id
      }
    }
    // Screen existed but projection is empty (brief list race / all exited).
    // Prefer keeping the previous Screen topology over inventing a new picker —
    // enterCliMode + VAV park must not look like a wipe.
    if (prev && prev.tabs.length > 0) {
      return {
        tabs: prev.tabs,
        layout: prev.layout ?? layoutFromTabIds(prev.tabs.map((t) => t.id)),
        activeTabId: prev.activeTabId || prev.tabs[0]!.id
      }
    }
    if (!prev) return null
    const pending = makePendingCliTab()
    return {
      tabs: [pending],
      layout: { type: 'leaf', tabId: pending.id, weight: 1 },
      activeTabId: pending.id
    }
  }

  const tabIds = tabs.map((t) => t.id)
  // Also remap pending→live on remote seed so stale main trees stay column/row.
  let remoteSeed = remoteLayout
  for (const [from, to] of pendingToLive) {
    remoteSeed = replaceLayoutTabId(remoteSeed, from, to)
  }
  const base = pickCliLayoutBase(layoutSeed, remoteSeed, tabIds)
  const layout = reconcileLayout(base, tabIds)
  const activeTabId =
    prev && tabIds.includes(prev.activeTabId)
      ? prev.activeTabId
      : prev?.activeTabId && pendingToLive.has(prev.activeTabId)
        ? (pendingToLive.get(prev.activeTabId) ?? tabIds[0] ?? '')
        : (tabIds[0] ?? '')
  return { tabs, layout, activeTabId }
}

function emptyPtyLayouts(): ConversationPtyLayouts {
  return { bash: null, agents: {}, cliMode: false }
}

function normalizePtyListResult(raw: PtyListResult | PtySessionMeta[]): PtyListResult {
  if (Array.isArray(raw)) {
    return { sessions: raw, layouts: emptyPtyLayouts() }
  }
  return {
    sessions: raw?.sessions ?? [],
    layouts: raw?.layouts ?? emptyPtyLayouts()
  }
}

function tabsEqual(a: TerminalTab[], b: TerminalTab[]): boolean {
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

export type NewBashOptions = {
  title?: string
  purpose?: 'install'
  installAgentId?: string
  resumeCursor?: ProviderResumeCursor | null
  sessionTitle?: string | null
  /** Already-resolved CLI config — skip a second settings lookup on spawn. */
  agent?: AgentConfig
}

function agentHostsEqual(
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
function withTombstones(
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

/** Project main-process PTY snapshots into renderer tab/host maps. */
function projectPtySessions(sessions: PtySessionMeta[]): {
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

/**
 * Terminal write sinks, registered by the mounted xterm views.
 *
 * Mirrored agent output that arrives before the Agent tab has mounted is
 * queued here and replayed on registration (terminal-panel.rpml,
 * "pendingMirrors 队列直到 LocalTerminalView mount").
 */
const terminalSinks = new Map<string, (data: string) => void>()
const pendingMirrors = new Map<string, string[]>()
/** Serializes relaunchAgentHost per conversation so rapid switches don't race. */
const relaunchSerial = new Map<string, number>()

function sinkKey(conversationId: string, tabId: string): string {
  return `${conversationId}::${tabId}`
}

export function registerTerminalSink(
  conversationId: string,
  tabId: string,
  write: (data: string) => void
): () => void {
  const key = sinkKey(conversationId, tabId)
  terminalSinks.set(key, write)
  const queued = pendingMirrors.get(key)
  if (queued?.length) {
    for (const chunk of queued) write(chunk)
    pendingMirrors.delete(key)
  }
  return () => {
    if (terminalSinks.get(key) === write) terminalSinks.delete(key)
  }
}

function writeToTerminal(conversationId: string, tabId: string, data: string): void {
  const key = sinkKey(conversationId, tabId)
  const sink = terminalSinks.get(key)
  if (sink) {
    sink(data)
    return
  }
  const queue = pendingMirrors.get(key) ?? []
  queue.push(data)
  pendingMirrors.set(key, queue)
}

interface WorkspaceState {
  workspaces: Record<string, WorkspaceSlice>
  /**
   * Terminal activity per conversation, then per tab id.
   *
   * Kept outside `workspaces` on purpose: the sidebar has to show a rollup for
   * every conversation, including ones this window never bound a slice for.
   */
  ptyStatus: Record<string, Record<string, PtyActivityStatus>>

  setTabStatus(conversationId: string, tabId: string, status: PtyActivityStatus): void

  bindConversation(id: string, root: string | null): Promise<void>
  setWorkingDirectory(id: string, root: string | null): Promise<void>
  ensureFilesLoaded(id: string): Promise<void>
  /**
   * List one directory into the slice.
   * `quiet` — used by fs-watch refresh: skip the loadingDirs flash and skip
   * state updates when the listing is unchanged (CLI agents thrash the watch).
   */
  loadDirectory(id: string, path: string, options?: { quiet?: boolean }): Promise<void>
  refreshDirectories(id: string, dirs: string[]): Promise<void>
  toggleExpand(id: string, path: string): Promise<void>
  selectPath(id: string, path: string | null): void
  setSort(id: string, sort: FileSortKey, ascending: boolean): Promise<void>
  quickLook(id: string): void

  agentDidWriteFile(id: string, parentPath: string, filePath: string): void
  mirrorAgentTranscript(id: string, text: string): void
  ensureAgentTab(id: string): void
  ensureAgentPty(id: string): Promise<void>
  setTerminalOutputExpanded(id: string, expanded: boolean): void

  newUserTerminal(
    id: string,
    cols: number,
    rows: number,
    /** Override session agent id for this pane (null = plain shell). */
    agentIdOverride?: string | null,
    /**
     * Ambient launch context (focused file, etc.) for CLI agent spawn only.
     * Passed as process args — never typed into the PTY.
     */
    launchContext?: string | null,
    /**
     * Stable tab id for multi-window ensure (primary agent pane).
     * Omit for splits so each pane gets a fresh process.
     */
    preferredId?: string,
    extras?: NewBashOptions
  ): Promise<string>
  /**
   * Split the *active* pane (or create first pane).
   * - axis `row` = left/right (⌘D)
   * - axis `column` = top/bottom (⌘⇧D)
   * Directions compose independently via a binary layout tree.
   */
  /**
   * User bash only (Tools tray). Always plain shell — never spawns a CLI agent.
   */
  newBash(
    id: string,
    cols?: number,
    rows?: number,
    axis?: TerminalSplitAxis,
    extras?: NewBashOptions
  ): Promise<string>
  /**
   * Enter CLI Agent mode: show unified surface with a type-picker pane if empty.
   */
  enterCliMode(id: string): void
  /** Leave CLI Agent mode (back to VAV chat). Parks PTYs; does not kill. */
  exitCliMode(id: string): void
  /**
   * Split the CLI surface and put a **picker** in the new pane (⌘D / ⌘⇧D).
   * User chooses the CLI type in that pane before a PTY is spawned.
   */
  splitCliSurface(
    id: string,
    axis?: TerminalSplitAxis,
    options?: { autoAssign?: boolean }
  ): void
  /**
   * User picked a CLI type for a pending (or empty) pane — spawn PTY into it.
   */
  assignCliPane(
    id: string,
    tabId: string,
    agentId: string,
    cols?: number,
    rows?: number,
    initialContext?: string | null,
    resume?: { cursor: ProviderResumeCursor; title?: string | null }
  ): Promise<'created' | 'missing'>
  /** Split the focused pane along its long edge and resume a recorded session. */
  resumeCliSession(
    id: string,
    input: { agentId: string; cursor: ProviderResumeCursor; title?: string | null }
  ): Promise<'created' | 'missing'>
  /**
   * Split / new pane on a CLI agent host (legacy same-type split).
   * Prefer {@link splitCliSurface} for the CLI Agent surface.
   */
  splitAgentHost(
    id: string,
    cols?: number,
    rows?: number,
    axis?: TerminalSplitAxis,
    agentIdOverride?: string | null
  ): Promise<void>
  /**
   * Switch to a CLI agent host session without destroying others or user bash.
   * Restores a parked session if one exists; otherwise creates a fresh pane.
   */
  activateAgentHost(
    id: string,
    agentId: string,
    cols?: number,
    rows?: number,
    /** Only used when creating a brand-new session for this agent. */
    initialContext?: string | null
  ): Promise<'restored' | 'created' | 'missing'>
  /**
   * Synchronously surface a parked agent host (no IPC). Call before
   * `activateAgentHost` so the terminal paints on the same frame as the switch.
   */
  focusAgentHost(id: string, agentId: string): void
  /** Leave CLI main surface (keep agent PTYs parked; user bash untouched). */
  parkAgentHost(id: string): void
  /**
   * Paste into a CLI agent pane (focus handoff, block pick, draft).
   * Prefer launch argv for silent ambient bootstrap when the binary supports it.
   * Pass `agentId` (from conversation meta) to target that host even when it
   * is not currently the foreground surface.
   */
  injectContextToActivePane(
    id: string,
    text: string,
    options?: {
      submit?: boolean
      delayMs?: number
      /** Skip if this pane already received the same payload. */
      fingerprint?: string
      /** Conversation agentBinaryName — prefer this host over activeHostAgentId. */
      agentId?: string
    }
  ): void
  selectTab(id: string, tabId: string): void
  selectAgentTab(id: string, tabId: string): void
  requestCloseTab(id: string, tabId: string): void
  closeTab(id: string, tabId: string): void
  closeAgentTab(id: string, tabId: string): void
  notifyShellChanged(): void

  /**
   * Rebuild tabs + agentHostSessions from main-process live PTYs.
   * Safe to call from any window — never spawns, only projects.
   */
  hydratePtyState(id: string, opts?: { acceptRemoteSurface?: boolean }): Promise<void>

  /**
   * Push current bash / agent split trees to main so other windows (detached)
   * hydrate the same directions. Returns a promise so openDetached can await
   * cliMode before the companion hydrates.
   */
  syncPtyLayouts(id: string): Promise<void>

  disposeConversation(id: string): void
  /**
   * Drop this renderer's projection + xterms. Does not kill PTYs — used when a
   * warm session shell parks so the next claim does not remount a stale Screen.
   */
  forgetLocalWorkspace(id: string): void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: {},
  ptyStatus: {},

  setTabStatus(conversationId, tabId, status) {
    set((state) => {
      const forConversation = state.ptyStatus[conversationId]
      if (forConversation?.[tabId] === status) return state
      return {
        ptyStatus: {
          ...state.ptyStatus,
          [conversationId]: { ...forConversation, [tabId]: status }
        }
      }
    })
    // An exited tab is only a tombstone if the projection knows to keep it.
    if (status === 'exited' && get().workspaces[conversationId]) {
      void get().hydratePtyState(conversationId)
    }
  },

  async bindConversation(id, root) {
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(root) } }))
    } else if (root !== undefined) {
      // Keep PTY maps; only ensure root is set when provided.
      patch(set, id, (s) => (s.root === root ? {} : { root }))
    }
    await window.vav.files.watch(id, root)
    // Directory listing must not gate session switch paint — FilesPanel also
    // calls ensureFilesLoaded when it becomes visible.
    void get().ensureFilesLoaded(id)
    // Always re-project live PTYs — this is what makes detached windows attach
    // to the same Grok/Cursor process instead of spawning a second one.
    await get().hydratePtyState(id)
  },

  async hydratePtyState(id, opts) {
    if (!window.vav.pty.list) return
    let sessions: PtySessionMeta[] = []
    let remoteLayouts = emptyPtyLayouts()
    try {
      const listed = normalizePtyListResult(await window.vav.pty.list(id))
      sessions = listed.sessions
      remoteLayouts = listed.layouts
    } catch {
      return
    }
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(null) } }))
    }
    // Adopt main's view of the live tabs, and forget any tombstone whose id is
    // no longer referenced anywhere (the pane was closed while we were away).
    set((state) => {
      const current = state.ptyStatus[id] ?? {}
      const next: Record<string, PtyActivityStatus> = {}
      for (const meta of sessions) next[meta.id] = meta.status
      for (const [tabId, status] of Object.entries(current)) {
        if (status === 'exited' && !(tabId in next)) next[tabId] = status
      }
      const keys = Object.keys(next)
      const unchanged =
        keys.length === Object.keys(current).length &&
        keys.every((tabId) => current[tabId] === next[tabId])
      if (unchanged) return state
      return { ptyStatus: { ...state.ptyStatus, [id]: next } }
    })
    const status = get().ptyStatus[id] ?? {}
    const projected = projectPtySessions(sessions)
    let followRemote = opts?.acceptRemoteSurface === true
    if (!followRemote && !isCompanionSessionShell()) {
      try {
        const { useSessionStore } = await import('./sessionStore')
        followRemote = useSessionStore.getState().detachedConversationIds.includes(id)
      } catch {
        followRemote = false
      }
    }
    patch(set, id, (s) => {
      // CLI Screen mode — single flag on ConversationPtyLayouts.cliMode.
      // Companion is the writer while detached. Parked main / reclaim follow
      // remote false so Thread in the companion comes back as Thread.
      // The writing window still ignores a stale remote false (enterCliMode
      // race must not bounce Swarm → VAV).
      // Parked CLI panes (agentHostSessions still present) do NOT imply mode —
      // user may be on VAV with agents running in the background.
      const cliMode = resolveHydratedCliMode({
        remoteCli: remoteLayouts.cliMode,
        localCli: s.cliMode === true,
        followRemote
      })
      let activeHostAgentId = s.activeHostAgentId
      if (cliMode) {
        activeHostAgentId = CLI_SURFACE_KEY
      } else if (activeHostAgentId === CLI_SURFACE_KEY) {
        activeHostAgentId = null
      } else if (activeHostAgentId && !projected.agentHostSessions[activeHostAgentId]) {
        // Legacy per-agent host gone — clear pointer only.
        activeHostAgentId = null
      }

      // Tombstones apply to the tools-tray list only. Agent hosts are excluded
      // deliberately: `isLiveAgentSession` would read a dead pane as restorable
      // and suppress the relaunch that switching back to that agent needs.
      const tabs = bashThenAgentTabs(
        retainInstallMeta(withTombstones(projected.tabs, s.tabs, status), s.tabs)
      )
      // Prefer main-process layouts (detached ↔ main). Fall back to local, never
      // to a fresh layoutFromTabIds row tree when a persisted tree exists.
      const layout = reconcileLayout(
        remoteLayouts.bash ?? s.layout,
        tabs.map((t) => t.id)
      )
      const agentHostSessions = reconcileAgentHosts(
        s.agentHostSessions,
        projected.agentHostSessions,
        remoteLayouts.agents
      )

      // Skip no-op patches to avoid re-render thrash on frequent pty:changed.
      if (
        tabsEqual(s.tabs, tabs) &&
        agentHostsEqual(s.agentHostSessions, agentHostSessions) &&
        s.activeHostAgentId === activeHostAgentId &&
        s.cliMode === cliMode &&
        collectLeaves(s.layout).join(',') === collectLeaves(layout).join(',') &&
        // Direction matters: same leaves with row vs column is a real change.
        layoutDirectionKey(s.layout) === layoutDirectionKey(layout)
      ) {
        return {}
      }

      // Prefer keeping the user's current active bash tab when it still exists.
      const activeTabId = tabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : (tabs[0]?.id ?? '')

      return {
        tabs,
        layout,
        activeTabId,
        agentHostSessions,
        activeHostAgentId,
        cliMode
      }
    })
  },

  async syncPtyLayouts(id) {
    const setLayouts = window.vav?.pty?.setLayouts
    if (typeof setLayouts !== 'function') return
    // Snapshot at call time — do not re-read after await (hydrate may race and
    // momentarily hold a flattened row tree from layoutFromTabIds).
    const slice = get().workspaces[id]
    if (!slice) return
    const agents: ConversationPtyLayouts['agents'] = {}
    for (const [agentId, host] of Object.entries(slice.agentHostSessions)) {
      agents[agentId] = host.layout
    }
    const payload: ConversationPtyLayouts = {
      bash: slice.layout,
      agents,
      cliMode: slice.cliMode === true
    }
    try {
      await setLayouts(id, payload)
      // If hydrate flattened local axes while IPC was in flight, restore the
      // tree we just persisted (column vs row lives only in this snapshot).
      const sentCli = payload.agents[CLI_SURFACE_KEY] ?? null
      if (!sentCli) return
      const now = getCliSurface(get().workspaces[id])
      if (
        now &&
        layoutDirectionKey(now.layout) !== layoutDirectionKey(sentCli) &&
        (layoutHasColumn(sentCli) || scoreLayoutLeaves(sentCli, now.tabs.map((t) => t.id)) >=
          scoreLayoutLeaves(now.layout, now.tabs.map((t) => t.id)))
      ) {
        patch(set, id, (s) => {
          const cur = getCliSurface(s)
          if (!cur) return {}
          return {
            agentHostSessions: {
              ...s.agentHostSessions,
              [CLI_SURFACE_KEY]: { ...cur, layout: sentCli }
            }
          }
        })
      }
    } catch {
      // Best-effort — companion may still hydrate from live PTYs.
    }
  },

  async setWorkingDirectory(id, root) {
    const previous = get().workspaces[id]
    // Same root: keep the cached tree. Clearing dirs here was flashing the
    // Files panel whenever FileViewer re-bound an unchanged workdir.
    if (previous && previous.root === root) {
      await window.vav.files.watch(id, root)
      await get().ensureFilesLoaded(id)
      return
    }

    // A new root invalidates every cached level; tabs and PTYs are untouched.
    set((state) => {
      const prev = state.workspaces[id] ?? emptySlice(root)
      return {
        workspaces: {
          ...state.workspaces,
          [id]: {
            ...emptySlice(root),
            sort: prev.sort,
            ascending: prev.ascending,

            tabs: prev.tabs,
            activeTabId: prev.activeTabId,
            layout: prev.layout,
            cliMode: prev.cliMode,
            activeHostAgentId: prev.activeHostAgentId,
            agentHostSessions: prev.agentHostSessions
          }
        }
      }
    })
    await window.vav.files.watch(id, root)
    await get().ensureFilesLoaded(id)
  },

  async ensureFilesLoaded(id) {
    const slice = get().workspaces[id]
    if (!slice?.root) return
    if (slice.dirs[slice.root]) return
    await get().loadDirectory(id, slice.root)
  },

  async loadDirectory(id, path, options) {
    const quiet = options?.quiet === true
    const slice = get().workspaces[id]
    if (!slice) return
    if (slice.loadingDirs.includes(path)) return
    // Watch refresh: never flash skeleton rows — keep the previous listing until
    // the new one arrives, and bail if nothing changed.
    if (!quiet) {
      patch(set, id, (s) => ({ loadingDirs: [...s.loadingDirs, path] }))
    }

    const live = get().workspaces[id] ?? slice
    const listing = await window.vav.files.list(path, live.sort, live.ascending, id)
    // Normalize missing-path errors so the Files panel can show a calm empty state
    // instead of raw ENOENT stack noise (common for file-sessions whose dir is gone).
    const error = listing.error
      ? /enoent|no such file|not found/i.test(listing.error)
        ? 'ENOENT'
        : listing.error
      : undefined
    const nextEntries = error ? [] : listing.entries

    // Root gone → drop from recent/pinned so the switcher never offers a dead path.
    if (error === 'ENOENT' && live.root && path === live.root) {
      void (async () => {
        try {
          const { useSessionStore } = await import('./sessionStore')
          const machineId = useSessionStore.getState().conversations.find((c) => c.id === id)
            ?.machineId
          await forgetMissingWorkspaceDir(path, machineId)
        } catch {
          await forgetMissingWorkspaceDir(path)
        }
      })()
    }

    patch(set, id, (s) => {
      const prev = s.dirs[path]
      const sameEntries =
        Array.isArray(prev) &&
        prev.length === nextEntries.length &&
        prev.every((entry, i) => {
          const next = nextEntries[i]
          return (
            !!next &&
            entry.path === next.path &&
            entry.name === next.name &&
            entry.isDirectory === next.isDirectory &&
            entry.size === next.size &&
            entry.modifiedAt === next.modifiedAt
          )
        })
      const sameTrunc = (s.dirTruncated[path] ?? 0) === listing.truncated
      const prevErr = s.dirErrors[path]
      const sameErr = error ? prevErr === error : prevErr === undefined
      const nextLoading = s.loadingDirs.filter((p) => p !== path)
      const loadingChanged = nextLoading.length !== s.loadingDirs.length

      if (sameEntries && sameTrunc && sameErr) {
        if (!loadingChanged) return {}
        return { loadingDirs: nextLoading }
      }

      return {
        loadingDirs: nextLoading,
        // Empty list on missing root so we don't keep a stale tree.
        dirs: { ...s.dirs, [path]: nextEntries },
        dirErrors: error ? { ...s.dirErrors, [path]: error } : omit(s.dirErrors, path),
        dirTruncated: { ...s.dirTruncated, [path]: listing.truncated }
      }
    })
  },

  async refreshDirectories(id, dirs) {
    const slice = get().workspaces[id]
    if (!slice) return
    // Only levels the user actually has open are worth re-reading.
    const relevant = dirs.filter((dir) => slice.dirs[dir] !== undefined)
    for (const dir of relevant) await get().loadDirectory(id, dir, { quiet: true })
  },

  async toggleExpand(id, path) {
    const slice = get().workspaces[id]
    if (!slice) return
    const isExpanded = slice.expanded.includes(path)
    patch(set, id, (s) => ({
      expanded: isExpanded ? s.expanded.filter((p) => p !== path) : [...s.expanded, path]
    }))
    if (!isExpanded && !slice.dirs[path]) await get().loadDirectory(id, path)
  },

  selectPath(id, path) {
    patch(set, id, () => ({ selectedPath: path }))
  },

  async setSort(id, sort, ascending) {
    const next = normalizeFileSortKey(sort)
    patch(set, id, () => ({ sort: next, ascending, dirs: {} }))
    const slice = get().workspaces[id]
    if (!slice?.root) return
    for (const dir of [slice.root, ...slice.expanded]) {
      if (dir === slice.root || slice.expanded.includes(dir)) await get().loadDirectory(id, dir)
    }
  },

  quickLook(id) {
    const path = get().workspaces[id]?.selectedPath
    if (path) void window.vav.files.quickLook(path)
  },

  agentDidWriteFile(id, parentPath, _filePath) {
    // Parent only — a tool call must never trigger a whole-tree reload.
    void get().refreshDirectories(id, [parentPath])
  },

  mirrorAgentTranscript(id, text) {
    get().ensureAgentTab(id)
    writeToTerminal(id, AGENT_TAB_ID, text.replace(/\n/g, '\r\n'))
  },

  /**
   * Opens the agent's bash tab the first time the agent actually runs
   * something. Output that arrives before the view mounts is held in
   * `pendingMirrors` and replayed, so nothing is lost by creating it late.
   * The tab is interactive (real PTY) — mirrors feed the same surface.
   */
  ensureAgentTab(id) {
    const existing = get().workspaces[id]
    const had = !!existing?.tabs.some((tab) => tab.isAgent)
    if (!had) {
      // Built-in vav agent mirror tab — bot icon in ToolsPanel; human-interactive PTY.
      // Must also create a layout leaf: TerminalPanel only renders `layout`, not bare tabs.
      patch(set, id, (s) => ({
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
      }))
      void get().ensureAgentPty(id)
      return
    }
    // Recover from older sessions that registered the tab without a layout tree
    // (showed "No terminal yet" while the vav chip was visible).
    const slice = get().workspaces[id]
    if (slice && !slice.layout) {
      const agentTab = slice.tabs.find((tab) => tab.isAgent) ?? slice.tabs[0]
      if (agentTab) {
        patch(set, id, () => ({
          layout: { type: 'leaf', tabId: agentTab.id, weight: 1 },
          activeTabId: agentTab.id
        }))
        void get().ensureAgentPty(id)
      }
    }
    // Already have the mirror tab + layout — do not re-enter create/hydrate on
    // every stream chunk (that re-rendered the Workspace/VAV chip row).
  },

  async ensureAgentPty(id) {
    const slice = get().workspaces[id]
    const cwd = slice?.root ?? '~'
    // preferredId keeps a single mirror PTY across windows.
    await window.vav.pty.create(id, cwd, 80, 24, {
      preferredId: AGENT_TAB_ID,
      agentId: 'vav',
      title: 'VAV'
    })
  },

  /**
   * Spawn a PTY and register a tab.
   * - `agentIdOverride === null` / omit for user bash → plain shell into `tabs`
   * - `agentIdOverride` = CLI agent id → agent host session only (not tools tray)
   */
  async newUserTerminal(id, cols, rows, agentIdOverride, launchContext, preferredId, extras) {
    const slice = get().workspaces[id]
    // Absolute cwd only — node-pty rejects "~". Prefer in-memory state (no IPC).
    const cwd = await resolveTerminalCwd(id, slice?.root ?? null)

    // Tools tray / plain bash: never inherit session agentBinaryName.
    // Only explicit agent id spawns a CLI agent binary.
    const forAgentHost =
      typeof agentIdOverride === 'string' && agentIdOverride.length > 0 && agentIdOverride !== 'vav'
    const agent = forAgentHost
      ? (extras?.agent ?? (await resolveCliAgentConfig(agentIdOverride)))
      : null

    const strategy = contextLaunchStrategyForAgent(agent?.id)
    const grid = resolveSpawnGrid(cols, rows, forAgentHost ? 'agent' : 'bash')
    // A stable preferredId (CLI agent primary pane) may still own the xterm of
    // a process that already quit — blank it before the new one writes a byte.
    if (preferredId) resetTerminalForNewProcess(id, preferredId)
    const tabId = await window.vav.pty.create(
      id,
      cwd,
      grid.cols,
      grid.rows,
      agent?.binaryPath
        ? {
            // preferredId makes multi-window activate attach, not respawn.
            ...(preferredId ? { preferredId } : {}),
            command: agent.binaryPath,
            args: agent.defaultArgs ?? [],
            commandCandidates: agent.binaryCandidates,
            env: agent.envVars,
            // Ambient focus at spawn when the binary supports it (Claude:
            // --append-system-prompt-file). prompt-paste agents get the same
            // text after spawn via injectContextToActivePane.
            launchContext: launchContext?.trim() || null,
            contextLaunchStrategy: strategy,
            agentId: agent.id,
            title: extras?.sessionTitle?.trim() || agent.name,
            resumeCursor: extras?.resumeCursor ?? null,
            sessionTitle: extras?.sessionTitle ?? null
          }
        : {
            ...(preferredId ? { preferredId } : {}),
            agentId: null,
            title: extras?.title?.trim() || 'bash',
            pinTitle: extras?.purpose === 'install',
            purpose: extras?.purpose,
            installAgentId: extras?.installAgentId
          }
    )

    // Main may have minted (or attached) a different id than we guessed.
    resetTerminalForNewProcess(id, tabId)

    if (forAgentHost && agent) {
      // Caller (activate/splitAgentHost) folds this into agentHostSessions.
      return tabId
    }

    const bashTabs = userBashTabsOnly(slice?.tabs ?? [])
    const index = bashTabs.length + 1
    patch(set, id, (s) => ({
      tabs: bashThenAgentTabs([
        ...userBashTabsOnly(s.tabs),
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
    }))
    return tabId
  },

  async newBash(id, cols = 80, rows = 24, axis: TerminalSplitAxis = 'row', extras) {
    const slice = get().workspaces[id]
    const bashTabs = userBashTabsOnly(slice?.tabs ?? [])
    // First pane: single leaf, no split.
    if (!slice || bashTabs.length === 0 || !slice.layout) {
      const tabId = await get().newUserTerminal(id, cols, rows, null, undefined, undefined, extras)
      patch(set, id, (s) => ({
        tabs: bashThenAgentTabs(
          userBashTabsOnly(s.tabs).map((t) =>
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
      }))
      get().syncPtyLayouts(id)
      return tabId
    }
    const focusId = slice.activeTabId || bashTabs[0]!.id
    const newTabId = await get().newUserTerminal(id, cols, rows, null, undefined, undefined, extras)
    patch(set, id, (s) => {
      // Hydrate may have attached newTabId as a default-row leaf during the
      // await — strip it, then re-split with the caller's axis (⌘D / ⌘⇧D).
      let baseTabs = userBashTabsOnly(s.tabs).filter((t) => t.id !== newTabId)
      let layout = s.layout ?? { type: 'leaf', tabId: focusId, weight: 1 }
      if (collectLeaves(layout).includes(newTabId)) {
        layout = removeLeaf(layout, newTabId) ?? {
          type: 'leaf',
          tabId: focusId,
          weight: 1
        }
      }
      const focusInLayout = collectLeaves(layout).includes(focusId)
      const splitAt = focusInLayout ? focusId : (collectLeaves(layout)[0] ?? focusId)
      const nextLayout = splitLeaf(layout, splitAt, axis, newTabId)
      if (!baseTabs.some((t) => t.id === newTabId)) {
        baseTabs = [
          ...baseTabs,
          {
            id: newTabId,
            title: extras?.title?.trim() || `bash-${baseTabs.length + 1}`,
            isAgent: false,
            agentId: null,
            purpose: extras?.purpose,
            installAgentId: extras?.installAgentId,
            splitWeight: 1
          }
        ]
      } else if (extras?.purpose === 'install' || extras?.title) {
        baseTabs = baseTabs.map((t) =>
          t.id === newTabId
            ? {
                ...t,
                title: extras?.title?.trim() || t.title,
                purpose: extras?.purpose ?? t.purpose,
                installAgentId: extras?.installAgentId ?? t.installAgentId
              }
            : t
        )
      }
      return {
        tabs: bashThenAgentTabs(baseTabs),
        layout: nextLayout,
        activeTabId: newTabId
      }
    })
    get().syncPtyLayouts(id)
    return newTabId
  },

  enterCliMode(id) {
    if (!id) return
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(null) } }))
    }
    const slice = get().workspaces[id]!
    const existing = getCliSurface(slice)
    // Already on Screen with panes — skip (avoids double sync from UI + layout effect).
    if (slice.cliMode && existing && existing.tabs.length > 0) {
      return
    }
    // Screen already exists (live panes and/or pending pickers) — only flip mode.
    // Never rebuild or drop panes when re-entering from VAV.
    if (existing && existing.tabs.length > 0) {
      const layout =
        existing.layout ??
        layoutFromTabIds(existing.tabs.map((t) => t.id))
      patch(set, id, (s) => ({
        cliMode: true,
        activeHostAgentId: CLI_SURFACE_KEY,
        agentHostSessions: {
          ...s.agentHostSessions,
          [CLI_SURFACE_KEY]: {
            ...existing,
            layout,
            activeTabId:
              existing.activeTabId && existing.tabs.some((t) => t.id === existing.activeTabId)
                ? existing.activeTabId
                : (existing.tabs[0]?.id ?? '')
          }
        }
      }))
      get().syncPtyLayouts(id)
      return
    }
    // Prefer promoting a single live per-agent host into the surface if present.
    const liveAgents = Object.entries(slice.agentHostSessions).filter(
      ([key, host]) => key !== CLI_SURFACE_KEY && isLiveAgentSession(host, key)
    )
    if (liveAgents.length === 1) {
      const [agentId, host] = liveAgents[0]!
      patch(set, id, (s) => ({
        cliMode: true,
        activeHostAgentId: CLI_SURFACE_KEY,
        agentHostSessions: {
          ...s.agentHostSessions,
          [CLI_SURFACE_KEY]: {
            tabs: host.tabs.map((t) => ({ ...t, pendingCli: false, agentId: t.agentId ?? agentId })),
            layout: host.layout,
            activeTabId: host.activeTabId
          }
        }
      }))
      get().syncPtyLayouts(id)
      return
    }
    if (liveAgents.length > 1) {
      // Multiple types already running: fold all leaves into one flat row for now.
      const tabs: TerminalTab[] = []
      for (const [agentId, host] of liveAgents) {
        for (const t of host.tabs) {
          tabs.push({ ...t, pendingCli: false, agentId: t.agentId ?? agentId })
        }
      }
      let layout: TerminalLayoutNode | null = null
      for (const t of tabs) {
        if (!layout) layout = { type: 'leaf', tabId: t.id, weight: 1 }
        else layout = splitLeaf(layout, collectLeaves(layout).slice(-1)[0]!, 'row', t.id)
      }
      patch(set, id, (s) => ({
        cliMode: true,
        activeHostAgentId: CLI_SURFACE_KEY,
        agentHostSessions: {
          ...s.agentHostSessions,
          [CLI_SURFACE_KEY]: {
            tabs,
            layout,
            activeTabId: tabs[0]?.id ?? ''
          }
        }
      }))
      get().syncPtyLayouts(id)
      return
    }
    // Fresh: one picker pane (may auto-assign when only one agent is enabled).
    const pending = makePendingCliTab()
    patch(set, id, (s) => ({
      cliMode: true,
      activeHostAgentId: CLI_SURFACE_KEY,
      agentHostSessions: {
        ...s.agentHostSessions,
        [CLI_SURFACE_KEY]: {
          tabs: [pending],
          layout: { type: 'leaf', tabId: pending.id, weight: 1 },
          activeTabId: pending.id
        }
      }
    }))
    get().syncPtyLayouts(id)
    maybeAutoAssignSingleAgent(id, pending.id, 'enter')
  },

  exitCliMode(id) {
    if (!id) return
    const slice = get().workspaces[id]
    if (!slice) return
    // Idempotent — openChatMode / menu / park callers may stack.
    if (!slice.cliMode && !slice.activeHostAgentId) return
    patch(set, id, (s) => ({
      cliMode: false,
      activeHostAgentId: null,
      // Drop agent-owned bash tabs from the tray; keep user shells.
      tabs: bashThenAgentTabs(userBashTabsOnly(s.tabs))
    }))
    get().syncPtyLayouts(id)
  },

  splitCliSurface(id, axis: TerminalSplitAxis = 'row', options) {
    if (!id) return
    get().enterCliMode(id)
    const slice = get().workspaces[id]
    const surface = getCliSurface(slice)
    if (!surface) return
    const pending = makePendingCliTab()
    const autoAssign = options?.autoAssign !== false
    const focusId =
      surface.activeTabId || surface.tabs[0]?.id || collectLeaves(surface.layout!)[0]
    if (!focusId || !surface.layout) {
      patch(set, id, (s) => ({
        agentHostSessions: {
          ...s.agentHostSessions,
          [CLI_SURFACE_KEY]: {
            tabs: [pending],
            layout: { type: 'leaf', tabId: pending.id, weight: 1 },
            activeTabId: pending.id
          }
        },
        activeHostAgentId: CLI_SURFACE_KEY,
        cliMode: true
      }))
      if (autoAssign) maybeAutoAssignSingleAgent(id, pending.id, 'split')
      return
    }
    // Equal split (1:1) for both ⌘D row and ⌘⇧D column.
    const nextLayout = splitLeaf(surface.layout, focusId, axis, pending.id)
    patch(set, id, (s) => {
      const cur = getCliSurface(s) ?? surface
      return {
        cliMode: true,
        activeHostAgentId: CLI_SURFACE_KEY,
        agentHostSessions: {
          ...s.agentHostSessions,
          [CLI_SURFACE_KEY]: {
            tabs: [...cur.tabs.filter((t) => t.id !== pending.id), pending],
            layout: nextLayout,
            activeTabId: pending.id
          }
        }
      }
    })
    get().syncPtyLayouts(id)
    if (autoAssign) maybeAutoAssignSingleAgent(id, pending.id, 'split')
    // Original pane just remounted in a half-size track — settle fit + SIGWINCH
    // instead of waiting for the 180ms ResizeObserver debounce.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('vav:resize-end'))
      })
    })
  },

  async assignCliPane(
    id,
    tabId,
    agentId,
    cols = 80,
    rows = 24,
    initialContext = null,
    resume
  ) {
    if (!id || !tabId || !agentId) return 'missing'
    get().enterCliMode(id)
    const agent = await resolveCliAgentConfig(agentId)
    if (!agent) return 'missing'

    let newTabId: string
    // Prefer stable primary id when this is the first live pane of that agent.
    // Resume always mints a fresh PTY so `--resume` is not attached to a dead id.
    const surface = getCliSurface(get().workspaces[id])
    const liveOfType =
      surface?.tabs.filter((t) => !t.pendingCli && t.agentId === agentId).length ?? 0
    const preferred =
      !resume &&
      liveOfType === 0 &&
      (surface?.tabs.some((t) => t.id === tabId && t.pendingCli) ?? false)
        ? primaryAgentPaneId(id, agentId)
        : undefined
    const liveTab: TerminalTab = {
      id: preferred ?? tabId,
      title: agent.name,
      isAgent: false,
      agentId,
      pendingCli: false,
      splitWeight: 1
    }
    // Mount xterm on the preferred id while spawn IPC is in flight.
    if (preferred) {
      patchCliSurfaceTab(set, id, tabId, { ...liveTab, id: preferred })
    }
    try {
      newTabId = await get().newUserTerminal(id, cols, rows, agentId, initialContext, preferred, {
        resumeCursor: resume?.cursor ?? null,
        sessionTitle: resume?.title ?? null,
        agent
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('AGENT_NOT_FOUND')) {
        if (preferred) {
          patchCliSurfaceTab(set, id, preferred, pendingTabFromId(tabId))
        }
        return 'missing'
      }
      throw err
    }

    patchCliSurfaceTab(set, id, preferred ?? tabId, { ...liveTab, id: newTabId })
    get().syncPtyLayouts(id)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('vav:resize-end'))
      })
    })
    // Keep conversation meta pointing at the focused CLI type for prompts.
    try {
      const { useSessionStore } = await import('./sessionStore')
      await useSessionStore.getState().setAgentBinaryName(id, agentId)
    } catch {
      // ignore
    }
    return 'created'
  },

  async resumeCliSession(id, input) {
    if (!id || !input.agentId || !input.cursor) return 'missing'
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(null) } }))
    }
    let surface = getCliSurface(get().workspaces[id])
    if (surface && surface.tabs.length > 0) {
      // Flip Thread → Swarm without reseeding panes.
      get().enterCliMode(id)
      surface = getCliSurface(get().workspaces[id])
    } else {
      // One pending leaf, no auto-assign — we are about to resume into it.
      const pending = makePendingCliTab()
      patch(set, id, (s) => ({
        cliMode: true,
        activeHostAgentId: CLI_SURFACE_KEY,
        agentHostSessions: {
          ...s.agentHostSessions,
          [CLI_SURFACE_KEY]: {
            tabs: [pending],
            layout: { type: 'leaf', tabId: pending.id, weight: 1 },
            activeTabId: pending.id
          }
        }
      }))
      surface = getCliSurface(get().workspaces[id])
    }

    const pendingOnly =
      surface &&
      surface.tabs.length === 1 &&
      surface.tabs[0]?.pendingCli === true
        ? surface.tabs[0].id
        : null

    let tabId = pendingOnly
    if (!tabId) {
      const focused = focusedCliPaneId() || surface?.activeTabId
      const rects = measureCliPaneRects()
      const box = rects.find((row) => row.tabId === focused) ?? rects[0]
      const axis = box
        ? longEdgeSplitAxis(box.right - box.left, box.bottom - box.top)
        : 'row'
      get().splitCliSurface(id, axis, { autoAssign: false })
      tabId = getCliSurface(get().workspaces[id])?.activeTabId ?? null
    }
    if (!tabId) return 'missing'
    const result = await get().assignCliPane(id, tabId, input.agentId, 80, 24, null, {
      cursor: input.cursor,
      title: input.title ?? null
    })
    if (result === 'created') {
      const liveId = getCliSurface(get().workspaces[id])?.activeTabId
      if (liveId) {
        const { focusAgentPane } = await import('../lib/uiFocus')
        focusAgentPane(id, liveId)
      }
    }
    return result
  },

  async splitAgentHost(
    id,
    cols = 80,
    rows = 24,
    axis: TerminalSplitAxis = 'row',
    agentIdOverride = null
  ) {
    // Unified CLI surface: always open a picker pane (user's product model).
    if (get().workspaces[id]?.cliMode || agentIdOverride) {
      get().splitCliSurface(id, axis)
      return
    }
    const slice = get().workspaces[id]
    const agentId = agentIdOverride || slice?.activeHostAgentId
    if (!agentId) return
    // Switching CLI type for this split — surface that host before spawning.
    if (agentIdOverride && agentIdOverride !== slice?.activeHostAgentId) {
      patch(set, id, () => ({ activeHostAgentId: agentIdOverride }))
    }
    const host = getAgentHost(get().workspaces[id], agentId)
    const agent = await resolveCliAgentConfig(agentId)
    if (!agent) return

    if (!host || host.tabs.length === 0 || !host.layout) {
      try {
        // First pane uses the same stable id as activateAgentHost so a split
        // after a cold open still attaches when main already owns the process.
        const tabId = await get().newUserTerminal(
          id,
          cols,
          rows,
          agentId,
          null,
          primaryAgentPaneId(id, agentId),
          { agent }
        )
        patch(set, id, (s) => ({
          agentHostSessions: {
            ...s.agentHostSessions,
            [agentId]: {
              tabs: [
                {
                  id: tabId,
                  title: agent.name,
                  isAgent: false,
                  agentId,
                  splitWeight: 1
                }
              ],
              layout: { type: 'leaf', tabId, weight: 1 },
              activeTabId: tabId
            }
          }
        }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('AGENT_NOT_FOUND')) return
        throw err
      }
      get().syncPtyLayouts(id)
      return
    }

    const focusId = host.activeTabId || host.tabs[0]!.id
    let newTabId: string
    try {
      newTabId = await get().newUserTerminal(id, cols, rows, agentId, null, undefined, { agent })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('AGENT_NOT_FOUND')) return
      throw err
    }
    patch(set, id, (s) => {
      const cur = getAgentHost(s, agentId) ?? host
      // Drop a hydrate race that may have already inserted this pane as `row`.
      let layout = cur.layout ?? { type: 'leaf', tabId: focusId, weight: 1 }
      if (collectLeaves(layout).includes(newTabId)) {
        layout = removeLeaf(layout, newTabId) ?? {
          type: 'leaf',
          tabId: focusId,
          weight: 1
        }
      }
      const baseTabs = cur.tabs.filter((t) => t.id !== newTabId)
      const focusInLayout = collectLeaves(layout).includes(focusId)
      const splitAt = focusInLayout ? focusId : (collectLeaves(layout)[0] ?? focusId)
      const nextLayout = splitLeaf(layout, splitAt, axis, newTabId)
      const tabs = [
        ...baseTabs,
        {
          id: newTabId,
          title: `${agent.name}-${baseTabs.length + 1}`,
          isAgent: false as const,
          agentId,
          splitWeight: 1
        }
      ]
      return {
        agentHostSessions: {
          ...s.agentHostSessions,
          [agentId]: { tabs, layout: nextLayout, activeTabId: newTabId }
        }
      }
    })
    get().syncPtyLayouts(id)
  },

  async activateAgentHost(id, agentId, cols = 80, rows = 24, initialContext = null) {
    const serial = (relaunchSerial.get(id) ?? 0) + 1
    relaunchSerial.set(id, serial)
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(null) } }))
    }

    // Prefer the unified CLI Screen when it already has this agent (or any panes).
    // Focusing a type must not leave Screen mode or drop mixed panes.
    const focusOnCliScreen = (): boolean => {
      const s = get().workspaces[id]
      const surface = getCliSurface(s)
      if (!surface?.tabs.length) return false
      const tab =
        surface.tabs.find((t) => !t.pendingCli && t.agentId === agentId) ??
        surface.tabs.find((t) => !t.pendingCli) ??
        surface.tabs[0]
      if (!tab) return false
      patch(set, id, (prev) => {
        const cur = getCliSurface(prev) ?? surface
        return {
          cliMode: true,
          activeHostAgentId: CLI_SURFACE_KEY,
          agentHostSessions: {
            ...prev.agentHostSessions,
            [CLI_SURFACE_KEY]: { ...cur, activeTabId: tab.id }
          }
        }
      })
      return true
    }

    // Optimistic local restore — no IPC. Parked hosts keep agentHostSessions;
    // paint the terminal on this frame, reconcile with main in the background.
    let slice = get().workspaces[id]!
    if (focusOnCliScreen()) {
      void get().hydratePtyState(id)
      return 'restored'
    }
    if (isLiveAgentSession(getAgentHost(slice, agentId), agentId)) {
      // Legacy per-agent host only — promote into Screen so mixed panes can follow.
      get().enterCliMode(id)
      if (focusOnCliScreen()) {
        void get().hydratePtyState(id)
        return 'restored'
      }
      patch(set, id, () => ({ activeHostAgentId: agentId, cliMode: true }))
      void get().hydratePtyState(id)
      return 'restored'
    }

    // Multi-window / cold attach: project live PTYs from main, then re-check.
    // If we already listed this conversation, don't block the click — create()
    // still attaches via preferredId when the pane is live.
    if (get().ptyStatus[id] == null) await get().hydratePtyState(id)
    else void get().hydratePtyState(id)
    if (relaunchSerial.get(id) !== serial) return 'restored'

    slice = get().workspaces[id]!
    if (focusOnCliScreen()) return 'restored'
    if (isLiveAgentSession(getAgentHost(slice, agentId), agentId)) {
      get().enterCliMode(id)
      if (focusOnCliScreen()) return 'restored'
      patch(set, id, () => ({ activeHostAgentId: agentId, cliMode: true }))
      return 'restored'
    }

    // Scrub any legacy CLI agent tabs that leaked into the tools-tray list.
    patch(set, id, (s) => {
      const bash = userBashTabsOnly(s.tabs)
      const layoutStillValid =
        s.layout && collectLeaves(s.layout).every((leaf) => bash.some((t) => t.id === leaf))
      return {
        tabs: bash,
        layout: layoutStillValid ? s.layout : bash[0] ? { type: 'leaf', tabId: bash[0].id, weight: 1 } : null,
        activeTabId: bash.some((t) => t.id === s.activeTabId)
          ? s.activeTabId
          : (bash[0]?.id ?? '')
      }
    })

    slice = get().workspaces[id]!
    const existing = getAgentHost(slice, agentId)
    if (isLiveAgentSession(existing, agentId)) {
      if (relaunchSerial.get(id) !== serial) return 'restored'
      patch(set, id, () => ({ activeHostAgentId: agentId }))
      return 'restored'
    }

    // Stale host map with dead tab ids (PTY already exited) — drop local map only.
    // Do NOT kill here: those tab ids may already be gone; kill is no-op.
    if (existing) {
      for (const tab of existing.tabs) {
        terminalSinks.delete(sinkKey(id, tab.id))
        pendingMirrors.delete(sinkKey(id, tab.id))
      }
      patch(set, id, (s) => {
        const sessions = { ...s.agentHostSessions }
        delete sessions[agentId]
        return { agentHostSessions: sessions }
      })
    }

    // Prefer renderer settings (already hydrated) — avoid IPC on every switch.
    const agent = await resolveCliAgentConfig(agentId)
    if (!agent) {
      patch(set, id, () => ({ activeHostAgentId: null }))
      return 'missing'
    }

    const preferredId = primaryAgentPaneId(id, agentId)
    // Capture whether main already had this primary pane *before* create so a
    // multi-window race that attaches (preferredId hit) reports 'restored'.
    const hadPrimaryBefore = (get().ptyStatus[id] ?? {})[preferredId] != null

    // Paint the host map before spawn so TerminalHost / acquireTerminal run
    // during the IPC round-trip instead of after it.
    paintPrimaryAgentPane(set, id, agentId, preferredId, agent.name)

    let tabId: string
    try {
      // Stable preferredId: multi-window / re-activate attaches the same live
      // process instead of spawning a fresh CLI agent (Herdr live persistence).
      // Pass ambient context at spawn when strategy is launch-argv; prompt-paste
      // agents are filled after activate returns (SessionDetail).
      tabId = await get().newUserTerminal(
        id,
        cols,
        rows,
        agentId,
        initialContext,
        preferredId,
        { agent }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('AGENT_NOT_FOUND')) {
        unpaintPrimaryAgentPane(set, id, agentId, preferredId)
        return 'missing'
      }
      throw err
    }
    if (relaunchSerial.get(id) !== serial) {
      // Another activate won the race — leave the PTY if hydrate already owns it.
      await get().hydratePtyState(id)
      return hadPrimaryBefore ? 'restored' : 'created'
    }

    patch(set, id, (s) => {
      const sessions = { ...s.agentHostSessions }
      const existingHost = getAgentHost(s, agentId)
      if (!existingHost?.tabs.some((t) => t.id === tabId)) {
        sessions[agentId] = {
          tabs: [
            {
              id: tabId,
              title: agent.name,
              isAgent: false,
              agentId,
              splitWeight: 1
            }
          ],
          layout: { type: 'leaf', tabId, weight: 1 },
          activeTabId: tabId
        }
      }
      const surface = sessions[CLI_SURFACE_KEY]
      if (surface && tabId !== preferredId && surface.tabs.some((t) => t.id === preferredId)) {
        sessions[CLI_SURFACE_KEY] = replaceSurfaceTab(
          surface,
          preferredId,
          cliLiveTab(tabId, agentId, agent.name)
        )
      }
      return {
        cliMode: true,
        activeHostAgentId: CLI_SURFACE_KEY,
        agentHostSessions: sessions
      }
    })
    get().syncPtyLayouts(id)
    // Local map is already correct; reconcile other windows off the click path.
    void get().hydratePtyState(id)
    // preferredId hit means attach, not a new process — even if our pre-check
    // missed it (other window created between hydrate and create).
    if (hadPrimaryBefore || tabId === preferredId) {
      // If create returned the preferred id, it may still be a first spawn.
      // hadPrimaryBefore is the reliable attach signal; when false this is create.
      return hadPrimaryBefore ? 'restored' : 'created'
    }
    return 'created'
  },

  focusAgentHost(id, agentId) {
    const slice = get().workspaces[id]
    if (!slice) return
    // CLI Screen mode: focus a pane of this agent type inside the Screen.
    // Never re-key the surface to a per-agent host (that wiped mixed panes).
    const surface = getCliSurface(slice)
    if (slice.cliMode || surface) {
      const tab =
        surface?.tabs.find((t) => !t.pendingCli && t.agentId === agentId) ??
        surface?.tabs.find((t) => !t.pendingCli) ??
        surface?.tabs[0]
      if (tab) {
        patch(set, id, (s) => {
          const cur = getCliSurface(s) ?? surface!
          return {
            cliMode: true,
            activeHostAgentId: CLI_SURFACE_KEY,
            agentHostSessions: {
              ...s.agentHostSessions,
              [CLI_SURFACE_KEY]: { ...cur, activeTabId: tab.id }
            }
          }
        })
      }
      return
    }
    if (!isLiveAgentSession(getAgentHost(slice, agentId), agentId)) return
    if (slice.activeHostAgentId === agentId) return
    patch(set, id, () => ({ activeHostAgentId: agentId }))
  },

  parkAgentHost(id) {
    // Same as exitCliMode — keep agentHostSessions, clear surface flag + tray agent tabs.
    get().exitCliMode(id)
  },

  injectContextToActivePane(id, text, options) {
    const trimmed = text.trimEnd()
    if (!trimmed.trim()) return
    const submit = options?.submit !== false
    const delayMs = options?.delayMs ?? 0
    const fingerprint = options?.fingerprint
    const preferredAgentId = options?.agentId?.trim() || null

    const prevTimer = pendingInjectTimers.get(id)
    if (prevTimer != null) {
      window.clearTimeout(prevTimer)
      pendingInjectTimers.delete(id)
    }

    const run = (): void => {
      pendingInjectTimers.delete(id)
      const ws = get().workspaces[id]
      // Meta-driven agentId wins over whichever surface happens to be painted.
      const agentId =
        (preferredAgentId && getAgentHost(ws, preferredAgentId)
          ? preferredAgentId
          : null) ||
        ws?.activeHostAgentId ||
        preferredAgentId
      const host = agentId ? getAgentHost(ws, agentId) : null
      const tabId = host?.activeTabId || host?.tabs[0]?.id
        || (!preferredAgentId ? (ws?.activeTabId || ws?.tabs[0]?.id) : undefined)
      if (!tabId) return
      if (fingerprint) {
        if (lastInjectFingerprint.get(tabId) === fingerprint) return
        lastInjectFingerprint.set(tabId, fingerprint)
      }
      window.vav.pty.write(tabId, encodePtyPaste(trimmed, submit))
    }
    if (delayMs > 0) {
      pendingInjectTimers.set(id, window.setTimeout(run, delayMs))
    } else {
      run()
    }
  },

  selectTab(id, tabId) {
    const cur = get().workspaces[id]?.activeTabId
    if (cur === tabId) return
    patch(set, id, () => ({ activeTabId: tabId }))
  },

  selectAgentTab(id, tabId) {
    patch(set, id, (s) => {
      // Prefer unified CLI Screen whenever it exists (mixed-type panes).
      const key =
        s.agentHostSessions[CLI_SURFACE_KEY] != null || s.cliMode
          ? CLI_SURFACE_KEY
          : s.activeHostAgentId
      if (!key) return {}
      const host = getAgentHost(s, key)
      if (!host) return {}
      // Remember focused pane's agent type for install/prompt only — not UI tabs.
      const tab = host.tabs.find((t) => t.id === tabId)
      if (tab?.agentId && !tab.pendingCli) {
        void import('./sessionStore').then(({ useSessionStore }) => {
          void useSessionStore.getState().setAgentBinaryName(id, tab.agentId!)
        })
      }
      return {
        cliMode: key === CLI_SURFACE_KEY ? true : s.cliMode,
        activeHostAgentId: key,
        agentHostSessions: {
          ...s.agentHostSessions,
          [key]: { ...host, activeTabId: tabId }
        }
      }
    })
  },

  requestCloseTab(id, tabId) {
    get().closeTab(id, tabId)
  },

  setTerminalOutputExpanded(id, expanded) {
    patch(set, id, () => ({
      terminalOutputExpanded: expanded,
      terminalHasUnseenOutput: expanded ? false : get().workspaces[id]?.terminalHasUnseenOutput
    }))
  },

  closeTab(id, tabId) {
    void window.vav.pty.kill(tabId)
    terminalSinks.delete(sinkKey(id, tabId))
    pendingMirrors.delete(sinkKey(id, tabId))
    lastInjectFingerprint.delete(tabId)
    // Drop the status before the tab, or the next hydrate resurrects a
    // tombstone the user just dismissed.
    set((state) => {
      const forConversation = state.ptyStatus[id]
      if (!forConversation || !(tabId in forConversation)) return state
      return { ptyStatus: { ...state.ptyStatus, [id]: omit(forConversation, tabId) } }
    })
    patch(set, id, (s) => {
      const tabs = bashThenAgentTabs(userBashTabsOnly(s.tabs).filter((t) => t.id !== tabId))
      const layout = s.layout ? removeLeaf(s.layout, tabId) : null
      const nextActive =
        s.activeTabId === tabId ? (tabs[0]?.id ?? '') : s.activeTabId
      return {
        tabs,
        layout,
        activeTabId: nextActive
      }
    })
    get().syncPtyLayouts(id)
  },

  closeAgentTab(id, tabId) {
    // Pending picker panes have no PTY.
    const surface = getCliSurface(get().workspaces[id])
    const tabMeta =
      surface?.tabs.find((t) => t.id === tabId) ??
      (() => {
        const key = get().workspaces[id]?.activeHostAgentId
        return key
          ? getAgentHost(get().workspaces[id]!, key)?.tabs.find((t) => t.id === tabId)
          : undefined
      })()
    if (!tabMeta?.pendingCli) {
      void window.vav.pty.kill(tabId)
      // The pane is gone for good, so drop its xterm too. Agent panes share one
      // stable id per agent: a surviving buffer would resurface in the relaunch.
      disposeTerminal(id, tabId)
    }
    terminalSinks.delete(sinkKey(id, tabId))
    pendingMirrors.delete(sinkKey(id, tabId))
    lastInjectFingerprint.delete(tabId)
    patch(set, id, (s) => {
      const key =
        s.agentHostSessions[CLI_SURFACE_KEY] != null
          ? CLI_SURFACE_KEY
          : s.activeHostAgentId
      if (!key) return {}
      const host = getAgentHost(s, key)
      if (!host) return {}
      const tabs = host.tabs.filter((t) => t.id !== tabId)
      const layout = host.layout ? removeLeaf(host.layout, tabId) : null
      const nextActive =
        host.activeTabId === tabId ? (tabs[0]?.id ?? '') : host.activeTabId
      if (tabs.length === 0) {
        // Last CLI Screen pane: stay in CLI mode and show the initial agent picker.
        // (Do not bounce back to VAV chat.)
        if (key === CLI_SURFACE_KEY || s.cliMode) {
          const pending = makePendingCliTab()
          // Last live pane: always keep the picker. Skip-picker only applies
          // to enter / new split — auto-launch here would trap ⌘W in a spawn loop.
          return {
            cliMode: true,
            activeHostAgentId: CLI_SURFACE_KEY,
            agentHostSessions: {
              ...s.agentHostSessions,
              [CLI_SURFACE_KEY]: {
                tabs: [pending],
                layout: { type: 'leaf', tabId: pending.id, weight: 1 },
                activeTabId: pending.id
              }
            }
          }
        }
        const sessions = { ...s.agentHostSessions }
        delete sessions[key]
        return {
          activeHostAgentId: null,
          agentHostSessions: sessions
        }
      }
      return {
        agentHostSessions: {
          ...s.agentHostSessions,
          [key]: { tabs, layout, activeTabId: nextActive }
        }
      }
    })
    get().syncPtyLayouts(id)
  },

  notifyShellChanged() {
    // Existing PTYs keep their original shell; only new tabs pick up the change.
  },

  forgetLocalWorkspace(id) {
    dropLocalWorkspace(set, get, id, { killPty: false })
  },

  disposeConversation(id) {
    dropLocalWorkspace(set, get, id, { killPty: true })
  }
}))

function dropLocalWorkspace(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  get: () => WorkspaceState,
  id: string,
  opts: { killPty: boolean }
): void {
  const slice = get().workspaces[id]
  const allTabs = new Map<string, TerminalTab>()
  for (const tab of slice?.tabs ?? []) allTabs.set(tab.id, tab)
  for (const host of Object.values(slice?.agentHostSessions ?? {})) {
    for (const tab of host.tabs) allTabs.set(tab.id, tab)
  }
  for (const tab of allTabs.values()) {
    if (opts.killPty) void window.vav.pty.kill(tab.id)
    disposeTerminal(id, tab.id)
    terminalSinks.delete(sinkKey(id, tab.id))
    pendingMirrors.delete(sinkKey(id, tab.id))
    lastInjectFingerprint.delete(tab.id)
  }
  const timer = pendingInjectTimers.get(id)
  if (timer != null) {
    window.clearTimeout(timer)
    pendingInjectTimers.delete(id)
  }
  set((state) => ({
    workspaces: omit(state.workspaces, id),
    ptyStatus: omit(state.ptyStatus, id)
  }))
}

function cliLiveTab(tabId: string, agentId: string, title: string): TerminalTab {
  return {
    id: tabId,
    title,
    isAgent: false,
    agentId,
    pendingCli: false,
    splitWeight: 1
  }
}

function replaceSurfaceTab(
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

function patchCliSurfaceTab(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string,
  fromId: string,
  tab: TerminalTab
): void {
  patch(set, id, (s) => {
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
  })
}

function paintPrimaryAgentPane(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string,
  agentId: string,
  preferredId: string,
  title: string
): void {
  const tab = cliLiveTab(preferredId, agentId, title)
  patch(set, id, (s) => {
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
  })
}

function unpaintPrimaryAgentPane(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string,
  agentId: string,
  preferredId: string
): void {
  patch(set, id, (s) => {
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
  })
}

function patch(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string,
  updater: (slice: WorkspaceSlice) => Partial<WorkspaceSlice>
): void {
  set((state) => {
    const slice = state.workspaces[id]
    if (!slice) return state
    const next = updater(slice)
    const keys = Object.keys(next) as Array<keyof WorkspaceSlice>
    if (keys.length === 0) return state
    let changed = false
    for (const key of keys) {
      if (slice[key] !== next[key]) {
        changed = true
        break
      }
    }
    if (!changed) return state
    return { workspaces: { ...state.workspaces, [id]: { ...slice, ...next } } }
  })
}

function omit<T extends Record<string, unknown>>(record: T, key: string): T {
  const next = { ...record }
  delete next[key]
  return next
}

/** Routes debounced FSEvents notifications into the right workspace. */
export function installFsWatchBridge(): () => void {
  const onDirty = window.vav?.files?.onDirty
  if (!onDirty) return () => undefined
  return onDirty(({ conversationId, dirs }) => {
    void useWorkspaceStore.getState().refreshDirectories(conversationId, dirs)
  })
}

/** Streams PTY output into the mounted xterm for that tab. */
export function installPtyBridge(): () => void {
  const pty = window.vav?.pty
  if (!pty?.onData || !pty.onExit) return () => undefined
  const offData = pty.onData(({ tabId, data }) => {
    for (const [key, sink] of terminalSinks) {
      if (key.endsWith(`::${tabId}`)) sink(data)
    }
  })
  const offExit = pty.onExit((tabId) => {
    for (const [key, sink] of terminalSinks) {
      if (key.endsWith(`::${tabId}`)) sink('\r\n[process exited]\r\n')
    }
    // Keep the buffer readable, but never hand it to the next process on this
    // tab id (CLI agents relaunch into the same stable pane id).
    markTerminalProcessExited(tabId)
  })
  const offChanged = pty.onChanged
    ? pty.onChanged(({ conversationId }) => {
        // Only hydrate conversations this window already cares about.
        if (!useWorkspaceStore.getState().workspaces[conversationId]) return
        void useWorkspaceStore.getState().hydratePtyState(conversationId)
      })
    : () => {}
  // Unlike the other bridges this one tracks every conversation, not just the
  // bound ones — the sidebar needs a rollup for sessions it has never opened.
  const offStatus = pty.onStatus
    ? pty.onStatus(({ conversationId, tabId, status }) => {
        useWorkspaceStore.getState().setTabStatus(conversationId, tabId, status)
      })
    : () => {}
  return () => {
    offData()
    offExit()
    offChanged()
    offStatus()
  }
}
