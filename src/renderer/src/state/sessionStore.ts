import { create } from 'zustand'
import type {
  AboutInfo,
  AppLocale,
  AppSettings,
  ChatMessage,
  ConversationMeta,
  QuoteDraft,
  TokenSnapshot,
  TurnPhase
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { resolveLocale } from '@shared/i18n'
import { tt } from '../i18n/useT'
import { threadPath } from '@shared/thread'
import { getProjection, disposeProjection } from './StreamProjection'
import { AGENT_TAB_ID, useWorkspaceStore } from './workspaceStore'

export type SettingsCategory =
  | 'api'
  | 'workspace'
  | 'appearance'
  | 'notifications'
  | 'cli'
  | 'about'

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
  /** Shown when `onConfirm` is set; defaults to 取消. */
  cancelLabel?: string
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
  /** Segment to restore when expanding via chevron (main-chat.rpml §5). */
  lastActiveSegment: 'files' | 'terminal'
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
    lastActiveSegment: 'files',
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
  /** Resolved from settings.locale + OS; drives `useT()`. */
  resolvedLocale: AppLocale
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
  /** Pending quote strip above the composer (main-chat.rpml §引用). */
  quotes: Record<string, QuoteDraft | null>
  /** Message id briefly highlighted after quote-strip / bubble jump. */
  flashMessageId: string | null
  flashTick: number
  /** Per-conversation token samples for the context-window popover. */
  tokenHistories: Record<string, TokenSnapshot[]>
  cacheCreatedAt: Record<string, number | null>
  cacheExpiresAt: Record<string, number | null>

  search: SearchState
  errorBanner: string | null
  dialog: DialogState | null
  settingsCategory: SettingsCategory
  shortcutsOpen: boolean
  composerFocusTick: number
  /**
   * Bumped by ⌘⇧O / menu command so ToolsPanel can open the native workspace
   * menu without holding open/closed boolean state in the store.
   */
  workspaceMenuNonce: number

  /** A detached window passes the one conversation it exists to show. */
  bootstrap(pinnedConversationId?: string): Promise<void>
  selectConversation(id: string, options?: { additive?: boolean; range?: boolean }): Promise<void>
  loadMessages(id: string): Promise<void>
  createConversation(options?: {
    workingDirectory?: string | null
    model?: string
  }): Promise<void>
  /** New blank session reusing the active conversation's workdir + model. */
  createConversationInCurrentWorkspace(): Promise<void>
  duplicateConversation(id: string): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  beginRename(id: string | null): void
  requestDelete(ids: string[]): void
  /** ⌘1 = Workspace; ⌘2+ = bash tabs in creation order (Agent first). */
  focusToolsSlot(slot: number): void
  setModel(id: string, model: string): Promise<void>
  pickWorkingDirectory(id: string): Promise<void>
  setWorkingDirectory(id: string, path: string): Promise<void>
  /** Move a Temporary workspace into a real directory (name + copy). */
  locateWorkspace(id: string): Promise<void>
  setSidebarQuery(query: string): void
  setPinned(id: string, pinned: boolean): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  setApprovalMode(id: string, mode: import('@shared/types').ApprovalMode): Promise<void>
  openDetached(id: string): Promise<void>

  setDraft(id: string, text: string): void
  setAttachments(id: string, paths: string[]): void
  setQuote(id: string, quote: QuoteDraft | null): void
  clearQuote(id?: string): void
  /** Scroll transcript to a message and flash its background briefly. */
  scrollToMessage(messageId: string): void
  /** Reload token history / cache clocks from disk (popover open / 2s refresh). */
  refreshTokenUsage(id?: string): Promise<void>
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
  setToolsCollapsed(collapsed: boolean): void
  setPanelSegment(segment: 'files' | 'terminal'): void
  togglePanelSegment(): void
  setPanelHeight(height: number): void
  focusComposer(): void
  openWorkspaceSwitcher(): void

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
  resolvedLocale: resolveLocale(
    DEFAULT_SETTINGS.locale,
    typeof navigator !== 'undefined' ? navigator.language : 'en'
  ),
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
  quotes: {},
  flashMessageId: null,
  flashTick: 0,
  tokenHistories: {},
  cacheCreatedAt: {},
  cacheExpiresAt: {},

  search: { open: false, query: '', matchIds: [], index: 0, tick: 0 },
  errorBanner: null,
  dialog: null,
  settingsCategory: 'api',
  shortcutsOpen: false,
  composerFocusTick: 0,
  workspaceMenuNonce: 0,

  async bootstrap(pinnedConversationId) {
    const data = await window.vav.bootstrap()
    const activeId = pinnedConversationId ?? data.activeConversationId

    set({
      ready: true,
      settings: data.settings,
      resolvedLocale: data.resolvedLocale,
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
    const target = conversations.find((c) => c.id === id)
    // Archived sessions cannot be the active conversation (sidebar archive view).
    if (target?.archived) {
      set({ selectedIds: [id] })
      return
    }
    let nextSelection = [id]
    if (options?.additive) {
      nextSelection = selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id]
      if (nextSelection.length === 0) nextSelection = [id]
    } else if (options?.range && activeId) {
      const ids = conversations.filter((c) => !c.archived).map((c) => c.id)
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
    set((state) => {
      let messages = state.messages
      // The in-flight assistant message is owned by StreamProjection; showing
      // the disk partial beside it would duplicate every tool card.
      if (status.isRunning && status.messageId && messages[id]?.some((m) => m.id === status.messageId)) {
        messages = {
          ...messages,
          [id]: messages[id]!.filter((m) => m.id !== status.messageId)
        }
      }
      return {
        messages,
        turns: {
          ...state.turns,
          [id]: {
            isRunning: status.isRunning,
            phase: status.phase,
            toolCount: status.toolCount,
            awaitingToolCallId: status.awaitingToolCallId
          }
        }
      }
    })
    if (status.isRunning) {
      const projection = getProjection(id)
      // Events may have already primed this window while status was in flight;
      // only hydrate when we still have no live view.
      if (!projection.getSnapshot().active) {
        projection.hydrate(status.phase, status.blocks)
      }
    }
  },

  async loadMessages(id) {
    const conversation = await window.vav.conversations.get(id)
    if (!conversation) return
    const already = !!get().messages[id]
    set((state) => ({
      ...(already
        ? {}
        : {
            messages: { ...state.messages, [id]: conversation.messages },
            activeLeaf: { ...state.activeLeaf, [id]: conversation.activeLeafId }
          }),
      tokenHistories: {
        ...state.tokenHistories,
        [id]: conversation.tokenHistory ?? []
      },
      cacheCreatedAt: {
        ...state.cacheCreatedAt,
        [id]: conversation.cacheCreatedAt ?? null
      },
      cacheExpiresAt: {
        ...state.cacheExpiresAt,
        [id]: conversation.cacheExpiresAt ?? null
      }
    }))
  },

  async refreshTokenUsage(id) {
    const target = id ?? get().activeId
    if (!target) return
    const conversation = await window.vav.conversations.get(target)
    if (!conversation) return
    set((state) => ({
      tokenHistories: {
        ...state.tokenHistories,
        [target]: conversation.tokenHistory ?? []
      },
      cacheCreatedAt: {
        ...state.cacheCreatedAt,
        [target]: conversation.cacheCreatedAt ?? null
      },
      cacheExpiresAt: {
        ...state.cacheExpiresAt,
        [target]: conversation.cacheExpiresAt ?? null
      },
      conversations: state.conversations.map((c) =>
        c.id === target ? { ...c, tokensUsed: conversation.tokensUsed } : c
      )
    }))
  },

  async createConversation(options) {
    const meta = await window.vav.conversations.create(options)
    // Main publishes the full list on create; `onChanged` may already have
    // applied it by the time we get here. Prepending unconditionally would
    // put the same id in the sidebar twice (⌘N made that obvious).
    set((state) => ({
      conversations: state.conversations.some((c) => c.id === meta.id)
        ? state.conversations
        : [meta, ...state.conversations],
      messages: { ...state.messages, [meta.id]: [] },
      activeLeaf: { ...state.activeLeaf, [meta.id]: null }
    }))
    await get().selectConversation(meta.id)
    get().focusComposer()
  },

  async createConversationInCurrentWorkspace() {
    const { activeId, conversations } = get()
    const current = conversations.find((c) => c.id === activeId)
    await get().createConversation({
      workingDirectory: current?.workingDirectory ?? null,
      model: current?.model
    })
  },

  async duplicateConversation(id) {
    const meta = await window.vav.conversations.duplicate(id)
    if (!meta) {
      get().showDialog({
        title: tt('error.duplicateFailed'),
        body: tt('dialog.duplicateFailedBody'),
        confirmLabel: tt('common.ok')
      })
      return
    }
    set((state) => ({
      conversations: state.conversations.some((c) => c.id === meta.id)
        ? state.conversations
        : [meta, ...state.conversations]
    }))
    // Drop any stale cache so selectConversation reloads the deep-copied tree.
    set((state) => {
      const messages = { ...state.messages }
      const activeLeaf = { ...state.activeLeaf }
      delete messages[meta.id]
      delete activeLeaf[meta.id]
      return { messages, activeLeaf }
    })
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
    void (async () => {
      const { conversations } = get()
      const targets = ids.filter((id) => conversations.some((c) => c.id === id))
      if (targets.length === 0) return

      // Guard first: the product always keeps at least one conversation.
      if (targets.length >= conversations.length) {
        get().showDialog({
          title: tt('dialog.keepOneSessionTitle'),
          body: tt('error.keepOneSession'),
          confirmLabel: tt('common.ok')
        })
        return
      }

      // Need message counts for every target; empty chats skip the confirm.
      await Promise.all(targets.map((id) => get().loadMessages(id)))
      const empty = targets.filter((id) => (get().messages[id]?.length ?? 0) === 0)
      const nonempty = targets.filter((id) => (get().messages[id]?.length ?? 0) > 0)

      const applyRemove = async (toRemove: string[]): Promise<void> => {
        if (toRemove.length === 0) return
        const { removed, conversations: next } = await window.vav.conversations.remove(toRemove)
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

      // Empty sessions (no messages) delete silently — nothing worth warning about.
      if (empty.length) await applyRemove(empty)
      if (nonempty.length === 0) return

      const single = nonempty.length === 1
      const title = single
        ? tt('dialog.deleteSession')
        : tt('dialog.deleteSessions', { count: nonempty.length })
      const name = conversations.find((c) => c.id === nonempty[0])?.title ?? ''
      const body = single
        ? tt('dialog.deleteConfirmSingle', { name })
        : tt('dialog.deleteConfirmMultiple', { count: nonempty.length })

      get().showDialog({
        title,
        body,
        confirmLabel: tt('common.delete'),
        destructive: true,
        onConfirm: () => void applyRemove(nonempty)
      })
    })()
  },

  focusToolsSlot(slot) {
    if (slot < 1 || slot > 9) return
    if (slot === 1) {
      get().setPanelSegment('files')
      return
    }
    const tabs = useWorkspaceStore.getState().workspaces[get().activeId]?.tabs ?? []
    const tab = tabs[slot - 2]
    if (!tab) return
    useWorkspaceStore.getState().selectTab(get().activeId, tab.id)
    get().setPanelSegment('terminal')
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

  async setWorkingDirectory(id, path) {
    const conversations = await window.vav.conversations.setWorkingDirectory(id, path)
    set({ conversations })
    await useWorkspaceStore.getState().setWorkingDirectory(id, path)
  },

  async locateWorkspace(id) {
    const conversation = get().conversations.find((c) => c.id === id)
    const destination = await window.vav.settings.pickDirectory()
    if (!destination) return
    const defaultName = (conversation?.title || 'workspace')
      .replace(/[\\/]/g, '-')
      .slice(0, 64)
    const name = window.prompt(tt('dialog.locateWorkspaceName'), defaultName)
    if (name == null) return
    const result = await window.vav.conversations.locateWorkspace(id, destination, name.trim())
    if (!result.ok) {
      get().showDialog({
        title: tt('error.locateFailed'),
        body: result.error,
        confirmLabel: tt('common.ok')
      })
      return
    }
    set({ conversations: result.conversations })
    const next =
      result.conversations.find((c) => c.id === id)?.workingDirectory ?? null
    await useWorkspaceStore.getState().setWorkingDirectory(id, next)
  },

  setSidebarQuery(query) {
    set({ sidebarQuery: query })
  },

  async setPinned(id, pinned) {
    const conversations = await window.vav.conversations.setPinned(id, pinned)
    set({ conversations })
  },

  async setArchived(id, archived) {
    const conversations = await window.vav.conversations.setArchived(id, archived)
    const { activeId } = get()
    const stillActive = conversations.some((c) => c.id === activeId && !c.archived)
    if (archived && !stillActive) {
      const next = conversations.find((c) => !c.archived)
      if (next) {
        set({ conversations })
        await get().selectConversation(next.id)
        return
      }
    }
    set({ conversations })
  },

  async setApprovalMode(id, mode) {
    const conversations = await window.vav.conversations.setApprovalMode(id, mode)
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

  setQuote(id, quote) {
    set((state) => ({ quotes: { ...state.quotes, [id]: quote } }))
  },

  clearQuote(id) {
    const target = id ?? get().activeId
    if (!target) return
    set((state) => ({ quotes: { ...state.quotes, [target]: null } }))
  },

  scrollToMessage(messageId) {
    set((state) => ({
      flashMessageId: messageId,
      flashTick: state.flashTick + 1
    }))
  },

  async send(text, attachments) {
    const { activeId, settings, turns, quotes } = get()
    if (!activeId) return
    if (turns[activeId]?.isRunning) return
    if (!text.trim() && attachments.length === 0) return

    if (!settings.apiKeyPresent) {
      get().showDialog({
        title: tt('common.hint'),
        body: tt('dialog.configureApiKeyBody'),
        confirmLabel: tt('error.openSettings'),
        onConfirm: () => get().openSettings('api')
      })
      return
    }

    const quote = quotes[activeId] ?? null

    // No optimistic echo: the stored message comes back as a `user` turn event
    // a moment later, already carrying the id and parent the tree needs.
    set((state) => ({
      drafts: { ...state.drafts, [activeId]: '' },
      attachments: { ...state.attachments, [activeId]: [] },
      quotes: { ...state.quotes, [activeId]: null },
      errorBanner: null
    }))

    await window.vav.agent.send(activeId, text, attachments, quote)
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
    set((state) => ({
      conversations: state.conversations.some((c) => c.id === meta.id)
        ? state.conversations
        : [meta, ...state.conversations]
    }))
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
    set({
      settings,
      resolvedLocale: resolveLocale(settings.locale, navigator.language)
    })
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
    set({
      settings,
      apiKeyHint: null,
      resolvedLocale: resolveLocale(settings.locale, navigator.language)
    })
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
    // System sheet / message box — not an in-window Modal (macOS native).
    void (async () => {
      if (dialog.onConfirm) {
        const ok = await window.vav.dialog.confirm({
          title: dialog.title,
          message: dialog.body,
          confirmLabel: dialog.confirmLabel,
          cancelLabel: dialog.cancelLabel,
          destructive: dialog.destructive
        })
        if (ok) dialog.onConfirm()
        return
      }
      await window.vav.dialog.alert({
        title: dialog.title,
        message: dialog.body,
        confirmLabel: dialog.confirmLabel
      })
    })()
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
      if (!state.toolsCollapsed) {
        const next = {
          ...currentLayout(state),
          toolsCollapsed: true,
          lastActiveSegment: state.panelSegment
        }
        saveLayout(next)
        return next
      }

      let segment = state.lastActiveSegment ?? state.panelSegment
      const tabs = useWorkspaceStore.getState().workspaces[state.activeId]?.tabs ?? []
      if (segment === 'terminal' && tabs.length === 0) segment = 'files'
      const next = {
        ...currentLayout(state),
        toolsCollapsed: false,
        panelSegment: segment,
        lastActiveSegment: segment
      }
      saveLayout(next)
      return next
    })
  },

  setToolsCollapsed(collapsed) {
    set((state) => {
      const next = collapsed
        ? {
            ...currentLayout(state),
            toolsCollapsed: true,
            lastActiveSegment: state.panelSegment
          }
        : { ...currentLayout(state), toolsCollapsed: false }
      saveLayout(next)
      return next
    })
  },

  setPanelSegment(segment) {
    set((state) => {
      const next = {
        ...currentLayout(state),
        panelSegment: segment,
        lastActiveSegment: segment,
        toolsCollapsed: false
      }
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

  openWorkspaceSwitcher() {
    set((state) => ({ workspaceMenuNonce: state.workspaceMenuNonce + 1 }))
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
        projection.ensureLive(event.phase)
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

      case 'mirror': {
        const workspace = useWorkspaceStore.getState()
        const hadAgent = !!workspace.workspaces[id]?.tabs.some((tab) => tab.isAgent)
        workspace.mirrorAgentTranscript(id, event.text)
        // First terminal output for this conversation: reveal the Agent tab so
        // a long command is not invisible behind a collapsed Files pane.
        if (!hadAgent) {
          workspace.selectTab(id, AGENT_TAB_ID)
          get().setPanelSegment('terminal')
        }
        break
      }

      case 'fs-changed':
        useWorkspaceStore.getState().agentDidWriteFile(id, event.parentPath, event.filePath)
        break

      case 'usage':
        set((state) => ({
          tokenHistories: { ...state.tokenHistories, [id]: event.history },
          cacheCreatedAt: { ...state.cacheCreatedAt, [id]: event.cacheCreatedAt },
          cacheExpiresAt: { ...state.cacheExpiresAt, [id]: event.cacheExpiresAt },
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, tokensUsed: event.tokensUsed, updatedAt: Date.now() } : c
          )
        }))
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
    lastActiveSegment: state.lastActiveSegment ?? state.panelSegment,
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
  return window.vav.onSettingsChanged((settings) =>
    useSessionStore.setState({
      settings,
      resolvedLocale: resolveLocale(settings.locale, navigator.language)
    })
  )
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
