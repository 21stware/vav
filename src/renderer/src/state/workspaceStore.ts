import { create } from 'zustand'
import { normalizeFileSortKey, type FileEntry, type FileSortKey, type TerminalTab } from '@shared/types'

export const AGENT_TAB_ID = 'agent'

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
  tabs: TerminalTab[]
  activeTabId: string
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
    // No terminals up front. The agent's bash session is a session the agent
    // opens when it needs one, and a conversation that never runs a command
    // should not be carrying a shell tab around (terminal-panel.rpml).
    tabs: [],
    activeTabId: '',
    terminalOutputExpanded: false,
    terminalHasUnseenOutput: false
  }
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

  newUserTerminal(id: string, cols: number, rows: number): Promise<void>
  /** New bash: first tab is agent bash; later tabs are user shells. */
  newBash(id: string, cols?: number, rows?: number): Promise<void>
  selectTab(id: string, tabId: string): void
  requestCloseTab(id: string, tabId: string): void
  closeTab(id: string, tabId: string): void
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
            activeTabId: previous.activeTabId
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
      patch(set, id, (s) => ({
        tabs: [{ id: AGENT_TAB_ID, title: 'bash', isAgent: true }, ...s.tabs],
        activeTabId: AGENT_TAB_ID
      }))
    }
    void get().ensureAgentPty(id)
  },

  async ensureAgentPty(id) {
    const slice = get().workspaces[id]
    const cwd = slice?.root ?? '~'
    await window.vav.pty.create(id, cwd, 80, 24, AGENT_TAB_ID)
  },

  async newUserTerminal(id, cols, rows) {
    const slice = get().workspaces[id]
    const cwd = slice?.root ?? '~'
    const tabId = await window.vav.pty.create(id, cwd, cols, rows)
    patch(set, id, (s) => {
      const index = s.tabs.filter((t) => !t.isAgent).length + 1
      return {
        tabs: [...s.tabs, { id: tabId, title: `Shell ${index}`, isAgent: false }],
        activeTabId: tabId
      }
    })
  },

  async newBash(id, cols = 80, rows = 24) {
    const tabs = get().workspaces[id]?.tabs ?? []
    if (tabs.length === 0) {
      get().ensureAgentTab(id)
      return
    }
    await get().newUserTerminal(id, cols, rows)
  },

  selectTab(id, tabId) {
    patch(set, id, () => ({ activeTabId: tabId }))
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
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      return {
        tabs,
        activeTabId: s.activeTabId === tabId ? (tabs[0]?.id ?? '') : s.activeTabId
      }
    })
  },

  notifyShellChanged() {
    // Existing PTYs keep their original shell; only new tabs pick up the change.
  },

  disposeConversation(id) {
    const slice = get().workspaces[id]
    for (const tab of slice?.tabs ?? []) {
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
