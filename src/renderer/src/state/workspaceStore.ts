import { create } from 'zustand'
import {
  contextLaunchStrategyForAgent,
  encodePtyPaste
} from '@shared/agentContextInject'

/** Last prompt-paste fingerprint per PTY tab — avoids stacking identical injects. */
const lastInjectFingerprint = new Map<string, string>()
/** Pending delayed inject timers keyed by conversation id. */
const pendingInjectTimers = new Map<string, number>()
import type { PtyActivityStatus, PtySessionMeta } from '@shared/ipc'
import { makePendingCliTab, pendingTabFromId } from '../lib/cliPendingLayout'
import { shouldFollowRemotePtySurface } from '../lib/cliSurfaceAuthority'
import { collectLeaves, shouldRestoreCliLayoutAfterSync } from '../lib/workspaceLayout'
import {
  CLI_SURFACE_KEY,
  pendingCliPickerSurface,
  pickCliScreenFocusTab,
  planActivateAgentHostAfterSpawn,
  planCloseAgentTabPatch,
  planAppendCliSplitStorePatch,
  planEnterCliMode,
  planEnterCliModeStorePatch,
  planExitCliModeStorePatch,
  planFocusCliScreenPatch,
  planRestoreCliSurfaceLayout,
  planSelectAgentTabPatch,
  planSeedAgentHostPatch,
  planSplitAgentHostStorePatch,
  planSplitCliSurface,
  preferredCliAssignTabId,
  resolveCloseAgentTabMeta,
  resolveInjectAgentId,
  resolveInjectTabId,
  resolveSelectAgentTabKey,
  seedAgentHostSession,
  solePendingCliTabId,
  type AgentHostSession
} from '../lib/workspaceCliSurface'
import {
  getAgentHost,
  getCliSurface,
  paintedPrimaryAgentPane,
  patchedCliSurfaceTab,
  unpaintedPrimaryAgentPane
} from '../lib/workspacePanePaint'
import {
  emptySlice,
  nextExpandedPaths,
  normalizeDirListError,
  planDirListingPatch,
  planWorkingDirectorySlice,
  type WorkspaceSlice
} from '../lib/workspaceSlice'
import { planHydratedPtySlice } from '../lib/workspaceHydrate'
import {
  closeBashGroupPatch,
  closeBashTabWithGroupsPatch,
  planFirstBashTab,
  planNewBashTab,
  planSelectBashGroup,
  planSplitBashPane
} from '../lib/bashTabGroups'
import {
  AGENT_TAB_ID,
  buildConversationPtyLayouts,
  emptyPtyLayouts,
  ensureVavAgentTabPatch,
  isLiveAgentSession,
  mergePtyStatusPreservingExited,
  normalizePtyListResult,
  omitRecord,
  planAppendUserBashTab,
  projectPtySessions,
  ptyCreateOptions,
  ptyTabStatusPatch,
  omitPtyTabStatusPatch,
  isCliAgentHostId,
  toolsTrayAfterScrubbingAgentTabs,
  userBashTabsOnly
} from '../lib/workspacePty'
import { resolveSpawnGrid } from '../lib/spawnGrid'
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
import {
  isLocalMachine,
  normalizeMachineId,
  parseWorkspaceRefList,
  pruneForgottenWorkspaceDirs
} from '@shared/workspaceHost'
import { focusedCliPaneId, measureCliPaneRects } from '../lib/cliPaneNavigate'
import { cwdFromSliceOrMeta } from '../lib/terminalCwd'

export type { TerminalLayoutNode, TerminalSplitAxis }
export { CLI_SURFACE_KEY, makePendingCliTab, type AgentHostSession }
export { AGENT_TAB_ID }
export type { WorkspaceSlice }

/**
 * After ENOENT on a workspace root, remove it from recent/pinned lists.
 * Uses settings.update so main broadcasts the pruned list to all windows.
 */
async function forgetMissingWorkspaceDir(path: string, machineId?: string | null): Promise<void> {
  try {
    const { useSessionStore } = await import('./sessionStore')
    const settings = useSessionStore.getState().settings
    const next = pruneForgottenWorkspaceDirs(
      parseWorkspaceRefList(settings.recentWorkspaceDirectories),
      settings.pinnedWorkspaceDirectories ?? [],
      path,
      machineId
    )
    if (!next) return
    await window.vav.settings.update({
      recentWorkspaceDirectories: next.recent,
      pinnedWorkspaceDirectories: next.pinned
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
    const fromStore = cwdFromSliceOrMeta({
      sliceRoot: null,
      workingDirectory: meta?.workingDirectory,
      machineId: meta?.machineId,
      defaultWorkingDirectory: state.settings.defaultWorkingDirectory,
      hostHome: meta
        ? state.hosts.find((h) => h.id === normalizeMachineId(meta.machineId))?.home
        : null,
      isLocalMachine
    })
    if (fromStore) return fromStore
  } catch {
    // fall through to IPC
  }
  try {
    const [settings, metas] = await Promise.all([
      window.vav.settings.get(),
      window.vav.conversations.list()
    ])
    const meta = metas.find((c) => c.id === conversationId)
    const fromIpc = cwdFromSliceOrMeta({
      sliceRoot: null,
      workingDirectory: meta?.workingDirectory,
      machineId: meta?.machineId,
      defaultWorkingDirectory: settings.defaultWorkingDirectory,
      isLocalMachine
    })
    if (fromIpc) return fromIpc
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

/**
 * Stable primary pane id for a conversation's CLI agent host.
 * Multi-window activate races resolve to one live process (Herdr ensure).
 * Extra splits use random UUIDs via {@link newUserTerminal} without preferredId.
 */
export function primaryAgentPaneId(conversationId: string, agentId: string): string {
  return `agent-host:${agentId}:${conversationId}`
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
   * User bash only (Tools tray). ⌘T — new parallel tab chip (never splits).
   * Always plain shell — never spawns a CLI agent.
   */
  newBash(
    id: string,
    cols?: number,
    rows?: number,
    extras?: NewBashOptions
  ): Promise<string>
  /**
   * Split the focused bash pane inside the active tab group (⌘D when bash focused).
   * - axis `row` = left/right
   * - axis `column` = top/bottom (⌘⇧D)
   */
  splitBash(
    id: string,
    cols?: number,
    rows?: number,
    axis?: TerminalSplitAxis,
    extras?: NewBashOptions
  ): Promise<string>
  /** Switch the visible bash tab chip (parallel tabs). */
  selectBashGroup(id: string, groupId: string): void
  /** Close every bash pane that belongs to one tab chip. */
  closeBashGroup(id: string, groupId: string): void
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
    set((state) => ptyTabStatusPatch(state.ptyStatus, conversationId, tabId, status) ?? state)
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
      const { next, unchanged } = mergePtyStatusPreservingExited(current, sessions)
      if (unchanged) return state
      return { ptyStatus: { ...state.ptyStatus, [id]: next } }
    })
    const status = get().ptyStatus[id] ?? {}
    const projected = projectPtySessions(sessions)
    let followRemote = opts?.acceptRemoteSurface === true
    if (!followRemote && !isCompanionSessionShell()) {
      try {
        const { useSessionStore } = await import('./sessionStore')
        followRemote = shouldFollowRemotePtySurface({
          acceptRemoteSurface: false,
          isCompanion: false,
          conversationId: id,
          detachedIds: useSessionStore.getState().detachedConversationIds
        })
      } catch {
        followRemote = false
      }
    }
    patch(set, id, (s) =>
      planHydratedPtySlice(s, {
        followRemote,
        remoteLayouts,
        projected,
        status
      })
    )
  },

  async syncPtyLayouts(id) {
    const setLayouts = window.vav?.pty?.setLayouts
    if (typeof setLayouts !== 'function') return
    // Snapshot at call time — do not re-read after await (hydrate may race and
    // momentarily hold a flattened row tree from layoutFromTabIds).
    const slice = get().workspaces[id]
    if (!slice) return
    const payload = buildConversationPtyLayouts(slice)
    try {
      await setLayouts(id, payload)
      // If hydrate flattened local axes while IPC was in flight, restore the
      // tree we just persisted (column vs row lives only in this snapshot).
      const sentCli = payload.agents[CLI_SURFACE_KEY] ?? null
      const now = getCliSurface(get().workspaces[id])
      if (!shouldRestoreCliLayoutAfterSync(sentCli, now)) return
      patch(set, id, (s) => planRestoreCliSurfaceLayout(s, sentCli))
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
          [id]: planWorkingDirectorySlice(prev, root)
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
    const error = normalizeDirListError(listing.error)
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

    patch(set, id, (s) => planDirListingPatch(s, path, nextEntries, listing, error))
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
      expanded: nextExpandedPaths(s.expanded, path, isExpanded)
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
      patch(set, id, (s) => ensureVavAgentTabPatch(s))
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
    const forAgentHost = isCliAgentHostId(agentIdOverride)
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
      ptyCreateOptions({
        preferredId,
        agent,
        launchContext,
        contextLaunchStrategy: strategy,
        extras
      })
    )

    // Main may have minted (or attached) a different id than we guessed.
    resetTerminalForNewProcess(id, tabId)

    if (forAgentHost && agent) {
      // Caller (activate/splitAgentHost) folds this into agentHostSessions.
      return tabId
    }

    const bashTabs = userBashTabsOnly(slice?.tabs ?? [])
    const index = bashTabs.length + 1
    patch(set, id, (s) => planAppendUserBashTab(s.tabs, tabId, extras, index))
    return tabId
  },

  async newBash(id, cols = 80, rows = 24, extras) {
    const slice = get().workspaces[id]
    const bashTabs = userBashTabsOnly(slice?.tabs ?? [])
    if (!slice || bashTabs.length === 0 || !slice.layout) {
      const tabId = await get().newUserTerminal(id, cols, rows, null, undefined, undefined, extras)
      patch(set, id, (s) => planFirstBashTab(s.tabs, tabId, extras))
      get().syncPtyLayouts(id)
      return tabId
    }
    const tabId = await get().newUserTerminal(id, cols, rows, null, undefined, undefined, extras)
    patch(set, id, (s) => planNewBashTab(s, tabId, extras))
    get().syncPtyLayouts(id)
    return tabId
  },

  async splitBash(id, cols = 80, rows = 24, axis: TerminalSplitAxis = 'row', extras) {
    const slice = get().workspaces[id]
    const bashTabs = userBashTabsOnly(slice?.tabs ?? [])
    if (!slice || bashTabs.length === 0 || !slice.layout) {
      return get().newBash(id, cols, rows, extras)
    }
    const focusId = slice.activeTabId || bashTabs[0]!.id
    const newTabId = await get().newUserTerminal(id, cols, rows, null, undefined, undefined, extras)
    patch(set, id, (s) => planSplitBashPane(s, { focusId, newTabId, axis, extras }))
    get().syncPtyLayouts(id)
    return newTabId
  },

  selectBashGroup(id, groupId) {
    patch(set, id, (s) => {
      const plan = planSelectBashGroup(s, groupId)
      return plan ?? {}
    })
    get().syncPtyLayouts(id)
  },

  closeBashGroup(id, groupId) {
    const slice = get().workspaces[id]
    if (!slice) return
    const node = slice.bashGroups?.layouts[groupId]
    const ids = node ? collectLeaves(node) : [groupId]
    for (const tabId of ids) {
      void window.vav.pty.kill(tabId)
      disposeTerminal(id, tabId)
      terminalSinks.delete(sinkKey(id, tabId))
      pendingMirrors.delete(sinkKey(id, tabId))
      lastInjectFingerprint.delete(tabId)
    }
    set((state) => {
      let ptyStatus = state.ptyStatus
      let changed = false
      for (const tabId of ids) {
        const next = omitPtyTabStatusPatch(ptyStatus, id, tabId)
        if (!next) continue
        ptyStatus = next.ptyStatus
        changed = true
      }
      return changed ? { ptyStatus } : state
    })
    patch(set, id, (s) => closeBashGroupPatch(s, groupId))
    get().syncPtyLayouts(id)
  },

  enterCliMode(id) {
    if (!id) return
    if (!get().workspaces[id]) {
      set((state) => ({ workspaces: { ...state.workspaces, [id]: emptySlice(null) } }))
    }
    const plan = planEnterCliMode(get().workspaces[id]!)
    if (plan.kind === 'noop') return
    patch(set, id, (s) => planEnterCliModeStorePatch(s, plan.surface))
    get().syncPtyLayouts(id)
    if (plan.autoAssignPendingId) {
      maybeAutoAssignSingleAgent(id, plan.autoAssignPendingId, 'enter')
    }
  },

  exitCliMode(id) {
    if (!id) return
    const slice = get().workspaces[id]
    if (!slice) return
    // Idempotent — openChatMode / menu / park callers may stack.
    if (!slice.cliMode && !slice.activeHostAgentId) return
    // Drop agent-owned bash tabs from the tray; keep user shells.
    patch(set, id, (s) => planExitCliModeStorePatch(s))
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
    const plan = planSplitCliSurface(surface, axis, pending)
    if (!plan) return
    if (plan.kind === 'seed') {
      patch(set, id, (s) => planEnterCliModeStorePatch(s, plan.surface))
      if (autoAssign) maybeAutoAssignSingleAgent(id, pending.id, 'split')
      return
    }
    patch(set, id, (s) => planAppendCliSplitStorePatch(s, surface, pending, plan.layout))
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
    const preferred = preferredCliAssignTabId({
      surface,
      tabId,
      agentId,
      resume: Boolean(resume),
      primaryId: primaryAgentPaneId(id, agentId)
    })
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
      patch(set, id, (s) =>
        planEnterCliModeStorePatch(s, pendingCliPickerSurface(pending))
      )
      surface = getCliSurface(get().workspaces[id])
    }

    let tabId = solePendingCliTabId(surface)
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
        patch(set, id, (s) =>
          planSeedAgentHostPatch(s, agentId, seedAgentHostSession(tabId, agentId, agent.name))
        )
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
    patch(set, id, (s) =>
      planSplitAgentHostStorePatch(s, agentId, host, {
        focusId,
        newTabId,
        axis,
        agentName: agent.name
      })
    )
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
      const tab = pickCliScreenFocusTab(surface.tabs, agentId)
      if (!tab) return false
      patch(set, id, (prev) => planFocusCliScreenPatch(prev, surface, tab.id))
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
    patch(set, id, (s) => toolsTrayAfterScrubbingAgentTabs(s))

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
      patch(set, id, (s) => ({
        agentHostSessions: omitRecord(s.agentHostSessions, agentId)
      }))
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

    patch(set, id, (s) =>
      planActivateAgentHostAfterSpawn(s, {
        agentId,
        tabId,
        preferredId,
        title: agent.name
      })
    )
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
      const tab = pickCliScreenFocusTab(surface?.tabs ?? [], agentId)
      if (tab && surface) {
        patch(set, id, (s) => planFocusCliScreenPatch(s, surface, tab.id))
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
      const agentId = resolveInjectAgentId(
        preferredAgentId,
        !!(preferredAgentId && getAgentHost(ws, preferredAgentId)),
        ws?.activeHostAgentId
      )
      const host = agentId ? getAgentHost(ws, agentId) : null
      const tabId = resolveInjectTabId(preferredAgentId, host, ws)
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
      const key = resolveSelectAgentTabKey(s)
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
      return planSelectAgentTabPatch(s, key, host, tabId)
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
    disposeTerminal(id, tabId)
    terminalSinks.delete(sinkKey(id, tabId))
    pendingMirrors.delete(sinkKey(id, tabId))
    lastInjectFingerprint.delete(tabId)
    // Drop the status before the tab, or the next hydrate resurrects a
    // tombstone the user just dismissed.
    set((state) => omitPtyTabStatusPatch(state.ptyStatus, id, tabId) ?? state)
    patch(set, id, (s) => closeBashTabWithGroupsPatch(s, tabId))
    get().syncPtyLayouts(id)
  },

  closeAgentTab(id, tabId) {
    // Pending picker panes have no PTY.
    const tabMeta = resolveCloseAgentTabMeta(get().workspaces[id], tabId)
    if (!tabMeta?.pendingCli) {
      void window.vav.pty.kill(tabId)
      // The pane is gone for good, so drop its xterm too. Agent panes share one
      // stable id per agent: a surviving buffer would resurface in the relaunch.
      disposeTerminal(id, tabId)
    }
    terminalSinks.delete(sinkKey(id, tabId))
    pendingMirrors.delete(sinkKey(id, tabId))
    lastInjectFingerprint.delete(tabId)
    patch(set, id, (s) => planCloseAgentTabPatch(s, tabId, makePendingCliTab))
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
    workspaces: omitRecord(state.workspaces, id),
    ptyStatus: omitRecord(state.ptyStatus, id)
  }))
}

function patchCliSurfaceTab(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string,
  fromId: string,
  tab: TerminalTab
): void {
  patch(set, id, (s) => patchedCliSurfaceTab(s, fromId, tab))
}

function paintPrimaryAgentPane(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string,
  agentId: string,
  preferredId: string,
  title: string
): void {
  patch(set, id, (s) => paintedPrimaryAgentPane(s, agentId, preferredId, title))
}

function unpaintPrimaryAgentPane(
  set: (fn: (state: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string,
  agentId: string,
  preferredId: string
): void {
  patch(set, id, (s) => unpaintedPrimaryAgentPane(s, agentId, preferredId))
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
