import { create } from 'zustand'
import {
  contextLaunchStrategyForAgent,
  encodePtyPaste
} from '@shared/agentContextInject'
import {
  enabledCliAgents,
  normalizeFileSortKey,
  type FileEntry,
  type FileSortKey,
  type TerminalTab
} from '@shared/types'

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
  changedFiles: string[]
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
    changedFiles: [],
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
  /** Leave CLI main surface (keep agent PTYs parked; user bash untouched). */
  parkAgentHost(id: string): void
  /**
   * User-initiated paste into the active CLI agent pane (e.g. block pick).
   * Not used for silent session bootstrap — that goes through launch argv.
   */
  injectContextToActivePane(
    id: string,
    text: string,
    options?: { submit?: boolean; delayMs?: number }
  ): void
  selectTab(id: string, tabId: string): void
  selectAgentTab(id: string, tabId: string): void
  requestCloseTab(id: string, tabId: string): void
  closeTab(id: string, tabId: string): void
  closeAgentTab(id: string, tabId: string): void
  notifyShellChanged(): void

  disposeConversation(id: string): void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: {},

  async bindConversation(id, root) {
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(root) } }))
    }
    await window.vav.files.watch(id, root)
    await get().ensureFilesLoaded(id)
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
            changedFiles: previous.changedFiles,
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

    patch(set, id, (s) => ({
      loadingDirs: s.loadingDirs.filter((p) => p !== path),
      dirs: listing.error ? s.dirs : { ...s.dirs, [path]: listing.entries },
      dirErrors: listing.error
        ? { ...s.dirErrors, [path]: listing.error }
        : omit(s.dirErrors, path),
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

  agentDidWriteFile(id, parentPath, filePath) {
    patch(set, id, (s) => ({
      changedFiles: s.changedFiles.includes(filePath)
        ? s.changedFiles
        : [...s.changedFiles, filePath]
    }))
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
            title: 'vav',
            isAgent: true,
            agentId: 'vav',
            splitWeight: 1
          },
          ...s.tabs
        ],
        activeTabId: AGENT_TAB_ID,
        layout: s.layout ?? { type: 'leaf', tabId: AGENT_TAB_ID, weight: 1 }
      }))
    } else {
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
        }
      }
    }
    void get().ensureAgentPty(id)
  },

  async ensureAgentPty(id) {
    const slice = get().workspaces[id]
    const cwd = slice?.root ?? '~'
    await window.vav.pty.create(id, cwd, 80, 24, AGENT_TAB_ID)
  },

  /**
   * Spawn a PTY and register a tab.
   * - `agentIdOverride === null` / omit for user bash → plain shell into `tabs`
   * - `agentIdOverride` = CLI agent id → agent host session only (not tools tray)
   */
  async newUserTerminal(id, cols, rows, agentIdOverride, launchContext) {
    const slice = get().workspaces[id]
    const settings = await window.vav.settings.get()
    const metas = await window.vav.conversations.list()
    const meta = metas.find((c) => c.id === id)
    // Absolute cwd only — node-pty rejects "~".
    let cwd =
      (slice?.root && slice.root !== '~' ? slice.root : null) ??
      (meta?.workingDirectory && meta.workingDirectory !== '~' ? meta.workingDirectory : null) ??
      (settings.defaultWorkingDirectory?.trim() || null)
    if (!cwd) {
      const boot = await window.vav.bootstrap()
      cwd = boot.home || boot.tmp || '/'
    }

    // Tools tray / plain bash: never inherit session agentBinaryName.
    // Only explicit agent id spawns a CLI agent binary.
    const forAgentHost =
      typeof agentIdOverride === 'string' && agentIdOverride.length > 0 && agentIdOverride !== 'vav'
    const agent = forAgentHost
      ? enabledCliAgents(settings.cliAgents).find((a) => a.id === agentIdOverride) ?? null
      : null

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
            // Ambient focus context at spawn (Claude: --append-system-prompt-file).
            // Never paste into the TTY — that prints as garbage in the TUI.
            launchContext: launchContext?.trim() || null,
            contextLaunchStrategy: strategy
          }
        : undefined
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
    const settings = await window.vav.settings.get()
    const agent = enabledCliAgents(settings.cliAgents).find((a) => a.id === agentId)
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
    const slice = get().workspaces[id]!

    // Already active with a live host — keep (do not touch user bash).
    if (
      slice.activeHostAgentId === agentId &&
      isLiveAgentSession(getAgentHost(slice, agentId), agentId)
    ) {
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

    const existing = getAgentHost(get().workspaces[id]!, agentId)
    if (isLiveAgentSession(existing, agentId)) {
      if (relaunchSerial.get(id) !== serial) return 'restored'
      patch(set, id, () => ({ activeHostAgentId: agentId }))
      return 'restored'
    }

    // Drop dead placeholder for this agent id if any.
    if (existing) {
      for (const tab of existing.tabs) {
        void window.vav.pty.kill(tab.id)
        terminalSinks.delete(sinkKey(id, tab.id))
        pendingMirrors.delete(sinkKey(id, tab.id))
      }
    }

    const settings = await window.vav.settings.get()
    const agent = enabledCliAgents(settings.cliAgents).find((a) => a.id === agentId)
    if (!agent) {
      patch(set, id, () => ({ activeHostAgentId: null }))
      return 'missing'
    }

    let tabId: string
    try {
      // Pass ambient context at spawn (system-prompt file / argv) — never PTY paste.
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
      void window.vav.pty.kill(tabId)
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
    return 'created'
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
    const trimmed = text.trim()
    if (!trimmed) return
    const submit = options?.submit !== false
    const delayMs = options?.delayMs ?? 0
    const run = (): void => {
      const ws = get().workspaces[id]
      const agentId = ws?.activeHostAgentId
      const host = agentId ? getAgentHost(ws, agentId) : null
      const tabId = host?.activeTabId || host?.tabs[0]?.id || ws?.activeTabId || ws?.tabs[0]?.id
      if (!tabId) return
      void window.vav.pty.write(tabId, encodePtyPaste(trimmed, submit))
    }
    if (delayMs > 0) window.setTimeout(run, delayMs)
    else run()
  },

  selectTab(id, tabId) {
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
    return { workspaces: { ...state.workspaces, [id]: { ...slice, ...updater(slice) } } }
  })
}

function omit<T extends Record<string, unknown>>(record: T, key: string): T {
  const next = { ...record }
  delete next[key]
  return next
}

/** Routes debounced FSEvents notifications into the right workspace. */
export function installFsWatchBridge(): () => void {
  return window.vav.files.onDirty(({ conversationId, dirs }) => {
    void useWorkspaceStore.getState().refreshDirectories(conversationId, dirs)
  })
}

/** Streams PTY output into the mounted xterm for that tab. */
export function installPtyBridge(): () => void {
  const offData = window.vav.pty.onData(({ tabId, data }) => {
    for (const [key, sink] of terminalSinks) {
      if (key.endsWith(`::${tabId}`)) sink(data)
    }
  })
  const offExit = window.vav.pty.onExit((tabId) => {
    for (const [key, sink] of terminalSinks) {
      if (key.endsWith(`::${tabId}`)) sink('\r\n[process exited]\r\n')
    }
  })
  return () => {
    offData()
    offExit()
  }
}
