import { create } from 'zustand'
import {
  contextLaunchStrategyForAgent,
  encodePtyPaste
} from '@shared/agentContextInject'

/** Last prompt-paste fingerprint per PTY tab — avoids stacking identical injects. */
const lastInjectFingerprint = new Map<string, string>()
/** Pending delayed inject timers keyed by conversation id. */
const pendingInjectTimers = new Map<string, number>()
import type { PtySessionMeta } from '@shared/ipc'
import {
  enabledCliAgents,
  normalizeFileSortKey,
  type AgentConfig,
  type FileEntry,
  type FileSortKey,
  type TerminalTab
} from '@shared/types'

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
    const fromSettings = state.settings.defaultWorkingDirectory?.trim()
    if (fromSettings) return fromSettings
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
    const fromSettings = settings.defaultWorkingDirectory?.trim()
    if (fromSettings) return fromSettings
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
 * Split direction for an individual split operation (not a global reflow).
 * Spec release 9ed447d6…:
 * - `row` = left/right (⌘D vertical split, flex-direction row)
 * - `column` = top/bottom (⌘⇧D horizontal split, flex-direction column)
 */
export type TerminalSplitAxis = 'row' | 'column'

/**
 * Binary split tree: each ⌘D / ⌘⇧D replaces the *active leaf* with a branch,
 * so directions compose independently (VS Code style).
 */
export type TerminalLayoutNode =
  | { type: 'leaf'; tabId: string; weight: number }
  | {
      type: 'branch'
      direction: TerminalSplitAxis
      weight: number
      children: [TerminalLayoutNode, TerminalLayoutNode]
    }

/** One CLI agent's terminal host layout — survives agent switching. */
export interface AgentHostSession {
  tabs: TerminalTab[]
  layout: TerminalLayoutNode | null
  activeTabId: string
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
   * Which CLI agent is shown in the main session surface (null = vav chat).
   * Agent PTYs live only in {@link agentHostSessions}, not in `tabs`.
   */
  activeHostAgentId: string | null
  /**
   * Main-surface CLI agent layouts keyed by agent id. Switching agents parks
   * here without touching user bash tabs. PTYs are not killed.
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
    activeHostAgentId: null,
    agentHostSessions: {},
    terminalOutputExpanded: false,
    terminalHasUnseenOutput: false
  }
}

/** Agent main-surface session from agentHostSessions (never user bash tabs). */
function getAgentHost(slice: WorkspaceSlice, agentId: string): AgentHostSession | undefined {
  return slice.agentHostSessions[agentId]
}

/** Drop any CLI-agent tabs that leaked into the user-bash list (legacy). */
function userBashTabsOnly(tabs: TerminalTab[]): TerminalTab[] {
  return tabs.filter((t) => !t.agentId || t.agentId === 'vav' || t.isAgent)
}

/** A host session is restorable only if it has panes that launched this agent. */
function isLiveAgentSession(session: AgentHostSession | undefined, agentId: string): boolean {
  if (!session?.layout || session.tabs.length === 0) return false
  return session.tabs.some((t) => t.agentId === agentId)
}

/** Replace the leaf with tabId by a branch(direction, [old, newLeaf]). */
function splitLeaf(
  node: TerminalLayoutNode,
  tabId: string,
  direction: TerminalSplitAxis,
  newTabId: string
): TerminalLayoutNode {
  if (node.type === 'leaf') {
    if (node.tabId !== tabId) return node
    return {
      type: 'branch',
      direction,
      weight: node.weight,
      children: [
        { type: 'leaf', tabId: node.tabId, weight: 1 },
        { type: 'leaf', tabId: newTabId, weight: 1 }
      ]
    }
  }
  return {
    ...node,
    children: [
      splitLeaf(node.children[0], tabId, direction, newTabId),
      splitLeaf(node.children[1], tabId, direction, newTabId)
    ]
  }
}

function removeLeaf(node: TerminalLayoutNode, tabId: string): TerminalLayoutNode | null {
  if (node.type === 'leaf') return node.tabId === tabId ? null : node
  const left = removeLeaf(node.children[0], tabId)
  const right = removeLeaf(node.children[1], tabId)
  if (!left && !right) return null
  if (!left) return { ...right!, weight: node.weight }
  if (!right) return { ...left, weight: node.weight }
  return { ...node, children: [left, right] }
}

function collectLeaves(node: TerminalLayoutNode | null): string[] {
  if (!node) return []
  if (node.type === 'leaf') return [node.tabId]
  return [...collectLeaves(node.children[0]), ...collectLeaves(node.children[1])]
}

/** Build a balanced-ish binary tree of leaves (row splits) for hydrated tabs. */
function layoutFromTabIds(tabIds: string[]): TerminalLayoutNode | null {
  if (tabIds.length === 0) return null
  if (tabIds.length === 1) return { type: 'leaf', tabId: tabIds[0]!, weight: 1 }
  const mid = Math.ceil(tabIds.length / 2)
  const left = layoutFromTabIds(tabIds.slice(0, mid))
  const right = layoutFromTabIds(tabIds.slice(mid))
  if (!left) return right
  if (!right) return left
  return {
    type: 'branch',
    direction: 'row',
    weight: 1,
    children: [
      { ...left, weight: 1 },
      { ...right, weight: 1 }
    ]
  }
}

function tabsEqual(a: TerminalTab[], b: TerminalTab[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.agentId !== y.agentId || x.title !== y.title || !!x.isAgent !== !!y.isAgent) {
      return false
    }
  }
  return true
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
    const la = collectLeaves(ha.layout).join(',')
    const lb = collectLeaves(hb.layout).join(',')
    if (la !== lb) return false
  }
  return true
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
      splitWeight: 1
    }
  })
  // Keep agent mirror first when present (product convention).
  tabs.sort((a, b) => Number(b.isAgent) - Number(a.isAgent))
  const bashIds = tabs.map((t) => t.id)
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

  return { tabs, layout, activeTabId, agentHostSessions }
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

  bindConversation(id: string, root: string | null): Promise<void>
  setWorkingDirectory(id: string, root: string | null): Promise<void>
  ensureFilesLoaded(id: string): Promise<void>
  loadDirectory(id: string, path: string): Promise<void>
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
    launchContext?: string | null
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
    axis?: TerminalSplitAxis
  ): Promise<void>
  /**
   * Split / new pane on the main-surface CLI agent host (⌘D / ⌘⇧D / ⌘T while agent active).
   */
  splitAgentHost(
    id: string,
    cols?: number,
    rows?: number,
    axis?: TerminalSplitAxis
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
   * Paste into the active CLI agent pane (focus handoff, block pick, draft).
   * Prefer launch argv for silent ambient bootstrap when the binary supports it.
   */
  injectContextToActivePane(
    id: string,
    text: string,
    options?: {
      submit?: boolean
      delayMs?: number
      /** Skip if this pane already received the same payload. */
      fingerprint?: string
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
  hydratePtyState(id: string): Promise<void>

  disposeConversation(id: string): void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: {},

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

  async hydratePtyState(id) {
    if (!window.vav.pty.list) return
    let sessions: PtySessionMeta[] = []
    try {
      sessions = await window.vav.pty.list(id)
    } catch {
      return
    }
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(null) } }))
    }
    const projected = projectPtySessions(sessions)
    patch(set, id, (s) => {
      // Preserve activeHostAgentId only while that host still has live panes.
      // Do NOT auto-pick a host from count alone — SessionDetail drives mode from
      // conversation.agentBinaryName and calls activateAgentHost to set this.
      let activeHostAgentId = s.activeHostAgentId
      if (activeHostAgentId && !projected.agentHostSessions[activeHostAgentId]) {
        activeHostAgentId = null
      }

      // Skip no-op patches to avoid re-render thrash on frequent pty:changed.
      if (
        tabsEqual(s.tabs, projected.tabs) &&
        agentHostsEqual(s.agentHostSessions, projected.agentHostSessions) &&
        s.activeHostAgentId === activeHostAgentId &&
        collectLeaves(s.layout).join(',') === collectLeaves(projected.layout).join(',')
      ) {
        return {}
      }

      // Prefer keeping the user's current active bash tab when it still exists.
      const activeTabId = projected.tabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : projected.activeTabId

      return {
        tabs: projected.tabs,
        layout: projected.layout,
        activeTabId,
        agentHostSessions: projected.agentHostSessions,
        activeHostAgentId
      }
    })
  },

  async setWorkingDirectory(id, root) {
    // A new root invalidates every cached level; tabs and PTYs are untouched.
    set((state) => {
      const previous = state.workspaces[id] ?? emptySlice(root)
      return {
        workspaces: {
          ...state.workspaces,
          [id]: {
            ...emptySlice(root),
            sort: previous.sort,
            ascending: previous.ascending,

            tabs: previous.tabs,
            activeTabId: previous.activeTabId,
            layout: previous.layout,
            activeHostAgentId: previous.activeHostAgentId,
            agentHostSessions: previous.agentHostSessions
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

  async loadDirectory(id, path) {
    const slice = get().workspaces[id]
    if (!slice) return
    if (slice.loadingDirs.includes(path)) return
    patch(set, id, (s) => ({ loadingDirs: [...s.loadingDirs, path] }))

    const listing = await window.vav.files.list(path, slice.sort, slice.ascending)
    // Normalize missing-path errors so the Files panel can show a calm empty state
    // instead of raw ENOENT stack noise (common for file-sessions whose dir is gone).
    const error = listing.error
      ? /enoent|no such file|not found/i.test(listing.error)
        ? 'ENOENT'
        : listing.error
      : undefined

    patch(set, id, (s) => ({
      loadingDirs: s.loadingDirs.filter((p) => p !== path),
      // Empty list on missing root so we don't keep a stale tree.
      dirs: error ? { ...s.dirs, [path]: [] } : { ...s.dirs, [path]: listing.entries },
      dirErrors: error ? { ...s.dirErrors, [path]: error } : omit(s.dirErrors, path),
      dirTruncated: { ...s.dirTruncated, [path]: listing.truncated }
    }))
  },

  async refreshDirectories(id, dirs) {
    const slice = get().workspaces[id]
    if (!slice) return
    // Only levels the user actually has open are worth re-reading.
    const relevant = dirs.filter((dir) => slice.dirs[dir] !== undefined)
    for (const dir of relevant) await get().loadDirectory(id, dir)
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
        tabs: [
          {
            id: AGENT_TAB_ID,
            title: 'VAV',
            isAgent: true,
            agentId: 'vav',
            splitWeight: 1
          },
          ...s.tabs
        ],
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
  async newUserTerminal(id, cols, rows, agentIdOverride, launchContext) {
    const slice = get().workspaces[id]
    // Absolute cwd only — node-pty rejects "~". Prefer in-memory state (no IPC).
    const cwd = await resolveTerminalCwd(id, slice?.root ?? null)

    // Tools tray / plain bash: never inherit session agentBinaryName.
    // Only explicit agent id spawns a CLI agent binary.
    const forAgentHost =
      typeof agentIdOverride === 'string' && agentIdOverride.length > 0 && agentIdOverride !== 'vav'
    const agent = forAgentHost ? await resolveCliAgentConfig(agentIdOverride) : null

    const strategy = contextLaunchStrategyForAgent(agent?.id)
    const tabId = await window.vav.pty.create(
      id,
      cwd,
      cols,
      rows,
      agent?.binaryPath
        ? {
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
            title: agent.name
          }
        : {
            agentId: null,
            title: 'bash'
          }
    )

    if (forAgentHost && agent) {
      // Caller (activate/splitAgentHost) folds this into agentHostSessions.
      return tabId
    }

    const bashTabs = userBashTabsOnly(slice?.tabs ?? [])
    const index = bashTabs.length + 1
    patch(set, id, (s) => ({
      tabs: [
        ...userBashTabsOnly(s.tabs),
        {
          id: tabId,
          title: `bash-${index}`,
          isAgent: false,
          agentId: null,
          splitWeight: 1
        }
      ],
      activeTabId: tabId
    }))
    return tabId
  },

  async newBash(id, cols = 80, rows = 24, axis: TerminalSplitAxis = 'row') {
    const slice = get().workspaces[id]
    const bashTabs = userBashTabsOnly(slice?.tabs ?? [])
    // First pane: single leaf, no split.
    if (!slice || bashTabs.length === 0 || !slice.layout) {
      const tabId = await get().newUserTerminal(id, cols, rows, null)
      patch(set, id, (s) => ({
        tabs: userBashTabsOnly(s.tabs),
        layout: { type: 'leaf', tabId, weight: 1 },
        activeTabId: tabId
      }))
      return
    }
    const focusId = slice.activeTabId || bashTabs[0]!.id
    const newTabId = await get().newUserTerminal(id, cols, rows, null)
    patch(set, id, (s) => {
      const tabs = userBashTabsOnly(s.tabs)
      const layout = s.layout ?? { type: 'leaf', tabId: focusId, weight: 1 }
      const focusInLayout = collectLeaves(layout).includes(focusId)
      const splitAt = focusInLayout ? focusId : (collectLeaves(layout)[0] ?? focusId)
      const nextLayout = splitLeaf(layout, splitAt, axis, newTabId)
      return {
        tabs,
        layout: nextLayout,
        activeTabId: newTabId
      }
    })
  },

  async splitAgentHost(id, cols = 80, rows = 24, axis: TerminalSplitAxis = 'row') {
    const slice = get().workspaces[id]
    const agentId = slice?.activeHostAgentId
    if (!agentId) return
    const host = getAgentHost(slice, agentId)
    const agent = await resolveCliAgentConfig(agentId)
    if (!agent) return

    if (!host || host.tabs.length === 0 || !host.layout) {
      try {
        const tabId = await get().newUserTerminal(id, cols, rows, agentId)
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
      return
    }

    const focusId = host.activeTabId || host.tabs[0]!.id
    let newTabId: string
    try {
      newTabId = await get().newUserTerminal(id, cols, rows, agentId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('AGENT_NOT_FOUND')) return
      throw err
    }
    patch(set, id, (s) => {
      const cur = getAgentHost(s, agentId) ?? host
      const layout = cur.layout ?? { type: 'leaf', tabId: focusId, weight: 1 }
      const focusInLayout = collectLeaves(layout).includes(focusId)
      const splitAt = focusInLayout ? focusId : (collectLeaves(layout)[0] ?? focusId)
      const nextLayout = splitLeaf(layout, splitAt, axis, newTabId)
      const tabs = [
        ...cur.tabs,
        {
          id: newTabId,
          title: `${agent.name}-${cur.tabs.length + 1}`,
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
  },

  async activateAgentHost(id, agentId, cols = 80, rows = 24, initialContext = null) {
    const serial = (relaunchSerial.get(id) ?? 0) + 1
    relaunchSerial.set(id, serial)
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(null) } }))
    }

    // Optimistic local restore — no IPC. Parked hosts keep agentHostSessions;
    // paint the terminal on this frame, reconcile with main in the background.
    let slice = get().workspaces[id]!
    if (isLiveAgentSession(getAgentHost(slice, agentId), agentId)) {
      patch(set, id, () => ({ activeHostAgentId: agentId }))
      void get().hydratePtyState(id)
      return 'restored'
    }

    // Multi-window / cold attach: project live PTYs from main, then re-check.
    await get().hydratePtyState(id)
    if (relaunchSerial.get(id) !== serial) return 'restored'

    slice = get().workspaces[id]!
    if (isLiveAgentSession(getAgentHost(slice, agentId), agentId)) {
      patch(set, id, () => ({ activeHostAgentId: agentId }))
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

    let tabId: string
    try {
      // Pass ambient context at spawn when strategy is launch-argv; prompt-paste
      // agents are filled after activate returns (SessionDetail).
      tabId = await get().newUserTerminal(id, cols, rows, agentId, initialContext)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('AGENT_NOT_FOUND')) {
        patch(set, id, (s) => {
          const sessions = { ...s.agentHostSessions }
          delete sessions[agentId]
          return { activeHostAgentId: null, agentHostSessions: sessions }
        })
        return 'missing'
      }
      throw err
    }
    if (relaunchSerial.get(id) !== serial) {
      // Another activate won the race — leave the PTY if hydrate already owns it.
      await get().hydratePtyState(id)
      return 'created'
    }

    patch(set, id, (s) => {
      const host: AgentHostSession = {
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
      return {
        activeHostAgentId: agentId,
        agentHostSessions: {
          ...s.agentHostSessions,
          [agentId]: host
        }
      }
    })
    // Align with main (and other windows) after spawn.
    await get().hydratePtyState(id)
    return 'created'
  },

  focusAgentHost(id, agentId) {
    const slice = get().workspaces[id]
    if (!slice) return
    if (!isLiveAgentSession(getAgentHost(slice, agentId), agentId)) return
    if (slice.activeHostAgentId === agentId) return
    patch(set, id, () => ({ activeHostAgentId: agentId }))
  },

  parkAgentHost(id) {
    const slice = get().workspaces[id]
    if (!slice?.activeHostAgentId) return
    // Keep agentHostSessions + user bash; only leave the main agent surface.
    patch(set, id, (s) => ({
      activeHostAgentId: null,
      tabs: userBashTabsOnly(s.tabs)
    }))
  },

  injectContextToActivePane(id, text, options) {
    const trimmed = text.trimEnd()
    if (!trimmed.trim()) return
    const submit = options?.submit !== false
    const delayMs = options?.delayMs ?? 0
    const fingerprint = options?.fingerprint

    const prevTimer = pendingInjectTimers.get(id)
    if (prevTimer != null) {
      window.clearTimeout(prevTimer)
      pendingInjectTimers.delete(id)
    }

    const run = (): void => {
      pendingInjectTimers.delete(id)
      const ws = get().workspaces[id]
      const agentId = ws?.activeHostAgentId
      const host = agentId ? getAgentHost(ws, agentId) : null
      const tabId = host?.activeTabId || host?.tabs[0]?.id || ws?.activeTabId || ws?.tabs[0]?.id
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
      const agentId = s.activeHostAgentId
      if (!agentId) return {}
      const host = getAgentHost(s, agentId)
      if (!host) return {}
      return {
        agentHostSessions: {
          ...s.agentHostSessions,
          [agentId]: { ...host, activeTabId: tabId }
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
    patch(set, id, (s) => {
      const tabs = userBashTabsOnly(s.tabs).filter((t) => t.id !== tabId)
      const layout = s.layout ? removeLeaf(s.layout, tabId) : null
      const nextActive =
        s.activeTabId === tabId ? (tabs[0]?.id ?? '') : s.activeTabId
      return {
        tabs,
        layout,
        activeTabId: nextActive
      }
    })
  },

  closeAgentTab(id, tabId) {
    void window.vav.pty.kill(tabId)
    terminalSinks.delete(sinkKey(id, tabId))
    pendingMirrors.delete(sinkKey(id, tabId))
    lastInjectFingerprint.delete(tabId)
    patch(set, id, (s) => {
      const agentId = s.activeHostAgentId
      if (!agentId) return {}
      const host = getAgentHost(s, agentId)
      if (!host) return {}
      const tabs = host.tabs.filter((t) => t.id !== tabId)
      const layout = host.layout ? removeLeaf(host.layout, tabId) : null
      const nextActive =
        host.activeTabId === tabId ? (tabs[0]?.id ?? '') : host.activeTabId
      if (tabs.length === 0) {
        const sessions = { ...s.agentHostSessions }
        delete sessions[agentId]
        return { activeHostAgentId: null, agentHostSessions: sessions }
      }
      return {
        agentHostSessions: {
          ...s.agentHostSessions,
          [agentId]: { tabs, layout, activeTabId: nextActive }
        }
      }
    })
  },

  notifyShellChanged() {
    // Existing PTYs keep their original shell; only new tabs pick up the change.
  },

  disposeConversation(id) {
    const slice = get().workspaces[id]
    const allTabs = new Map<string, TerminalTab>()
    for (const tab of slice?.tabs ?? []) allTabs.set(tab.id, tab)
    for (const host of Object.values(slice?.agentHostSessions ?? {})) {
      for (const tab of host.tabs) allTabs.set(tab.id, tab)
    }
    for (const tab of allTabs.values()) {
      void window.vav.pty.kill(tab.id)
      terminalSinks.delete(sinkKey(id, tab.id))
      pendingMirrors.delete(sinkKey(id, tab.id))
      lastInjectFingerprint.delete(tab.id)
    }
    const timer = pendingInjectTimers.get(id)
    if (timer != null) {
      window.clearTimeout(timer)
      pendingInjectTimers.delete(id)
    }
    set((state) => ({ workspaces: omit(state.workspaces, id) }))
  }
}))

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
  })
  const offChanged = pty.onChanged
    ? pty.onChanged(({ conversationId }) => {
        // Only hydrate conversations this window already cares about.
        if (!useWorkspaceStore.getState().workspaces[conversationId]) return
        void useWorkspaceStore.getState().hydratePtyState(conversationId)
      })
    : () => {}
  return () => {
    offData()
    offExit()
    offChanged()
  }
}
