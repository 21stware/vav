import { create } from 'zustand'
import type {
  AboutInfo,
  AppSettings,
  ChatMessage,
  ConversationMeta,
  TurnPhase
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { threadPath } from '@shared/thread'
import { getProjection, disposeProjection } from './StreamProjection'
import { useWorkspaceStore } from './workspaceStore'

export type SettingsCategory = 'api' | 'workspace' | 'appearance' | 'about'

export interface TurnRuntime {
  isRunning: boolean
  phase: TurnPhase
  toolCount: number
  awaitingToolCallId: string | null
}

const IDLE_TURN: TurnRuntime = {
  isRunning: false,
  phase: 'idle',
  toolCount: 0,
  awaitingToolCallId: null
}

export interface DialogState {
  title: string
  body: string
  confirmLabel: string
  destructive?: boolean
  /** Omit for a message-only alert with a single dismiss button. */
  onConfirm?: () => void
}

export interface SearchState {
  open: boolean
  query: string
  matchIds: string[]
  index: number
  /** Bumped on every navigation so scroll-to-match re-fires on the same id. */
  tick: number
}

interface LayoutPrefs {
  sidebarVisible: boolean
  toolsCollapsed: boolean
  panelSegment: 'files' | 'terminal'
  panelHeight: number
}

export const PANEL_MIN_HEIGHT = 160
export const PANEL_MAX_HEIGHT = 480
const LAYOUT_KEY = 'vav.layout'

function loadLayout(): LayoutPrefs {
  const fallback: LayoutPrefs = {
    sidebarVisible: true,
    toolsCollapsed: false,
    panelSegment: 'files',
    panelHeight: 240
  }
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function saveLayout(prefs: LayoutPrefs): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode or a full quota: layout simply falls back to defaults.
  }
}

interface SessionState extends LayoutPrefs {
  ready: boolean
  home: string
  tmp: string
  about: AboutInfo | null

  settings: AppSettings
  apiKeyHint: string | null

  conversations: ConversationMeta[]
  activeId: string
  selectedIds: string[]
  sidebarQuery: string
  renamingId: string | null
  /** Set in a detached window, which follows exactly one conversation. */
  pinnedConversationId: string | null

  /** Every node of each conversation's tree; the visible thread is derived. */
  messages: Record<string, ChatMessage[]>
  /** Which leaf each conversation currently follows. */
  activeLeaf: Record<string, string | null>
  turns: Record<string, TurnRuntime>
  /** Composer state is per conversation, like the rest of its ChatStore. */
  drafts: Record<string, string>
  attachments: Record<string, string[]>

  search: SearchState
  errorBanner: string | null
  dialog: DialogState | null
  settingsCategory: SettingsCategory
  shortcutsOpen: boolean
  composerFocusTick: number

  /** A detached window passes the one conversation it exists to show. */
  bootstrap(pinnedConversationId?: string): Promise<void>
  selectConversation(id: string, options?: { additive?: boolean; range?: boolean }): Promise<void>
  loadMessages(id: string): Promise<void>
  createConversation(): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  beginRename(id: string | null): void
  requestDelete(ids: string[]): void
  setModel(id: string, model: string): Promise<void>
  pickWorkingDirectory(id: string): Promise<void>
  setSidebarQuery(query: string): void
  setPinned(id: string, pinned: boolean): Promise<void>
  openDetached(id: string): Promise<void>

  setDraft(id: string, text: string): void
  setAttachments(id: string, paths: string[]): void
  send(text: string, attachments: string[]): Promise<void>
  cancel(id: string): Promise<void>
  answerTool(toolCallId: string, answer: string): Promise<void>
  regenerate(messageId: string): Promise<void>
  editUserMessage(messageId: string, text: string): Promise<void>
  selectBranch(messageId: string): Promise<void>
  selectPendingBranch(parentKey: string): Promise<void>
  fork(messageId: string): Promise<void>
  continueInNewSession(messageId: string): Promise<void>

  updateSettings(patch: Partial<AppSettings>): Promise<void>
  refreshApiKeyHint(): Promise<void>
  resetSettings(): Promise<void>
  openSettings(category?: SettingsCategory): void
  closeSettings(): void
  setShortcutsOpen(open: boolean): void

  openSearch(): void
  closeSearch(): void
  setSearchQuery(query: string): void
  stepSearch(direction: 1 | -1): void

  setErrorBanner(message: string | null): void
  showDialog(dialog: DialogState): void
  closeDialog(): void

  toggleSidebar(): void
  toggleToolsPanel(): void
  setPanelSegment(segment: 'files' | 'terminal'): void
  togglePanelSegment(): void
  setPanelHeight(height: number): void
  focusComposer(): void

  applyTurnEvent(event: import('@shared/types').TurnEvent): void
}

const layout = loadLayout()

export const useSessionStore = create<SessionState>((set, get) => ({
  ...layout,
  ready: false,
  home: '',
  tmp: '',
  about: null,

  settings: DEFAULT_SETTINGS,
  apiKeyHint: null,

  conversations: [],
  activeId: '',
  selectedIds: [],
  sidebarQuery: '',
  renamingId: null,
  pinnedConversationId: null,

  messages: {},
  activeLeaf: {},
  turns: {},
  drafts: {},
  attachments: {},

  search: { open: false, query: '', matchIds: [], index: 0, tick: 0 },
  errorBanner: null,
  dialog: null,
  settingsCategory: 'api',
  shortcutsOpen: false,
  composerFocusTick: 0,

  async bootstrap(pinnedConversationId) {
    const data = await window.vav.bootstrap()
    const activeId = pinnedConversationId ?? data.activeConversationId

    set({
      ready: true,
      settings: data.settings,
      apiKeyHint: data.apiKeyHint,
      conversations: data.conversations,
      activeId,
      selectedIds: activeId ? [activeId] : [],
      pinnedConversationId: pinnedConversationId ?? null,
      home: data.home,
      tmp: data.tmp,
      about: data.about
    })
    if (activeId) await get().selectConversation(activeId)
  },

  async selectConversation(id, options) {
    const { selectedIds, activeId, conversations } = get()
    let nextSelection = [id]
    if (options?.additive) {
      nextSelection = selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id]
      if (nextSelection.length === 0) nextSelection = [id]
    } else if (options?.range && activeId) {
      const ids = conversations.map((c) => c.id)
      const from = ids.indexOf(activeId)
      const to = ids.indexOf(id)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        nextSelection = ids.slice(start, end + 1)
      }
    }

    // Switching never cancels an in-flight turn; it only rebinds the detail column.
    set({ activeId: id, selectedIds: nextSelection })
    await get().loadMessages(id)

    const conversation = get().conversations.find((c) => c.id === id)
    await useWorkspaceStore.getState().bindConversation(id, conversation?.workingDirectory ?? null)

    const status = await window.vav.agent.status(id)
    set((state) => ({
      turns: {
        ...state.turns,
        [id]: {
          isRunning: status.isRunning,
          phase: status.phase,
          toolCount: status.toolCount,
          awaitingToolCallId: status.awaitingToolCallId
        }
      }
    }))
  },

  async loadMessages(id) {
    if (get().messages[id]) return
    const conversation = await window.vav.conversations.get(id)
    if (!conversation) return
    set((state) => ({
      messages: { ...state.messages, [id]: conversation.messages },
      activeLeaf: { ...state.activeLeaf, [id]: conversation.activeLeafId }
    }))
  },

  async createConversation() {
    const meta = await window.vav.conversations.create()
    set((state) => ({
      conversations: [meta, ...state.conversations],
      messages: { ...state.messages, [meta.id]: [] },
      activeLeaf: { ...state.activeLeaf, [meta.id]: null }
    }))
    await get().selectConversation(meta.id)
    get().focusComposer()
  },

  async renameConversation(id, title) {
    const conversations = await window.vav.conversations.rename(id, title)
    set({ conversations, renamingId: null })
  },

  beginRename(id) {
    set({ renamingId: id })
  },

  requestDelete(ids) {
    const { conversations } = get()
    const targets = ids.filter((id) => conversations.some((c) => c.id === id))
    if (targets.length === 0) return

    // Guard first: the product always keeps at least one conversation.
    if (targets.length >= conversations.length) {
      get().showDialog({
        title: '至少保留一个会话',
        body: 'vav 始终保留至少一个会话。请先创建新会话再删除当前。',
        confirmLabel: '好'
      })
      return
    }

    const single = targets.length === 1
    const title = single
      ? '删除会话'
      : `删除 ${targets.length} 个会话`
    const name = conversations.find((c) => c.id === targets[0])?.title ?? ''
    const body = single
      ? `确定删除「${name}」？此操作不可撤销。进行中的 agent 回合将被终止。`
      : `确定删除选中的 ${targets.length} 个会话？此操作不可撤销。进行中的 agent 回合将被终止。`

    get().showDialog({
      title,
      body,
      confirmLabel: '删除',
      destructive: true,
      onConfirm: async () => {
        const { removed, conversations: next } = await window.vav.conversations.remove(targets)
        for (const id of removed) {
          disposeProjection(id)
          useWorkspaceStore.getState().disposeConversation(id)
        }
        set((state) => {
          const messages = { ...state.messages }
          const activeLeaf = { ...state.activeLeaf }
          const turns = { ...state.turns }
          for (const id of removed) {
            delete messages[id]
            delete activeLeaf[id]
            delete turns[id]
          }
          return { conversations: next, messages, activeLeaf, turns }
        })
        if (removed.includes(get().activeId)) {
          const fallback = next[0]?.id
          if (fallback) await get().selectConversation(fallback)
        }
      }
    })
  },

  async setModel(id, model) {
    const conversations = await window.vav.conversations.setModel(id, model)
    set({ conversations })
  },

  async pickWorkingDirectory(id) {
    const conversations = await window.vav.conversations.pickWorkingDirectory(id)
    if (!conversations) return
    set({ conversations })
    const next = conversations.find((c) => c.id === id)?.workingDirectory ?? null
    await useWorkspaceStore.getState().setWorkingDirectory(id, next)
  },

  setSidebarQuery(query) {
    set({ sidebarQuery: query })
  },

  async setPinned(id, pinned) {
    const conversations = await window.vav.conversations.setPinned(id, pinned)
    set({ conversations })
  },

  async openDetached(id) {
    await window.vav.window.openSession(id)
  },

  setDraft(id, text) {
    set((state) => ({ drafts: { ...state.drafts, [id]: text } }))
  },

  setAttachments(id, paths) {
    set((state) => ({ attachments: { ...state.attachments, [id]: paths } }))
  },

  async send(text, attachments) {
    const { activeId, settings, turns } = get()
    if (!activeId) return
    if (turns[activeId]?.isRunning) return
    if (!text.trim() && attachments.length === 0) return

    if (!settings.apiKeyPresent) {
      get().showDialog({
        title: '提示',
        body: '请先配置 API Key。',
        confirmLabel: '打开 Settings',
        onConfirm: () => get().openSettings('api')
      })
      return
    }

    // No optimistic echo: the stored message comes back as a `user` turn event
    // a moment later, already carrying the id and parent the tree needs.
    set((state) => ({
      drafts: { ...state.drafts, [activeId]: '' },
      attachments: { ...state.attachments, [activeId]: [] },
      errorBanner: null
    }))

    await window.vav.agent.send(activeId, text, attachments)
  },

  async regenerate(messageId) {
    const state = get()
    const { activeId } = state
    if (!activeId || state.turns[activeId]?.isRunning) return
    // Drop back to the prompt right away, or the reply being replaced would sit
    // above the stream and look like one more record.
    const target = state.messages[activeId]?.find((m) => m.id === messageId)
    if (!target) return
    setLeaf(set, state, activeId, target.role === 'assistant' ? target.parentId : target.id)
    set({ errorBanner: null })
    await window.vav.agent.regenerate(activeId, messageId)
  },

  async editUserMessage(messageId, text) {
    const state = get()
    const { activeId } = state
    if (!activeId || state.turns[activeId]?.isRunning || !text.trim()) return
    const target = state.messages[activeId]?.find((m) => m.id === messageId)
    if (!target) return
    setLeaf(set, state, activeId, target.parentId)
    set({ errorBanner: null })
    await window.vav.agent.editUserMessage(activeId, messageId, text)
  },

  async selectBranch(messageId) {
    const { activeId } = get()
    if (!activeId) return
    const leaf = await window.vav.conversations.selectBranch(activeId, messageId)
    set((state) => ({ activeLeaf: { ...state.activeLeaf, [activeId]: leaf } }))
  },

  /**
   * Shows the branch that has nothing in it yet.
   *
   * Named by where it starts rather than by a message, and selected literally:
   * following it down the way {@link selectBranch} does would land back on the
   * branch the user is trying to leave.
   */
  async selectPendingBranch(parentKey) {
    const { activeId } = get()
    if (!activeId) return
    setLeaf(set, get(), activeId, parentKey)
    await window.vav.conversations.setLeaf(activeId, parentKey)
    get().focusComposer()
  },

  async fork(messageId) {
    const state = get()
    const { activeId } = state
    if (!activeId || state.turns[activeId]?.isRunning) return
    const leaf = await window.vav.agent.fork(activeId, messageId)
    if (leaf === null) return
    setLeaf(set, get(), activeId, leaf)
    get().focusComposer()
  },

  async continueInNewSession(messageId) {
    const { activeId } = get()
    if (!activeId) return
    const meta = await window.vav.conversations.continueInNewSession(activeId, messageId)
    if (!meta) return
    set((state) => ({ conversations: [meta, ...state.conversations] }))
    await get().selectConversation(meta.id)
    get().focusComposer()
  },

  async cancel(id) {
    await window.vav.agent.cancel(id)
  },

  async answerTool(toolCallId, answer) {
    const { activeId } = get()
    if (!activeId) return
    await window.vav.agent.answer(activeId, toolCallId, answer)
  },

  async updateSettings(patch) {
    const settings = await window.vav.settings.update(patch)
    set({ settings })
    if (patch.shell) useWorkspaceStore.getState().notifyShellChanged()
  },

  async refreshApiKeyHint() {
    const [hint, settings] = await Promise.all([
      window.vav.settings.apiKeyHint(),
      window.vav.settings.get()
    ])
    set({ apiKeyHint: hint, settings })
  },

  async resetSettings() {
    const settings = await window.vav.settings.reset()
    set({ settings, apiKeyHint: null })
  },

  openSettings(category) {
    // Settings own a window; the main window only asks for it to be raised.
    void window.vav.window.openSettings(category ?? 'api')
  },

  closeSettings() {
    void window.vav.window.closeSettings()
  },

  setShortcutsOpen(open) {
    set({ shortcutsOpen: open })
  },

  openSearch() {
    set((state) => ({ search: { ...state.search, open: true } }))
  },

  closeSearch() {
    set({ search: { open: false, query: '', matchIds: [], index: 0, tick: 0 } })
  },

  setSearchQuery(query) {
    const state = get()
    const trimmed = query.trim()
    // Search follows what is on screen; hidden branches are not results.
    const matchIds = trimmed
      ? visibleMessages(state, state.activeId)
          .filter((m) => m.content.toLowerCase().includes(trimmed.toLowerCase()))
          .map((m) => m.id)
      : []
    set((state) => ({
      search: { ...state.search, query, matchIds, index: 0, tick: state.search.tick + 1 }
    }))
  },

  stepSearch(direction) {
    set((state) => {
      const count = state.search.matchIds.length
      if (count === 0) return state
      const index = (state.search.index + direction + count) % count
      return { search: { ...state.search, index, tick: state.search.tick + 1 } }
    })
  },

  setErrorBanner(message) {
    set({ errorBanner: message })
  },

  showDialog(dialog) {
    set({ dialog })
  },

  closeDialog() {
    set({ dialog: null })
  },

  toggleSidebar() {
    set((state) => {
      const next = { ...currentLayout(state), sidebarVisible: !state.sidebarVisible }
      saveLayout(next)
      return next
    })
  },

  toggleToolsPanel() {
    set((state) => {
      const next = { ...currentLayout(state), toolsCollapsed: !state.toolsCollapsed }
      saveLayout(next)
      return next
    })
  },

  setPanelSegment(segment) {
    set((state) => {
      const next = { ...currentLayout(state), panelSegment: segment, toolsCollapsed: false }
      saveLayout(next)
      return next
    })
  },

  togglePanelSegment() {
    get().setPanelSegment(get().panelSegment === 'files' ? 'terminal' : 'files')
  },

  setPanelHeight(height) {
    const clamped = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.round(height)))
    set((state) => {
      const next = { ...currentLayout(state), panelHeight: clamped }
      saveLayout(next)
      return next
    })
  },

  focusComposer() {
    set((state) => ({ composerFocusTick: state.composerFocusTick + 1 }))
  },

  applyTurnEvent(event) {
    const id = event.conversationId
    const projection = getProjection(id)

    switch (event.type) {
      case 'start':
        projection.start()
        patchTurn(set, id, { isRunning: true, phase: 'thinking', toolCount: 0, awaitingToolCallId: null })
        break

      case 'user':
        set((state) => ({
          messages: { ...state.messages, [id]: upsert(state.messages[id], event.message) },
          activeLeaf: { ...state.activeLeaf, [id]: event.message.id }
        }))
        break

      case 'phase':
        projection.setPhase(event.phase)
        patchTurn(set, id, { phase: event.phase })
        break

      case 'delta':
        // The hot path: never touches React state.
        if (event.kind === 'text') projection.appendText(event.index, event.text)
        else projection.appendReasoning(event.index, event.text)
        break

      case 'tool':
        projection.upsertTool(event.index, event.block)
        patchTurn(set, id, {
          toolCount: countTools(get, id, event.block.id),
          awaitingToolCallId:
            event.block.status === 'pending' &&
            (event.block.tool === 'request' || event.block.tool === 'ask_user_question')
              ? event.block.id
              : get().turns[id]?.awaitingToolCallId === event.block.id
                ? null
                : (get().turns[id]?.awaitingToolCallId ?? null)
        })
        break

      case 'awaiting':
        projection.upsertTool(event.index, event.block)
        patchTurn(set, id, { awaitingToolCallId: event.toolCallId, phase: 'awaiting-user' })
        break

      case 'mirror':
        useWorkspaceStore.getState().mirrorAgentTranscript(id, event.text)
        break

      case 'fs-changed':
        useWorkspaceStore.getState().agentDidWriteFile(id, event.parentPath, event.filePath)
        break

      case 'end': {
        projection.end()
        patchTurn(set, id, IDLE_TURN)
        set((state) => {
          const conversations = state.conversations.map((c) =>
            c.id === id ? { ...c, tokensUsed: event.tokensUsed, updatedAt: Date.now() } : c
          )
          // A turn that produced nothing is not stored on disk either; adopting
          // it as the leaf would point the tree at a node main has never seen.
          if (event.message.blocks.length === 0) return { conversations }
          return {
            messages: { ...state.messages, [id]: upsert(state.messages[id], event.message) },
            activeLeaf: { ...state.activeLeaf, [id]: event.message.id },
            conversations
          }
        })
        // Reconcile titles and any auto-title the main process applied.
        void window.vav.conversations.list().then((conversations) => set({ conversations }))
        if (event.error) set({ errorBanner: event.error })
        break
      }
    }
  }
}))

/**
 * The thread on screen: root → active leaf, with other branches left out.
 *
 * Memoised on (nodes, leaf) because this is read from selectors — returning a
 * fresh array each time would re-render forever.
 */
export function visibleMessages(state: SessionState, conversationId: string): ChatMessage[] {
  const nodes = state.messages[conversationId]
  if (!nodes?.length) return NO_MESSAGES
  const leafId = state.activeLeaf[conversationId] ?? null
  if (pathCache && pathCache.nodes === nodes && pathCache.leafId === leafId) return pathCache.path
  const path = threadPath(nodes, leafId)
  pathCache = { nodes, leafId, path }
  return path
}

let pathCache: { nodes: ChatMessage[]; leafId: string | null; path: ChatMessage[] } | null = null

/** Stable identity for the empty case: a fresh [] would re-render forever. */
const NO_MESSAGES: ChatMessage[] = []

function setLeaf(
  set: (partial: Partial<SessionState>) => void,
  state: SessionState,
  conversationId: string,
  leafId: string | null
): void {
  set({ activeLeaf: { ...state.activeLeaf, [conversationId]: leafId } })
}

function upsert(nodes: ChatMessage[] | undefined, message: ChatMessage): ChatMessage[] {
  const existing = nodes ?? []
  const index = existing.findIndex((m) => m.id === message.id)
  if (index < 0) return [...existing, message]
  return existing.map((m) => (m.id === message.id ? message : m))
}

function currentLayout(state: LayoutPrefs): LayoutPrefs {
  return {
    sidebarVisible: state.sidebarVisible,
    toolsCollapsed: state.toolsCollapsed,
    panelSegment: state.panelSegment,
    panelHeight: state.panelHeight
  }
}

function patchTurn(
  set: (fn: (state: SessionState) => Partial<SessionState>) => void,
  id: string,
  patch: Partial<TurnRuntime>
): void {
  set((state) => ({
    turns: { ...state.turns, [id]: { ...(state.turns[id] ?? IDLE_TURN), ...patch } }
  }))
}

const seenTools = new Map<string, Set<string>>()

function countTools(get: () => SessionState, conversationId: string, toolId: string): number {
  let set = seenTools.get(conversationId)
  if (!set) {
    set = new Set()
    seenTools.set(conversationId, set)
  }
  if (!get().turns[conversationId]?.isRunning) set.clear()
  set.add(toolId)
  return set.size
}

/** Wires main-process turn events into the store. Called once at startup. */
export function installTurnEventBridge(): () => void {
  return window.vav.agent.onEvent((event) => useSessionStore.getState().applyTurnEvent(event))
}

/** Keeps every window's copy of the settings in step. Called once per window. */
export function installSettingsBridge(): () => void {
  return window.vav.onSettingsChanged((settings) => useSessionStore.setState({ settings }))
}

/**
 * Keeps every window's conversation list in step.
 *
 * The same conversation can be renamed, pinned or created from another window,
 * so no window may treat its own copy of the list as authoritative.
 */
export function installWindowBridge(): () => void {
  return window.vav.conversations.onChanged((conversations) => {
    useSessionStore.setState({ conversations })
  })
}
