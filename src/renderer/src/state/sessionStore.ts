import { create } from 'zustand'
import type {
  AboutInfo,
  AppLocale,
  AppSettings,
  ChatMessage,
  ConversationMeta,
  PreviewRef,
  QuoteDraft,
  TokenSnapshot,
  TurnPhase
} from '@shared/types'
import { DEFAULT_CLI_AGENTS, DEFAULT_SETTINGS } from '@shared/types'
import type { WorkspaceHostInfo } from '@shared/workspaceHost'
import type { RemoteControlStatus } from '@shared/remoteControl'
import {
  agentModelHostKey,
  defaultModelForChatHost,
  resolveModelForChatHost,
  modelsForChatHost,
  filterEnabledModels
} from '@shared/agentModels'
import { vendorIdFromEndpoint } from '@shared/llmVendors'
import type { ModelOption } from '@shared/types'

export type AgentModelCatalogEntry = {
  host: string
  models: ModelOption[]
  source: 'live' | 'static' | 'fallback'
  error?: string
  endpoint?: string
}

/** Mid-turn context-window overlay — must not remap `conversations`. */
export type LiveUsage = {
  tokensUsed: number
  tokenLimit?: number
}
import type { ChangeSet, UpdateState } from '@shared/changeSet'
import type { GitChangeEntry } from '@shared/git'
import type { GithubActionRun, GithubPullListItem, GithubRelease, GithubSite } from '@shared/github'
import type { CloudflareStatus } from '@shared/cloudflare'
import type { SupabaseStatus } from '@shared/supabase'

/** Contents of the session-right preview drawer. */
export type SessionPreview =
  | { kind: 'file' }
  | { kind: 'git'; cwd: string; entry: GitChangeEntry }
  | { kind: 'github'; cwd: string; pull: GithubPullListItem }
  | { kind: 'github-action'; cwd: string; run: GithubActionRun }
  | { kind: 'github-site'; cwd: string; site: GithubSite }
  | { kind: 'github-release'; cwd: string; release: GithubRelease }
  | { kind: 'cloudflare'; cwd: string; status: CloudflareStatus; deploymentId: string | null }
  | { kind: 'supabase'; cwd: string; status: SupabaseStatus; functionSlug: string | null }
import { resolveLocale } from '@shared/i18n'
import {
  imageInputLimits,
  mergeImageAttachments,
  type ImageAttachPlan
} from '@shared/agentImageInput'
import { tt } from '../i18n/useT'
import { isTemporaryWorkspace } from '../lib/format'
import { isCompanionSessionShell } from '../lib/windowKind'
import { compactionForLeaf, upsertCompaction } from '@shared/compaction'
import { subtreeIds, threadPath } from '@shared/thread'
import { getProjection, disposeProjection } from './StreamProjection'
import { AGENT_TAB_ID, useWorkspaceStore } from './workspaceStore'
import { isSwarmSurfaceActive } from '../lib/workdirSwitch'
import {
  collectSwarmLeaves,
  insertSwarmLeaf,
  rememberSwarmLayout,
  restoreSwarmLeaf,
  removeSwarmLeaf,
  swarmLeaf,
  swarmRootId
} from '@shared/swarmLayout'
import { patchAcpConfigOption, patchAcpSessionMode } from '@shared/acpSession'
import type { TerminalLayoutNode, TerminalSplitAxis } from '@shared/types'

function swarmBlocksWorkdirSwitch(id: string | null | undefined, swarmEnabled: boolean): boolean {
  if (!id) return false
  return isSwarmSurfaceActive(
    swarmEnabled,
    !!useWorkspaceStore.getState().workspaces[id]?.cliMode
  )
}

function notifyImageAttachPlan(
  showToast: (toast: ToastState | null) => void,
  plan: ImageAttachPlan
): void {
  if (
    plan.rejectedUnsupported === 0 &&
    plan.droppedForLimit === 0 &&
    plan.rejectedOversize === 0 &&
    plan.rejectedType === 0
  ) {
    return
  }
  if (plan.rejectedOversize > 0) {
    const mb = Math.max(1, Math.round(plan.maxBytes / (1024 * 1024)))
    showToast({ kind: 'info', title: tt('composer.imageTooLarge', { mb }) })
    return
  }
  if (plan.droppedForLimit > 0) {
    showToast({ kind: 'info', title: tt('composer.imagesTooMany', { max: plan.maxCount }) })
    return
  }
  showToast({ kind: 'info', title: tt('composer.imageTypeUnsupported') })
}

function omitLiveUsage(
  liveUsage: Record<string, LiveUsage>,
  id: string
): Record<string, LiveUsage> {
  if (!(id in liveUsage)) return liveUsage
  const { [id]: _removed, ...rest } = liveUsage
  return rest
}

function trimAttachmentsForHost(
  id: string,
  host: ConversationMeta['cliHost'],
  get: () => SessionState,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void
): void {
  const existing = get().attachments[id] ?? []
  if (existing.length === 0) return
  const plan = mergeImageAttachments({
    existing: [],
    incoming: existing,
    capability: imageInputLimits(host)
  })
  if (plan.paths.length === existing.length && plan.paths.every((p, i) => p === existing[i])) {
    return
  }
  set((state) => ({ attachments: { ...state.attachments, [id]: plan.paths } }))
  notifyImageAttachPlan(get().showToast, plan)
}

const IDLE_UPDATE: UpdateState = {
  phase: 'idle',
  currentVersion: '',
  latestVersion: null,
  releaseUrl: null,
  downloadUrl: null,
  progress: 0,
  bytesPerSecond: null,
  message: null
}

/**
 * Merge a listMeta broadcast into the local sidebar without reordering on
 * view-only / metadata-only updates. Recency sort applies only when some
 * conversation's `updatedAt` (or pin/archive membership) actually changed.
 *
 * Selecting a session or focusing a file must not reshuffle the list —
 * only real conversation activity (messages) bumps `updatedAt` on main.
 */
function mergeConversationList(
  prev: ConversationMeta[],
  next: ConversationMeta[]
): ConversationMeta[] {
  const prevIndex = new Map(prev.map((c, i) => [c.id, i]))
  const prevById = new Map(prev.map((c) => [c.id, c]))
  const nextById = new Map(next.map((c) => [c.id, c]))

  let orderRelevantChange = false
  for (const n of next) {
    const p = prevById.get(n.id)
    if (!p) {
      orderRelevantChange = true
      break
    }
    if (
      p.updatedAt !== n.updatedAt ||
      p.pinned !== n.pinned ||
      p.pinTime !== n.pinTime ||
      p.archived !== n.archived ||
      p.archivedAt !== n.archivedAt
    ) {
      orderRelevantChange = true
      break
    }
  }
  if (!orderRelevantChange) {
    for (const p of prev) {
      if (!p.fileId && !nextById.has(p.id)) {
        orderRelevantChange = true
        break
      }
    }
  }

  if (!orderRelevantChange) {
    // Keep previous order; patch fields from next; keep hydrated file sessions.
    const result: ConversationMeta[] = []
    const seen = new Set<string>()
    for (const p of prev) {
      const n = nextById.get(p.id)
      if (n) {
        result.push(n)
        seen.add(n.id)
      } else if (p.fileId) {
        result.push(p)
        seen.add(p.id)
      }
    }
    for (const n of next) {
      if (!seen.has(n.id)) result.push(n)
    }
    return result
  }

  const fileSessions = prev.filter((c) => !!c.fileId && !nextById.has(c.id))
  const sorted = [...next].sort((a, b) => {
    const d = b.updatedAt - a.updatedAt
    if (d !== 0) return d
    return (prevIndex.get(a.id) ?? 1e9) - (prevIndex.get(b.id) ?? 1e9)
  })
  return [...sorted, ...fileSessions]
}

async function persistSwarmLayout(
  set: (partial: { conversations: ConversationMeta[] }) => void,
  getConversations: () => ConversationMeta[],
  rootId: string,
  layout: TerminalLayoutNode | null,
  full?: TerminalLayoutNode | null
): Promise<void> {
  const list = await window.vav.conversations.setSwarmLayout(rootId, layout, full)
  set({ conversations: mergeConversationList(getConversations(), list) })
}

export interface ToastState {
  kind: 'info' | 'success' | 'error'
  title: string
  description?: string
}

export type SettingsCategory =
  | 'api'
  | 'analysis'
  | 'accounts'
  | 'workspace'
  | 'appearance'
  | 'notifications'
  | 'connect'
  | 'cli'
  | 'agents'
  | 'file-associations'
  | 'keybindings'
  | 'about'

export interface TurnRuntime {
  isRunning: boolean
  phase: TurnPhase
  toolCount: number
  awaitingToolCallId: string | null
  /** Frozen at turn start — composer model picks must not rewrite Outputting. */
  startedModel?: string
  startedCliHost?: string | null
  startedAccountId?: string | null
}

const IDLE_TURN: TurnRuntime = {
  isRunning: false,
  phase: 'idle',
  toolCount: 0,
  awaitingToolCallId: null,
  startedModel: undefined,
  startedCliHost: undefined,
  startedAccountId: undefined
}

/**
 * In-memory pending send while a turn is streaming (main-chat-streaming.rpml §5).
 * Not persisted; cleared when the conversation is removed.
 */
export interface QueuedMessage {
  id: string
  text: string
  attachments: string[]
  previewRefs: PreviewRef[]
  commentCards: { ref: PreviewRef; comment: string }[]
  quote: QuoteDraft | null
  contextFile: string | null
  createdAt: number
}

/** Max pending items per conversation (spec §2.10). */
export const MESSAGE_QUEUE_MAX = 20

/**
 * Conversations currently inside {@link SessionState.sendQueuedNow} (manual
 * interrupt path). Suppresses auto-drain on the interim `end` from cancel so
 * we do not pop the *next* queue item while "send now" is still running.
 */
const queueSendInFlight = new Set<string>()

/** Fire agent.send for a dequeued payload (caller already removed it from the queue). */
async function dispatchQueuedPayload(
  conversationId: string,
  item: QueuedMessage,
  selectIfNeeded: () => Promise<void>
): Promise<void> {
  const cardRefs = item.commentCards.map((c) => {
    const note = c.comment.trim()
    return note ? { ...c.ref, comment: note } : { ...c.ref }
  })
  const byId = new Map<string, PreviewRef>()
  for (const ref of item.previewRefs) byId.set(ref.id, ref)
  for (const ref of cardRefs) byId.set(ref.id, ref)
  const allRefs = [...byId.values()]

  await selectIfNeeded()
  await window.vav.agent.send(
    conversationId,
    item.text,
    item.attachments,
    item.quote,
    allRefs.length ? allRefs : null,
    item.contextFile
  )
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

/** Window chrome only — not tied to a conversation. */
interface GlobalLayoutPrefs {
  sidebarVisible: boolean
}

/**
 * Tools tray layout is per conversation: collapsed/open, Files vs Terminal,
 * height. New sessions start collapsed with no shell (terminal-panel.rpml).
 */
export interface SessionToolsLayout {
  toolsCollapsed: boolean
  panelSegment: 'files' | 'terminal'
  /** Segment to restore when expanding via chevron (main-chat.rpml §5). */
  lastActiveSegment: 'files' | 'terminal'
  panelHeight: number
}

export const PANEL_MIN_HEIGHT = 160
/**
 * Safety rail for persisted heights. Interactive drag / double-click max is
 * `PANEL_SNAP_RATIO` of the session column (see ToolsPanel).
 */
export const PANEL_MAX_HEIGHT = 2400
/** Double-click the tray resizer to jump here; again to restore. */
export const PANEL_SNAP_RATIO = 0.7
const GLOBAL_LAYOUT_KEY = 'vav.layout'
const SESSION_TOOLS_KEY = 'vav.session-tools-layout'

export const DEFAULT_SESSION_TOOLS: SessionToolsLayout = {
  toolsCollapsed: true,
  panelSegment: 'files',
  lastActiveSegment: 'files',
  panelHeight: 240
}

/**
 * Companion session windows must not share tools-tray layout with the main
 * window via localStorage (same conversationId would collapse both). Use
 * sessionStorage in detached views — per BrowserWindow, dies with the window.
 */
function isDetachedSessionWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'session'
  } catch {
    return false
  }
}

function toolsLayoutStorage(): Storage {
  try {
    return isDetachedSessionWindow() ? sessionStorage : localStorage
  } catch {
    return localStorage
  }
}

function loadGlobalLayout(): GlobalLayoutPrefs {
  const fallback: GlobalLayoutPrefs = { sidebarVisible: true }
  try {
    const raw = localStorage.getItem(GLOBAL_LAYOUT_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<GlobalLayoutPrefs>
    return { sidebarVisible: parsed.sidebarVisible ?? true }
  } catch {
    return fallback
  }
}

function saveGlobalLayout(prefs: GlobalLayoutPrefs): void {
  try {
    localStorage.setItem(GLOBAL_LAYOUT_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode or a full quota: layout simply falls back to defaults.
  }
}

function loadSessionToolsMap(): Record<string, SessionToolsLayout> {
  try {
    const raw = toolsLayoutStorage().getItem(SESSION_TOOLS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Partial<SessionToolsLayout>>
    const out: Record<string, SessionToolsLayout> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      out[id] = { ...DEFAULT_SESSION_TOOLS, ...value }
    }
    return out
  } catch {
    return {}
  }
}

function saveSessionToolsMap(map: Record<string, SessionToolsLayout>): void {
  try {
    toolsLayoutStorage().setItem(SESSION_TOOLS_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

function toolsFor(state: { toolsLayouts: Record<string, SessionToolsLayout> }, id: string): SessionToolsLayout {
  return state.toolsLayouts[id] ?? DEFAULT_SESSION_TOOLS
}

/** Patch active conversation's tools layout + mirror fields for selectors. */
function patchActiveTools(
  state: SessionState,
  patch: Partial<SessionToolsLayout>
): Partial<SessionState> {
  const id = state.activeId
  if (!id) return {}
  const next = { ...toolsFor(state, id), ...patch }
  const toolsLayouts = { ...state.toolsLayouts, [id]: next }
  saveSessionToolsMap(toolsLayouts)
  return {
    toolsLayouts,
    toolsCollapsed: next.toolsCollapsed,
    panelSegment: next.panelSegment,
    lastActiveSegment: next.lastActiveSegment,
    panelHeight: next.panelHeight
  }
}

/** Mirror a conversation's tools layout into the top-level active fields. */
function activeToolsFields(layout: SessionToolsLayout): Pick<
  SessionState,
  'toolsCollapsed' | 'panelSegment' | 'lastActiveSegment' | 'panelHeight'
> {
  return {
    toolsCollapsed: layout.toolsCollapsed,
    panelSegment: layout.panelSegment,
    lastActiveSegment: layout.lastActiveSegment,
    panelHeight: layout.panelHeight
  }
}

/** Sidebar list: main sessions, archive, or file-bound sessions. */
export type SidebarListMode = 'main' | 'archive' | 'fileSessions'

interface SessionState {
  sidebarVisible: boolean
  /**
   * Which list the sidebar is showing. Shared so Reveal / open-in-main can
   * jump to File sessions without local Sidebar state.
   */
  sidebarListMode: SidebarListMode
  /** Active conversation's tools tray (mirrored from toolsLayouts[activeId]). */
  toolsCollapsed: boolean
  panelSegment: 'files' | 'terminal'
  lastActiveSegment: 'files' | 'terminal'
  panelHeight: number
  /** Per-conversation tools tray state. */
  toolsLayouts: Record<string, SessionToolsLayout>

  ready: boolean
  home: string
  tmp: string
  about: AboutInfo | null
  hosts: WorkspaceHostInfo[]
  /** Phone-companion tunnel status; null until the first snapshot arrives. */
  remoteControlStatus: RemoteControlStatus | null

  settings: AppSettings
  /** Resolved from settings.locale + OS; drives `useT()`. */
  resolvedLocale: AppLocale
  /**
   * Live OS accent as `#rrggbb`. Used when `settings.colorTint === 'system'`
   * and for the Appearance swatch preview.
   */
  systemAccentColor: string
  apiKeyHint: string | null

  conversations: ConversationMeta[]
  activeId: string
  selectedIds: string[]
  /**
   * Conversation ids that currently have a companion window open.
   * Main shell uses this to park its live agent xterm (exclusive PTY view).
   */
  detachedConversationIds: string[]
  /** Tray-identical Running / Done per conversation — drives the window LED. */
  activityById: Record<string, 'running' | 'done'>
  sidebarQuery: string
  renamingId: string | null
  /** Set in a detached window, which follows exactly one conversation. */
  pinnedConversationId: string | null

  /**
   * Preloaded per-host model catalogues (from CLI probes / VAV presets).
   * Populated at bootstrap + background preload — picker reads this instantly.
   */
  agentModelCatalog: Record<string, AgentModelCatalogEntry>
  setAgentModelCatalog(catalog: Record<string, AgentModelCatalogEntry>): void
  refreshAgentModelCatalog(force?: boolean): Promise<void>

  /** Every node of each conversation's tree; the visible thread is derived. */
  messages: Record<string, ChatMessage[]>
  /**
   * True when `messages[id]` is a full transcript hydrated from main.
   *
   * Turn events (user/end) may seed `messages[id]` for a conversation the
   * renderer hasn't hydrated yet (e.g. background swarm). Until this is true,
   * `loadMessages` must not bail early on an existing (partial) message list.
   */
  messagesHydrated: Record<string, boolean>
  /** Which leaf each conversation currently follows. */
  activeLeaf: Record<string, string | null>
  /** Per-conversation leaf compactions (model history only; originals stay). */
  compactions: Record<string, import('@shared/types').LeafCompaction[]>
  turns: Record<string, TurnRuntime>
  /** Composer state is per conversation, like the rest of its ChatStore. */
  drafts: Record<string, string>
  attachments: Record<string, string[]>
  /** Pending quote strip above the composer (main-chat.rpml §引用). */
  quotes: Record<string, QuoteDraft | null>
  /** Preview selection chips pinned above the composer (file-preview edit). */
  previewRefs: Record<string, PreviewRef[]>
  /** Pick mode active (comment picker) — from file preview Tools header. */
  pickMode: Record<string, boolean>
  /** Comment cards from Pick mode — block ref + per-block comment text. */
  commentCards: Record<string, { ref: PreviewRef; comment: string }[]>
  /**
   * Messages queued while the agent is streaming (composer stays enabled).
   * Per conversation, in-memory only — never written to message history.
   */
  messageQueues: Record<string, QueuedMessage[]>
  /**
   * File Attachment Chip path (main-chat / file-preview / workspace-view).
   * When set, the composer shows the chip and the agent system prompt treats
   * this file as open context. Null = dismissed or none — preview/selection
   * may still show the file; only context attachment is cleared.
   */
  contextFiles: Record<string, string | null>
  /**
   * File-session path chip: until the user switches workdir, show "Enclosed dir"
   * instead of the parent folder path (like Temporary → "Workspace").
   * True = always show the real path for this conversation.
   */
  workdirPathRevealed: Record<string, boolean>
  /** Mark a file session as using the Enclosed dir chip (initial open). */
  markEnclosedDirChip(id: string): void
  /** After user picks/switches workdir, show the real path thereafter. */
  revealWorkdirPath(id: string): void
  /** Message id briefly highlighted after quote-strip / bubble jump. */
  flashMessageId: string | null
  flashTick: number
  /** Per-conversation token samples for the context-window popover. */
  tokenHistories: Record<string, TokenSnapshot[]>
  cacheCreatedAt: Record<string, number | null>
  cacheExpiresAt: Record<string, number | null>
  /**
   * Live tokens for the composer ring while a turn is in flight.
   * Written by `usage`; cleared on end / compact / host switch so
   * `conversations` is not remapped on every sample.
   */
  liveUsage: Record<string, LiveUsage>

  search: SearchState
  errorBanner: string | null
  errorBannerKind: 'quota' | 'session-stale' | 'auth' | 'network' | 'cancelled' | 'generic' | null
  errorBannerDetail: string | null
  dialog: DialogState | null
  toast: ToastState | null
  settingsCategory: SettingsCategory
  /** Settings → Providers: select this row when the window opens. */
  settingsFocusAgentId: string | null
  /** Settings → Accounts: select this profile when the page opens. */
  settingsFocusAccountId: string | null
  composerFocusTick: number
  /** Conversation whose composer should take the latest focusComposer tick. */
  composerFocusId: string | null
  /** Which comment card should take focus (set on pick). */
  commentFocusId: string | null
  /** Bumped on every pick so re-selecting the same block re-focuses the field. */
  commentFocusTick: number
  /**
   * Bumped by ⌘⇧O / menu command so ToolsPanel can open the native workspace
   * menu without holding open/closed boolean state in the store.
   */
  workspaceMenuNonce: number
  /**
   * Bumped by ⌘⇧M / menu command so the composer model picker can open the
   * native menu without holding open/closed boolean state in the store.
   */
  modelPickerMenuNonce: number
  modelPickerConversationId: string | null
  /**
   * Bumped by ⌘⇧P / menu command so the composer permission menu can open
   * without holding open/closed boolean state in the store.
   */
  approvalMenuNonce: number
  approvalConversationId: string | null

  /**
   * @deprecated Workspace group selection removed — sessions are selected directly.
   * Kept null; grouping/pin still use workdir paths in the sidebar.
   */
  activeGroupId: string | null
  /**
   * Right file-preview drawer on the session surface (was Workspace View only).
   * Open/closed is session UI state; path comes from workspace.selectedPath
   * when `sessionPreview.kind === 'file'`.
   */
  filePreviewOpen: boolean
  /**
   * What the session preview drawer is showing. Git / GitHub details use this
   * instead of the cramped tools-tray split when a preview host is mounted.
   * Changing this does not open the drawer — callers that mean “preview”
   * also call setFilePreviewOpen(true).
   */
  sessionPreview: SessionPreview
  /** True while WorkspaceView's preview column is mounted (main session). */
  filePreviewHost: boolean
  /** Workspace-level agent conversation ids keyed by workdir path. */
  workspaceAgentByPath: Record<string, string>
  /** File path → conversationId for standalone file preview windows. */
  previewAgentByPath: Record<string, string>

  /**
   * @deprecated Full-screen review is retired; kept null. Prefer inline cards.
   */
  changeReviewId: string | null
  changeSet: ChangeSet | null
  /** Cached ChangeSets for inline transcript cards. */
  changeSetsById: Record<string, ChangeSet>
  /** Pending review counts keyed by conversation (banner when not yet resolved). */
  pendingReviewByConversation: Record<string, { changeSetId: string; count: number }>
  updateState: UpdateState

  /** A detached window passes the one conversation it exists to show. */
  /**
   * @param pinnedConversationId force active conversation (detached session)
   * @param options.light skip selectConversation + updates — preview / session warm shells
   */
  bootstrap(pinnedConversationId?: string, options?: { light?: boolean }): Promise<void>
  /**
   * Fast path for warm session shells: seed meta + empty messages and paint
   * without awaiting disk hydrate / PTY list. Background bind follows.
   */
  claimDetachedSession(
    meta: ConversationMeta,
    options?: { empty?: boolean; collapseTools?: boolean }
  ): void
  /** Warm pool park — clear the pinned active conversation without full teardown. */
  releaseDetachedSession(): void
  selectConversation(
    id: string,
    options?: {
      additive?: boolean
      range?: boolean
      /**
       * Ordered id list for shift-range (e.g. File Sessions sidebar order).
       * Defaults to non-archived, non-file workspace conversations.
       */
      rangeIds?: string[]
      /**
       * Stay in Workspace View (History / New within workspace-view.rpml).
       * Default false: sidebar clicks leave workspace view.
       */
      stayInWorkspace?: boolean
    }
  ): Promise<void>
  /**
   * Open current workspace agent chat as a main-panel session
   * (duplicate if history exists, else mint empty).
   */
  openWorkspaceInMainPanel(workdir: string): Promise<void>
  /**
   * @deprecated No-op — workspace groups are not selectable.
   * Kept so call sites compile; clears any stale activeGroupId.
   */
  selectWorkspaceGroup(workdir: string | null): Promise<void>
  /** Right file preview drawer on the session surface. */
  setFilePreviewOpen(open: boolean): void
  toggleFilePreview(): void
  setSessionPreview(preview: SessionPreview): void
  setFilePreviewHost(mounted: boolean): void
  /** Ensure a durable agent conversation exists for this workspace path. */
  ensureWorkspaceAgent(workdir: string): Promise<string>
  loadMessages(id: string): Promise<void>
  createConversation(options?: {
    workingDirectory?: string | null
    model?: string
    swarmParentId?: string | null
    machineId?: string | null
    /**
     * Where the new session should appear.
     * Default: select in this window, except companion shells open a new window.
     */
    openIn?: 'here' | 'detached' | 'none'
  }): Promise<string | void>
  /** ⌘D / ⌘⇧D: mint a sibling agent session and split the Thread surface. */
  splitSwarmPane(axis?: TerminalSplitAxis): Promise<void>
  /** Hide a Swarm pane without deleting the agent session. */
  closeSwarmPane(conversationId: string): Promise<void>
  /** Focus a Swarm agent session, restoring its last layout slot when parked. */
  focusSwarmSession(conversationId: string): Promise<void>
  /** New blank session reusing the active conversation's workdir + model. */
  createConversationInCurrentWorkspace(): Promise<void>
  duplicateConversation(id: string): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  beginRename(id: string | null): void
  requestDelete(ids: string[]): void
  /** Confirm, then prune a message and its descendants from the active thread. */
  requestDeleteMessage(messageId: string): void
  deleteMessage(messageId: string): Promise<void>
  /** ⌘1 = Workspace; ⌘2+ = bash tabs in creation order (agent last). */
  focusToolsSlot(slot: number): void
  setModel(id: string, model: string): Promise<void>
  /** Cycle through enabled models for the current chat host. */
  stepModel(id: string, delta: number): Promise<void>
  /**
   * Switch built-in vav ↔ CLI agent host for a conversation.
   * File-preview sessions are omitted from listMeta — must merge like setModel.
   */
  setAgentBinaryName(id: string, agentBinaryName: string | null): Promise<void>
  /** Structured CLI host (claude/codex/…) for Transcript — null = built-in VAV. */
  setCliHost(id: string, host: string | null, accountId?: string | null): Promise<void>
  /**
   * Switch chat host from UI: leave Terminal mode, park/restore per-host
   * transcript (via setCliHost).
   */
  selectChatHost(id: string, host: string | null, vendorId?: string | null, accountId?: string | null): Promise<void>
  pickWorkingDirectory(id: string): Promise<void>
  useTempWorkingDirectory(id: string): Promise<void>
  setWorkingDirectory(id: string, path: string, machineId?: string | null): Promise<void>
  /** Browse a remote host's folders (native dialog cannot see that disk). */
  remoteFolderPick: { conversationId: string; machineId: string } | null
  openRemoteFolderPicker(conversationId: string, machineId: string): void
  closeRemoteFolderPicker(): void
  /** Move a Temporary workspace into a real directory (name + copy). */
  locateWorkspace(id: string): Promise<void>
  setSidebarQuery(query: string): void
  setPinned(id: string, pinned: boolean): Promise<void>
  /** Star / unstar a session for the sidebar Favorite filter. */
  setFavorite(id: string, favorite: boolean): Promise<void>
  /**
   * Pin a workspace to the sidebar's 置顶 section. Temporary Workspace shells
   * have no durable path, so they cannot be pinned.
   */
  setWorkspacePinned(workdir: string, pinned: boolean): Promise<void>
  setArchived(id: string, archived: boolean): Promise<void>
  setApprovalMode(id: string, mode: import('@shared/types').ApprovalMode): Promise<void>
  setThinkingLevel(id: string, level: import('@shared/types').ThinkingLevel): Promise<void>
  setFast(id: string, fast: boolean): Promise<void>
  setAcpMode(id: string, modeId: string): Promise<void>
  setAcpConfigOption(id: string, configId: string, value: string | boolean): Promise<void>
  /** Workspace preview focus — built-in VAV agent system / open-file context. */
  setFocusedFile(id: string, path: string | null): Promise<void>
  /**
   * Attach (or replace) the File Attachment Chip for a conversation.
   * Syncs focusedFilePath for the built-in agent. Does not paste into CLI TUIs.
   * Pass null to clear without touching tree selection / preview window.
   */
  attachContextFile(id: string, path: string | null): Promise<void>
  /** Dismiss the chip only — does not close the file preview or deselect. */
  dismissContextFile(id: string): Promise<void>
  openDetached(id: string): Promise<void>

  setDraft(id: string, text: string): void
  setAttachments(id: string, paths: string[]): void
  /** Merge incoming paths, applying the active host's image limits. */
  addAttachments(
    id: string,
    incoming: string[],
    opts?: { sizes?: Record<string, number> }
  ): void
  setQuote(id: string, quote: QuoteDraft | null): void
  clearQuote(id?: string): void
  setPreviewRefs(id: string, refs: PreviewRef[]): void
  clearPreviewRefs(id?: string): void
  setPickMode(id: string, on: boolean): void
  setCommentCards(id: string, cards: { ref: PreviewRef; comment: string }[]): void
  updateCommentCard(id: string, refId: string, comment: string): void
  removeCommentCard(id: string, refId: string): void
  clearCommentCards(id?: string): void
  /** Scroll transcript to a message and flash its background briefly. */
  scrollToMessage(messageId: string): void
  /** Reload token history / cache clocks from disk (popover open / 2s refresh). */
  refreshTokenUsage(id?: string): Promise<void>
  /**
   * Send on the given conversation (defaults to {@link activeId}).
   * File-preview / workspace must pass their session id when it may differ
   * from the global selection for a tick.
   * While streaming (and not awaiting user), enqueues instead of interrupting.
   */
  send(text: string, attachments: string[], conversationId?: string | null): Promise<void>
  /** Update text of a queued item (inline edit save). */
  updateQueuedMessage(conversationId: string, queueId: string, text: string): void
  /** Remove a queued item after confirm. */
  removeQueuedMessage(conversationId: string, queueId: string): void
  /**
   * Interrupt the active turn (if any) then send this queued message as a new
   * turn. Remaining queue items stay pending.
   */
  sendQueuedNow(conversationId: string, queueId: string): Promise<void>
  /**
   * FIFO: when idle, pop and send the head of the message queue.
   * Called after a turn ends so queued follow-ups run automatically.
   */
  drainMessageQueue(conversationId: string): Promise<void>
  cancel(id: string): Promise<void>
  answerTool(toolCallId: string, answer: string): Promise<boolean>
  regenerate(messageId: string): Promise<void>
  editUserMessage(messageId: string, text: string): Promise<void>
  selectBranch(messageId: string): Promise<void>
  selectPendingBranch(parentKey: string): Promise<void>
  fork(messageId: string): Promise<void>
  continueInNewSession(messageId: string): Promise<void>
  /**
   * Compact earlier context on the active leaf (manual). Originals remain
   * expandable in the transcript. Optional keepAfter keeps that message onward.
   */
  compactConversation(keepAfterMessageId?: string | null): Promise<boolean>
  /** Drop compaction for the active leaf path. */
  clearCompaction(): Promise<boolean>

  updateSettings(patch: Partial<AppSettings>): Promise<void>
  refreshApiKeyHint(): Promise<void>
  resetSettings(): Promise<void>
  openSettings(category?: SettingsCategory, agentId?: string): void
  closeSettings(): void

  openSearch(): void
  closeSearch(): void
  setSearchQuery(query: string): void
  stepSearch(direction: 1 | -1): void

  setErrorBanner(message: string | null): void
  showDialog(dialog: DialogState): void
  closeDialog(): void
  showToast(toast: ToastState | null): void

  /** Load a ChangeSet into the cache (inline review). Does not full-screen. */
  openChangeReview(changeSetId: string): Promise<void>
  /** Accept/reject helpers keyed by changeSetId (inline cards). */
  acceptChangeFilesFor(changeSetId: string, filePaths: string[]): Promise<void>
  rejectChangeFilesFor(changeSetId: string, filePaths: string[]): Promise<void>
  acceptAllChangesFor(changeSetId: string): Promise<void>
  rejectAllChangesFor(changeSetId: string): Promise<void>
  undoChangeFileFor(changeSetId: string, filePath: string): Promise<void>
  closeChangeReview(): void
  refreshChangeSet(): Promise<void>
  acceptChangeFiles(filePaths: string[]): Promise<void>
  rejectChangeFiles(filePaths: string[]): Promise<void>
  acceptAllChanges(): Promise<void>
  rejectAllChanges(): Promise<void>
  undoChangeFile(filePath: string): Promise<void>
  applyChangeEdit(filePath: string, content: string): Promise<void>

  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>

  toggleSidebar(): void
  setSidebarVisible(visible: boolean): void
  setSidebarListMode(mode: SidebarListMode): void
  toggleToolsPanel(): void
  setToolsCollapsed(collapsed: boolean): void
  setPanelSegment(segment: 'files' | 'terminal'): void
  /**
   * Switch Files/Terminal for the active session without expanding the tray
   * (preview-edit has no Files pane but should stay collapsed until needed).
   */
  setPanelSegmentQuiet(segment: 'files' | 'terminal'): void
  togglePanelSegment(): void
  setPanelHeight(height: number): void
  focusComposer(conversationId?: string): void
  /**
   * Ctrl+`: expand Tools → Terminal, ensure a plain bash exists, focus it.
   * Toggle-close when already focused on an open terminal tray.
   */
  focusBashTerminal(): void
  /** Open Tools → Terminal and run a command (agent install from Settings). */
  installAgentInToolsTray(payload: {
    command: string
    name?: string
    agentId?: string
    tabId?: string
    conversationId?: string
  }): Promise<void>
  focusCommentCard(refId: string): void
  setPreviewAgentForPath(path: string, conversationId: string): void
  openWorkspaceSwitcher(): void
  openModelPicker(): void
  openApprovalMenu(): void

  applyTurnEvent(event: import('@shared/types').TurnEvent): void
}

const globalLayout = loadGlobalLayout()
const sessionToolsLayouts = loadSessionToolsMap()

/** Cancels overlapping Workspace View enters (fast sidebar clicks / HMR remounts). */
let workspaceSelectGen = 0

export const useSessionStore = create<SessionState>((set, get) => ({
  sidebarVisible: globalLayout.sidebarVisible,
  sidebarListMode: 'main',
  toolsLayouts: sessionToolsLayouts,
  // Until a conversation is selected, show the default (collapsed) tray.
  ...activeToolsFields(DEFAULT_SESSION_TOOLS),
  ready: false,
  home: '',
  tmp: '',
  hosts: [],
  remoteControlStatus: null,
  remoteFolderPick: null,
  about: null,

  settings: DEFAULT_SETTINGS,
  resolvedLocale: resolveLocale(
    DEFAULT_SETTINGS.locale,
    typeof navigator !== 'undefined' ? navigator.language : 'en'
  ),
  systemAccentColor: '#007aff',
  apiKeyHint: null,

  conversations: [],
  activeId: '',
  selectedIds: [],
  /** Conversation ids with an open companion window (PTY exclusive there). */
  detachedConversationIds: [] as string[],
  activityById: {} as Record<string, 'running' | 'done'>,
  sidebarQuery: '',
  renamingId: null,
  pinnedConversationId: null,

  agentModelCatalog: {},
  setAgentModelCatalog(catalog) {
    set({ agentModelCatalog: catalog })
  },
  async refreshAgentModelCatalog(force = false) {
    try {
      if (force) {
        const catalog = await window.vav.agents.preloadModels(true)
        set({ agentModelCatalog: catalog })
        return
      }
      const catalog = await window.vav.agents.getModelCatalog()
      set({ agentModelCatalog: catalog })
      if (Object.keys(catalog).length === 0) {
        // Don't block the picker — incremental catalog events fill this in.
        void window.vav.agents.preloadModels(false).then((warmed) => {
          set({ agentModelCatalog: warmed })
        })
      }
    } catch (err) {
      console.warn('[agents] model catalog refresh failed', err)
    }
  },

  messages: {},
  messagesHydrated: {},
  activeLeaf: {},
  compactions: {},
  turns: {},
  drafts: {},
  attachments: {},
  quotes: {},
  previewRefs: {},
  pickMode: {},
  commentCards: {},
  messageQueues: {},
  contextFiles: {},
  workdirPathRevealed: {},
  flashMessageId: null,
  flashTick: 0,
  tokenHistories: {},
  cacheCreatedAt: {},
  cacheExpiresAt: {},
  liveUsage: {},

  search: { open: false, query: '', matchIds: [], index: 0, tick: 0 },
  errorBanner: null,
  errorBannerKind: null,
  errorBannerDetail: null,
  dialog: null,
  toast: null,
  settingsCategory: 'appearance',
  settingsFocusAgentId: null,
  settingsFocusAccountId: null,
  composerFocusTick: 0,
  composerFocusId: null,
  commentFocusId: null,
  commentFocusTick: 0,
  workspaceMenuNonce: 0,
  modelPickerMenuNonce: 0,
  modelPickerConversationId: null,
  approvalMenuNonce: 0,
  approvalConversationId: null,
  activeGroupId: null,
  filePreviewOpen: false,
  sessionPreview: { kind: 'file' },
  filePreviewHost: false,
  workspaceAgentByPath: loadWorkspaceAgents(),
  previewAgentByPath: loadPreviewAgents(),
  changeReviewId: null,
  changeSet: null,
  changeSetsById: {},
  pendingReviewByConversation: {},
  updateState: IDLE_UPDATE,

  async bootstrap(pinnedConversationId, options) {
    const light = options?.light === true
    const data = await window.vav.bootstrap()
    const activeId = pinnedConversationId ?? data.activeConversationId
    // File-preview / warm session shells skip update-state on the critical path.
    const updateState = light
      ? IDLE_UPDATE
      : await window.vav.updates.getState().catch(() => IDLE_UPDATE)

    // Legacy settings.json often had cliAgents: [] — never surface an empty catalogue.
    const settings = data.settings
    if (!Array.isArray(settings.removedCliAgentIds)) settings.removedCliAgentIds = []
    if (!Array.isArray(settings.cliAgents) || settings.cliAgents.length === 0) {
      const removed = new Set(settings.removedCliAgentIds)
      const seed = DEFAULT_CLI_AGENTS.filter((a) => !removed.has(a.id))
      settings.cliAgents = (seed.length > 0 ? seed : DEFAULT_CLI_AGENTS).map((a) => ({
        ...a,
        envVars: { ...a.envVars },
        defaultArgs: [...a.defaultArgs],
        binaryCandidates: a.binaryCandidates ? [...a.binaryCandidates] : undefined
      }))
      void window.vav.settings.update({ cliAgents: settings.cliAgents }).catch(() => undefined)
    }
    if (!settings.disabledAgentModels || typeof settings.disabledAgentModels !== 'object') {
      settings.disabledAgentModels = {}
    }
    if (!settings.defaultAgentModels || typeof settings.defaultAgentModels !== 'object') {
      settings.defaultAgentModels = {}
    }

    set({
      ready: true,
      settings,
      resolvedLocale: data.resolvedLocale,
      systemAccentColor: data.systemAccentColor || '#007aff',
      apiKeyHint: data.apiKeyHint,
      conversations: data.conversations,
      messagesHydrated: {},
      // Warm idle shell: no active conversation until sessionNavigate claims one.
      // Cold companion pins id here; SessionWindow.claimDetachedSession hydrates.
      activeId: light && !pinnedConversationId ? '' : activeId,
      selectedIds: light && !pinnedConversationId ? [] : activeId ? [activeId] : [],
      pinnedConversationId: pinnedConversationId ?? null,
      home: data.home,
      tmp: data.tmp,
      hosts: data.hosts,
      about: data.about,
      updateState: {
        ...updateState,
        currentVersion: updateState.currentVersion || data.about.version
      }
    })
    // Pull preloaded catalogues (main warms them shortly after launch).
    void get().refreshAgentModelCatalog(false)
    // Full bootstrap (main shell): await select.
    // Light companions: SessionWindow owns claim + non-blocking hydrate.
    if (activeId && !light) {
      await get().selectConversation(activeId)
    }
  },

  claimDetachedSession(meta, options) {
    // Only skip disk hydrate when main explicitly says the thread is empty
    // (⌘⇧↵). Otherwise leave messages unset so loadMessages does a full get —
    // seeding `[]` would make loadMessages think the id is already cached.
    const knownEmpty = options?.empty === true
    const prevMessages = get().messages[meta.id]
    const baseTools = toolsFor(get(), meta.id)
    const nextTools = options?.collapseTools
      ? { ...baseTools, toolsCollapsed: true }
      : baseTools
    set((state) => {
      const toolsLayouts = options?.collapseTools
        ? { ...state.toolsLayouts, [meta.id]: nextTools }
        : state.toolsLayouts
      if (options?.collapseTools) saveSessionToolsMap(toolsLayouts)
      const messages = { ...state.messages }
      if (knownEmpty) {
        messages[meta.id] = prevMessages ?? []
      }
      return {
        ready: true,
        conversations: state.conversations.some((c) => c.id === meta.id)
          ? state.conversations.map((c) => (c.id === meta.id ? { ...c, ...meta } : c))
          : [meta, ...state.conversations],
        messages,
        activeLeaf: {
          ...state.activeLeaf,
          [meta.id]: state.activeLeaf[meta.id] ?? null
        },
        activeId: meta.id,
        selectedIds: [meta.id],
        pinnedConversationId: meta.id,
        toolsLayouts,
        ...activeToolsFields(nextTools)
      }
    })
    // Background only — must not gate composer focus.
    void useWorkspaceStore.getState().bindConversation(meta.id, meta.workingDirectory ?? null)
    if (!knownEmpty) void get().loadMessages(meta.id)
    void window.vav.agent
      .status(meta.id)
      .then((status) => {
        if (get().activeId !== meta.id) return
        set((state) => ({
          turns: {
            ...state.turns,
            [meta.id]: {
              isRunning: status.isRunning,
              phase: status.phase,
              toolCount: status.toolCount,
              awaitingToolCallId: status.awaitingToolCallId
            }
          }
        }))
      })
      .catch(() => undefined)
  },

  releaseDetachedSession() {
    const id = get().pinnedConversationId || get().activeId
    set({
      activeId: '',
      selectedIds: [],
      pinnedConversationId: null
    })
    if (id) useWorkspaceStore.getState().forgetLocalWorkspace(id)
  },

  async selectWorkspaceGroup(_workdir) {
    // Workspace groups are no longer selectable — only pin / collapse / aggregate.
    workspaceSelectGen += 1
    set({ activeGroupId: null })
  },

  setFilePreviewOpen(open) {
    set({ filePreviewOpen: open })
  },

  toggleFilePreview() {
    set((state) => ({ filePreviewOpen: !state.filePreviewOpen }))
  },

  setSessionPreview(preview) {
    set({ sessionPreview: preview })
  },

  setFilePreviewHost(mounted) {
    set({ filePreviewHost: mounted })
  },

  async ensureWorkspaceAgent(workdir) {
    if (!workdir || workdir.startsWith('__')) {
      throw new Error('cannot ensure agent for empty workspace shell')
    }
    const existing = get().workspaceAgentByPath[workdir]
    if (existing && get().conversations.some((c) => c.id === existing)) return existing

    // Prefer an existing conversation already rooted here (reuse quietly).
    // Never adopt a file-bound session as the workspace agent.
    const rooted = get().conversations.find(
      (c) => !c.archived && !c.fileId && c.workingDirectory === workdir
    )
    if (rooted) {
      const map = { ...get().workspaceAgentByPath, [workdir]: rooted.id }
      set({ workspaceAgentByPath: map })
      saveWorkspaceAgents(map)
      return rooted.id
    }

    await get().createConversation({ workingDirectory: workdir, openIn: 'here' })
    const id = get().activeId
    if (!id) throw new Error('failed to create workspace agent')
    const map = { ...get().workspaceAgentByPath, [workdir]: id }
    set({ workspaceAgentByPath: map })
    saveWorkspaceAgents(map)
    return id
  },

  async selectConversation(id, options) {
    const { selectedIds, activeId, conversations } = get()
    let target = conversations.find((c) => c.id === id)
    // File-preview sessions are hidden from listMeta — hydrate on demand.
    if (!target) {
      const full = await window.vav.conversations.get(id)
      if (!full) return
      const {
        messages,
        tokenHistory,
        cacheCreatedAt,
        cacheExpiresAt,
        activeLeafId,
        compactions,
        ...meta
      } = full
      set((state) => ({
        conversations: state.conversations.some((c) => c.id === id)
          ? state.conversations
          : [meta, ...state.conversations],
        messages: { ...state.messages, [id]: messages },
        messagesHydrated: { ...state.messagesHydrated, [id]: true },
        activeLeaf: { ...state.activeLeaf, [id]: activeLeafId },
        compactions: { ...state.compactions, [id]: compactions ?? [] },
        tokenHistories: { ...state.tokenHistories, [id]: tokenHistory ?? [] },
        cacheExpiresAt: { ...state.cacheExpiresAt, [id]: cacheExpiresAt ?? null }
      }))
      void cacheCreatedAt
      target = meta
    }
    let nextSelection = [id]
    if (options?.additive) {
      nextSelection = selectedIds.includes(id)
        ? selectedIds.filter((existing) => existing !== id)
        : [...selectedIds, id]
      if (nextSelection.length === 0) nextSelection = [id]
    } else if (options?.range && activeId) {
      const ids =
        options.rangeIds ??
        conversations
          .filter((c) =>
            target?.archived ? c.archived && !c.fileId : !c.archived && !c.fileId
          )
          .map((c) => c.id)
      // Anchor on the prior active row when it is in the list; otherwise the
      // first already-selected id that appears in `ids` (File Sessions view).
      let anchor = activeId
      if (!ids.includes(anchor)) {
        const fromSelection = selectedIds.find((sid) => ids.includes(sid))
        if (fromSelection) anchor = fromSelection
      }
      const from = ids.indexOf(anchor)
      const to = ids.indexOf(id)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        nextSelection = ids.slice(start, end + 1)
      }
    }

    // Switching never cancels an in-flight turn; it only rebinds the detail column.
    // File-bound sessions use FileSessionView (file canvas + agent).
    void options?.stayInWorkspace
    // Tools tray state is per-session — restore this conversation's layout.
    // File sessions always enter with the tray collapsed: Enclosed dir is opt-in
    // (prepareFileWorkspace / file-session surface). Persist so a later Quiet
    // segment patch cannot revive a stale expanded layout from localStorage.
    let sessionTools = toolsFor(get(), id)
    let toolsLayoutsPatch: Record<string, SessionToolsLayout> | undefined
    if (target?.fileId) {
      sessionTools = {
        ...sessionTools,
        toolsCollapsed: true,
        panelSegment: 'files',
        lastActiveSegment: 'files'
      }
      toolsLayoutsPatch = { ...get().toolsLayouts, [id]: sessionTools }
      saveSessionToolsMap(toolsLayoutsPatch)
    }
    // Paint the new session immediately — hydrate in parallel below.
    set({
      activeId: id,
      selectedIds: nextSelection,
      activeGroupId: null,
      sessionPreview: { kind: 'file' },
      ...(toolsLayoutsPatch ? { toolsLayouts: toolsLayoutsPatch } : {}),
      ...activeToolsFields(sessionTools)
    })

    const conversation = get().conversations.find((c) => c.id === id)
    const cached = !!get().messages[id]
    const applyStatus = (status: Awaited<ReturnType<typeof window.vav.agent.status>>): void => {
      if (get().activeId !== id) return
      set((state) => {
        let messages = state.messages
        // The in-flight assistant message is owned by StreamProjection; showing
        // the disk partial beside it would duplicate every tool card.
        if (
          status.isRunning &&
          status.messageId &&
          messages[id]?.some((m) => m.id === status.messageId)
        ) {
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
    }

    const loadP = get().loadMessages(id)
    const bindP = useWorkspaceStore
      .getState()
      .bindConversation(id, conversation?.workingDirectory ?? null)
    const statusP = window.vav.agent.status(id)

    if (cached) {
      // Returning to a warm session: never block the click on disk/IPC.
      void Promise.all([loadP, bindP, statusP]).then(([, , status]) => applyStatus(status))
      return
    }

    const [, , status] = await Promise.all([loadP, bindP, statusP])
    applyStatus(status)
  },

  async loadMessages(id) {
    const already = get().messagesHydrated[id]
    if (already) {
      // Soft refresh metadata without blocking the switch paint.
      void window.vav.conversations.get(id).then((conversation) => {
        if (!conversation || get().activeId !== id) return
        set((state) => ({
          compactions: {
            ...state.compactions,
            [id]: conversation.compactions ?? []
          },
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
      })
      return
    }

    const conversation = await window.vav.conversations.get(id)
    if (!conversation) return
    set((state) => ({
      messages: { ...state.messages, [id]: conversation.messages },
      messagesHydrated: { ...state.messagesHydrated, [id]: true },
      activeLeaf: { ...state.activeLeaf, [id]: conversation.activeLeafId },
      compactions: {
        ...state.compactions,
        [id]: conversation.compactions ?? []
      },
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
    // Prefer explicit opts; else inherit active session workdir (session is the unit).
    let createOpts = options
    if (createOpts?.workingDirectory === undefined) {
      const current = get().conversations.find((c) => c.id === get().activeId)
      const wd = current?.workingDirectory
      if (wd && !wd.startsWith('__') && !isTemporaryWorkspace(wd, get().tmp)) {
        createOpts = {
          ...createOpts,
          workingDirectory: wd,
          machineId: createOpts?.machineId ?? current.machineId
        }
      }
    }
    const meta = await window.vav.conversations.create(createOpts)
    if (options?.openIn === 'none') {
      set((state) => ({
        conversations: state.conversations.some((c) => c.id === meta.id)
          ? state.conversations
          : [meta, ...state.conversations],
        messages: { ...state.messages, [meta.id]: [] },
        messagesHydrated: { ...state.messagesHydrated, [meta.id]: true },
        activeLeaf: { ...state.activeLeaf, [meta.id]: null }
      }))
      return meta.id
    }
    // Main publishes the full list on create; `onChanged` may already have
    // applied it by the time we get here. Prepending unconditionally would
    // put the same id in the sidebar twice (⌘N made that obvious).
    set((state) => ({
      conversations: state.conversations.some((c) => c.id === meta.id)
        ? state.conversations
        : [meta, ...state.conversations],
      messages: { ...state.messages, [meta.id]: [] },
      messagesHydrated: { ...state.messagesHydrated, [meta.id]: true },
      activeLeaf: { ...state.activeLeaf, [meta.id]: null }
    }))

    // Companion windows are bound to one conversation (native map + local
    // SessionWindow id). Selecting here replaces the chrome but not the
    // binding — send works, the transcript never updates. Open a new window.
    const spawnDetached =
      options?.openIn === 'detached' ||
      (options?.openIn !== 'here' &&
        isCompanionSessionShell() &&
        Boolean(get().pinnedConversationId))
    if (spawnDetached) {
      await get().openDetached(meta.id)
      return
    }

    await get().selectConversation(meta.id)
    // New session → default tools layout (collapsed, files segment). Explicit so
    // we never inherit another session's open Terminal tray.
    get().setToolsCollapsed(true)
    get().focusComposer()
    return meta.id
  },

  async splitSwarmPane(axis = 'row') {
    const { activeId, conversations } = get()
    if (!activeId) return
    const current = conversations.find((c) => c.id === activeId)
    if (!current || current.fileId) return
    const rootId = swarmRootId(current.id, current.swarmParentId)
    const root = conversations.find((c) => c.id === rootId) ?? current
    const layout = root.swarmLayout ?? swarmLeaf(rootId)
    const childId = await get().createConversation({
      workingDirectory: current.workingDirectory ?? null,
      model: current.model,
      swarmParentId: rootId,
      machineId: current.machineId,
      openIn: 'none'
    })
    if (!childId) return
    const next = insertSwarmLeaf(layout, activeId, axis, childId)
    const full = insertSwarmLeaf(root.swarmLayoutFull ?? layout, activeId, axis, childId)
    await persistSwarmLayout((partial) => set(partial), () => get().conversations, rootId, next, full)
    await get().selectConversation(childId)
    get().focusComposer(childId)
    // New pane mounts with the layout update — refocus after paint so the
    // textarea exists (⌘D used to leave focus on the previous composer).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => get().focusComposer(childId))
    })
  },

  async closeSwarmPane(conversationId) {
    if (!conversationId) return
    const { conversations, activeId } = get()
    const current = conversations.find((c) => c.id === conversationId)
    if (!current) return
    const rootId = swarmRootId(current.id, current.swarmParentId)
    const root = conversations.find((c) => c.id === rootId)
    const layout = root?.swarmLayout ?? swarmLeaf(rootId)
    const leaves = collectSwarmLeaves(layout)
    if (leaves.length <= 1) return
    const full = rememberSwarmLayout(root?.swarmLayoutFull, layout)
    const next = removeSwarmLeaf(layout, conversationId) ?? swarmLeaf(rootId)
    await persistSwarmLayout((partial) => set(partial), () => get().conversations, rootId, next, full)
    if (activeId === conversationId) {
      const remain = collectSwarmLeaves(next)
      const fallback = remain[0]
      if (fallback) await get().selectConversation(fallback)
    }
  },

  async focusSwarmSession(conversationId) {
    if (!conversationId) return
    const { conversations, activeId } = get()
    const current = conversations.find((c) => c.id === conversationId)
    if (!current) {
      await get().selectConversation(conversationId)
      return
    }
    const rootId = swarmRootId(current.id, current.swarmParentId)
    const root = conversations.find((c) => c.id === rootId)
    const layout = root?.swarmLayout ?? swarmLeaf(rootId)
    if (collectSwarmLeaves(layout).includes(conversationId)) {
      await get().selectConversation(conversationId)
      return
    }
    const next = restoreSwarmLeaf(layout, root?.swarmLayoutFull, conversationId, activeId)
    const full = rememberSwarmLayout(root?.swarmLayoutFull, next)
    await persistSwarmLayout((partial) => set(partial), () => get().conversations, rootId, next, full)
    await get().selectConversation(conversationId)
  },

  async createConversationInCurrentWorkspace() {
    const { activeId, conversations } = get()
    const current = conversations.find((c) => c.id === activeId)
    if (current) {
      await get().createConversation({
        workingDirectory: current.workingDirectory ?? null,
        model: current.model,
        machineId: current.machineId
      })
      return
    }
    await get().createConversation()
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

  async openWorkspaceInMainPanel(workdir) {
    const path = workdir.trim()
    if (!path) return
    const activeId = get().activeId
    const msgs = activeId ? (get().messages[activeId] ?? []) : []
    set({ activeGroupId: null })
    if (activeId && msgs.length > 0) {
      await get().duplicateConversation(activeId)
    } else {
      await get().createConversation({ workingDirectory: path, openIn: 'here' })
    }
    get().focusComposer()
  },

  async renameConversation(id, title) {
    const conversations = await window.vav.conversations.rename(id, title)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations),
      renamingId: null
    }))
  },

  beginRename(id) {
    set({ renamingId: id })
  },

  requestDelete(ids) {
    void (async () => {
      const { conversations } = get()
      const targets = ids.filter((id) => conversations.some((c) => c.id === id))
      if (targets.length === 0) return

      // Need message counts for every target; empty chats skip the confirm.
      await Promise.all(targets.map((id) => get().loadMessages(id)))
      const empty = targets.filter((id) => (get().messages[id]?.length ?? 0) === 0)

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
          const toolsLayouts = { ...state.toolsLayouts }
          const messageQueues = { ...state.messageQueues }
          for (const id of removed) {
            delete messages[id]
            delete activeLeaf[id]
            delete turns[id]
            delete toolsLayouts[id]
            delete messageQueues[id]
          }
          saveSessionToolsMap(toolsLayouts)
          return {
            conversations: next,
            messages,
            activeLeaf,
            turns,
            toolsLayouts,
            messageQueues
          }
        })
        if (removed.includes(get().activeId)) {
          const fallback = next.find((c) => !c.archived && !c.fileId)?.id ?? next[0]?.id
          if (fallback) await get().selectConversation(fallback)
          else {
            set({ activeId: '', selectedIds: [], activeGroupId: null })
          }
        }
      }

      // A lone empty chat can go without a sheet. Multi-select always confirms
      // — even if every target is empty — so Backspace on a range is reversible.
      if (targets.length === 1 && empty.length === 1) {
        await applyRemove(empty)
        return
      }

      const single = targets.length === 1
      const title = single
        ? tt('dialog.deleteSession')
        : tt('dialog.deleteSessions', { count: targets.length })
      const name = conversations.find((c) => c.id === targets[0])?.title ?? ''
      const body = single
        ? tt('dialog.deleteConfirmSingle', { name })
        : tt('dialog.deleteConfirmMultiple', { count: targets.length })

      get().showDialog({
        title,
        body,
        confirmLabel: tt('common.delete'),
        destructive: true,
        onConfirm: () => void applyRemove(targets)
      })
    })()
  },

  focusToolsSlot(slot) {
    if (slot < 1 || slot > 9) return
    const activeId = get().activeId
    if (slot === 1) {
      get().setPanelSegment('files')
      return
    }
    if (!activeId) return
    const tabs = useWorkspaceStore.getState().workspaces[activeId]?.tabs ?? []
    const tab = tabs[slot - 2]
    if (!tab) return
    useWorkspaceStore.getState().selectTab(activeId, tab.id)
    get().setPanelSegment('terminal')
  },

  async setModel(id, model) {
    // Optimistic update so the picker reflects the choice immediately (and so
    // file-preview sessions, which are omitted from listMeta, stay in the store).
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, model } : c))
    }))
    try {
      const list = await window.vav.conversations.setModel(id, model)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
      const host = get().conversations.find((c) => c.id === id)?.cliHost ?? null
      const settings = get().settings
      if (!host) {
        if (model && model !== settings.defaultModel) {
          void get().updateSettings({ defaultModel: model })
        }
      } else if ((settings.defaultAgentModels?.[host] ?? '') !== model) {
        void get().updateSettings({
          defaultAgentModels: { ...settings.defaultAgentModels, [host]: model }
        })
      }
    } catch (err) {
      console.error('[setModel] failed', err)
    }
  },

  async stepModel(id, delta) {
    const conv = get().conversations.find((c) => c.id === id)
    if (!conv) return

    const { settings, agentModelCatalog } = get()
    const { cliHost, accountId, model: currentModel } = conv

    let vendorId: string | null = null
    if (cliHost == null) {
      const catalogKey = Object.keys(agentModelCatalog).find((k) =>
        accountId ? k.endsWith(`:${accountId}`) : k === 'vav'
      )
      const entry = catalogKey ? agentModelCatalog[catalogKey] : null
      vendorId = vendorIdFromEndpoint(entry?.endpoint ?? settings.apiEndpoint)
    }
    const key = agentModelHostKey(cliHost, vendorId, accountId)
    const entry = agentModelCatalog[key]
    const raw =
      entry?.models && entry.models.length > 0
        ? entry.models
        : modelsForChatHost(cliHost, settings.customModels, settings.defaultModel, vendorId)
    const list = filterEnabledModels(cliHost, raw, settings.disabledAgentModels, vendorId, accountId)

    if (list.length <= 1) return

    const activeModel = resolveModelForChatHost(cliHost, currentModel, {
      customModels: settings.customModels,
      vavDefaultModel: settings.defaultModel,
      hostDefaultModel: defaultModelForChatHost(cliHost, settings),
      catalogue: list,
      vendorId
    })

    const index = list.findIndex((m) => m.id === activeModel)
    if (index === -1) {
      await get().setModel(id, list[0].id)
      return
    }

    const nextIndex = (index + delta + list.length) % list.length
    const nextModel = list[nextIndex].id
    await get().setModel(id, nextModel)
  },

  async setAgentBinaryName(id, agentBinaryName) {
    // Optimistic first — file-preview sessions never appear in listMeta, so a
    // raw `set({ conversations: list })` would drop them and snap the switcher
    // back to vav (single-file window agent switch looked broken).
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, agentBinaryName } : c
      )
    }))
    try {
      const list = await window.vav.conversations.setAgentBinaryName(id, agentBinaryName)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
    } catch (err) {
      console.error('[setAgentBinaryName] failed', err)
    }
  },

  async setCliHost(id, host, accountId) {
    const nextHost = (host as ConversationMeta['cliHost']) ?? null
    const current = get().conversations.find((c) => c.id === id)
    const nodes = get().messages[id]
    if (nodes && nodes.length > 0 && (current?.cliHost ?? null) !== nextHost) {
      return
    }
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id
          ? {
              ...c,
              cliHost: nextHost,
              agentBinaryName: host,
              accountId: accountId ?? c.accountId
            }
          : c
      )
    }))
    try {
      const result = await window.vav.conversations.setCliHost(id, host, accountId)
      if (result.hostChanged) disposeProjection(id)
      const transcript = result.transcript
      set((state) => {
        const pendingReviewByConversation = { ...state.pendingReviewByConversation }
        const turns = { ...state.turns }
        if (result.hostChanged) {
          delete pendingReviewByConversation[id]
          delete turns[id]
        }
        let conversations = mergeConversationList(state.conversations, result.conversations)
        if (transcript) {
          conversations = conversations.map((c) =>
            c.id === id
              ? {
                  ...c,
                  tokensUsed: transcript.tokensUsed,
                  cliResumeCursor: transcript.cliResumeCursor,
                  cliHost: transcript.cliHost,
                  model: transcript.model || c.model,
                  quotaWindows: transcript.quotaWindows ?? []
                }
              : c
          )
        }
        return {
          conversations,
          messages: transcript
            ? { ...state.messages, [id]: transcript.messages }
            : state.messages,
          messagesHydrated: transcript
            ? { ...state.messagesHydrated, [id]: true }
            : state.messagesHydrated,
          activeLeaf: transcript
            ? { ...state.activeLeaf, [id]: transcript.activeLeafId }
            : state.activeLeaf,
          compactions: transcript
            ? { ...state.compactions, [id]: transcript.compactions }
            : state.compactions,
          tokenHistories: transcript
            ? { ...state.tokenHistories, [id]: transcript.tokenHistory }
            : state.tokenHistories,
          cacheCreatedAt: transcript
            ? { ...state.cacheCreatedAt, [id]: transcript.cacheCreatedAt }
            : state.cacheCreatedAt,
          cacheExpiresAt: transcript
            ? { ...state.cacheExpiresAt, [id]: transcript.cacheExpiresAt }
            : state.cacheExpiresAt,
          pendingReviewByConversation,
          turns,
          liveUsage: omitLiveUsage(state.liveUsage, id),
          errorBanner: result.hostChanged && state.activeId === id ? null : state.errorBanner,
          errorBannerKind:
            result.hostChanged && state.activeId === id ? null : state.errorBannerKind,
          errorBannerDetail:
            result.hostChanged && state.activeId === id ? null : state.errorBannerDetail
        }
      })
    } catch (err) {
      console.error('[setCliHost] failed', err)
    }
    const latest = get().conversations.find((c) => c.id === id)
    trimAttachmentsForHost(id, latest?.cliHost ?? nextHost, get, set)
  },

  async selectChatHost(id, host, vendorId, accountId) {
    // Surface park is one call (exitCliMode is idempotent + syncs layouts).
    useWorkspaceStore.getState().exitCliMode(id)
    if (get().search.open) get().closeSearch()
    await get().setCliHost(id, host, accountId)
    // Agent owns the model catalogue — coerce to a valid id for the new host
    // when the parked bucket did not restore one (or restored a foreign id).
    const state = get()
    const conversation = state.conversations.find((c) => c.id === id)
    if (!conversation) return
    const catalogue =
      state.agentModelCatalog[agentModelHostKey(host as ConversationMeta['cliHost'], vendorId, accountId)]
        ?.models ?? null
    const nextModel = resolveModelForChatHost(
      host as ConversationMeta['cliHost'],
      conversation.model,
      {
        customModels: state.settings.customModels,
        vavDefaultModel: state.settings.defaultModel,
        hostDefaultModel: defaultModelForChatHost(host as ConversationMeta['cliHost'], state.settings),
        catalogue
      }
    )
    if (nextModel !== conversation.model) {
      await get().setModel(id, nextModel)
    }
  },

  markEnclosedDirChip(id) {
    set((state) => ({
      workdirPathRevealed: { ...state.workdirPathRevealed, [id]: false }
    }))
  },

  revealWorkdirPath(id) {
    set((state) => ({
      workdirPathRevealed: { ...state.workdirPathRevealed, [id]: true }
    }))
  },

  async pickWorkingDirectory(id) {
    if (swarmBlocksWorkdirSwitch(id, get().settings.swarmModeEnabled === true)) return
    const conversations = await window.vav.conversations.pickWorkingDirectory(id)
    if (!conversations) return
    // Any explicit switch reveals the real path (even if same directory).
    get().revealWorkdirPath(id)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations)
    }))
    const next = conversations.find((c) => c.id === id)?.workingDirectory ?? null
    await useWorkspaceStore.getState().setWorkingDirectory(id, next)
  },

  async useTempWorkingDirectory(id) {
    if (swarmBlocksWorkdirSwitch(id, get().settings.swarmModeEnabled === true)) return
    const conversations = await window.vav.conversations.useTempWorkingDirectory(id)
    get().revealWorkdirPath(id)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations)
    }))
    const next = conversations.find((c) => c.id === id)?.workingDirectory ?? null
    await useWorkspaceStore.getState().setWorkingDirectory(id, next)
  },

  async setWorkingDirectory(id, path, machineId) {
    if (swarmBlocksWorkdirSwitch(id, get().settings.swarmModeEnabled === true)) return
    // User-driven switch (menu / recent) — always reveal real path thereafter.
    get().revealWorkdirPath(id)
    const conversations = await window.vav.conversations.setWorkingDirectory(id, path, machineId)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations)
    }))
    await useWorkspaceStore.getState().setWorkingDirectory(id, path)
  },

  openRemoteFolderPicker(conversationId, machineId) {
    set({ remoteFolderPick: { conversationId, machineId } })
  },

  closeRemoteFolderPicker() {
    set({ remoteFolderPick: null })
  },

  async locateWorkspace(id) {
    if (swarmBlocksWorkdirSwitch(id, get().settings.swarmModeEnabled === true)) return
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
    set((state) => ({
      conversations: mergeConversationList(state.conversations, result.conversations)
    }))
    const next =
      result.conversations.find((c) => c.id === id)?.workingDirectory ?? null
    await useWorkspaceStore.getState().setWorkingDirectory(id, next)
  },

  setSidebarQuery(query) {
    set({ sidebarQuery: query })
  },

  async setPinned(id, pinned) {
    const conversations = await window.vav.conversations.setPinned(id, pinned)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations)
    }))
  },

  async setFavorite(id, favorite) {
    const current = get().settings.favoriteConversationIds ?? []
    const has = current.includes(id)
    if (favorite && !has) {
      await get().updateSettings({ favoriteConversationIds: [id, ...current] })
      return
    }
    if (!favorite && has) {
      await get().updateSettings({
        favoriteConversationIds: current.filter((entry) => entry !== id)
      })
    }
  },

  async setWorkspacePinned(workdir, pinned) {
    const path = workdir.trim()
    if (!path || path.startsWith('__')) return
    const current = get().settings.pinnedWorkspaceDirectories
    const rest = current.filter((entry) => entry !== path)
    if (pinned && rest.length === current.length) {
      await get().updateSettings({ pinnedWorkspaceDirectories: [path, ...rest] })
      return
    }
    if (!pinned && rest.length !== current.length) {
      await get().updateSettings({ pinnedWorkspaceDirectories: rest })
    }
  },

  async setArchived(id, archived) {
    const conversations = await window.vav.conversations.setArchived(id, archived)
    const { activeId, sidebarListMode } = get()
    const isActive = id === activeId
    // Archiving keeps the current list — the sidebar moves the selection to
    // the archived row's neighbor instead of jumping to the archive view.
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations),
      ...(isActive && !archived && sidebarListMode === 'archive'
        ? { sidebarListMode: 'main' as const }
        : {})
    }))
  },

  async setApprovalMode(id, mode) {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, approvalMode: mode } : c
      )
    }))
    try {
      const list = await window.vav.conversations.setApprovalMode(id, mode)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
      // Remember bypass/auto/edit as the default for new chats.
      if (mode && mode !== get().settings.defaultApprovalMode) {
        void get().updateSettings({ defaultApprovalMode: mode })
      }
    } catch (err) {
      console.error('[setApprovalMode] failed', err)
    }
  },

  async setAcpMode(id, modeId) {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, acpSession: patchAcpSessionMode(c.acpSession, modeId) } : c
      )
    }))
    try {
      const list = await window.vav.conversations.setAcpMode(id, modeId)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
    } catch (err) {
      console.error('[setAcpMode] failed', err)
    }
  },

  async setAcpConfigOption(id, configId, value) {
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (c.id !== id) return c
        const next = patchAcpConfigOption(c.acpSession, configId, value)
        return next ? { ...c, acpSession: next } : c
      })
    }))
    try {
      const list = await window.vav.conversations.setAcpConfigOption(id, configId, value)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
    } catch (err) {
      console.error('[setAcpConfigOption] failed', err)
    }
  },

  async setThinkingLevel(id, level) {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, thinkingLevel: level } : c
      )
    }))
    try {
      const list = await window.vav.conversations.setThinkingLevel(id, level)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
      if (level && level !== get().settings.defaultThinkingLevel) {
        void get().updateSettings({ defaultThinkingLevel: level })
      }
    } catch (err) {
      console.error('[setThinkingLevel] failed', err)
    }
  },

  async setFast(id, fast) {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, fast } : c))
    }))
    try {
      const list = await window.vav.conversations.setFast(id, fast)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
    } catch (err) {
      console.error('[setFast] failed', err)
    }
  },

  async setFocusedFile(id, path) {
    // Viewing / focusing a file must not reorder the sidebar — patch one row only.
    const current = get().conversations.find((c) => c.id === id)
    if (current && (current.focusedFilePath ?? null) === path) return
    // Optimistic local patch (no list reshuffle).
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, focusedFilePath: path } : c
      )
    }))
    try {
      await window.vav.conversations.setFocusedFile(id, path)
    } catch {
      // keep local patch; main may be unavailable
    }
  },

  async attachContextFile(id, path) {
    const prev = get().contextFiles[id] ?? null
    const pathChanged = prev !== path
    if (pathChanged) {
      set((state) => ({
        contextFiles: { ...state.contextFiles, [id]: path }
      }))
    }
    // Always push to main so the built-in VAV agent open-file context stays in sync.
    // CLI / Bash hosts are NOT auto-pasted here — that stacked a new TUI block on
    // every file click. Use Files → “Insert information to agent” for that.
    await get().setFocusedFile(id, path)
  },

  async dismissContextFile(id) {
    set((state) => ({
      contextFiles: { ...state.contextFiles, [id]: null }
    }))
    await get().setFocusedFile(id, null)
  },

  async openDetached(id) {
    // Persist split directions + cliMode before the companion hydrates.
    // Must await: racing open used to land with cliMode=false → bounced to VAV.
    await useWorkspaceStore.getState().syncPtyLayouts(id)
    await window.vav.window.openSession(id)
  },

  setDraft(id, text) {
    set((state) => ({ drafts: { ...state.drafts, [id]: text } }))
  },

  setAttachments(id, paths) {
    set((state) => ({ attachments: { ...state.attachments, [id]: paths } }))
  },

  addAttachments(id, incoming, opts) {
    if (!id || incoming.length === 0) return
    const host = get().conversations.find((c) => c.id === id)?.cliHost ?? null
    const existing = get().attachments[id] ?? []
    const plan = mergeImageAttachments({
      existing,
      incoming,
      capability: imageInputLimits(host),
      sizes: opts?.sizes
    })
    set((state) => ({ attachments: { ...state.attachments, [id]: plan.paths } }))
    notifyImageAttachPlan(get().showToast, plan)
  },

  setQuote(id, quote) {
    set((state) => ({ quotes: { ...state.quotes, [id]: quote } }))
  },

  clearQuote(id) {
    const target = id ?? get().activeId
    if (!target) return
    set((state) => ({ quotes: { ...state.quotes, [target]: null } }))
  },

  setPreviewRefs(id, refs) {
    set((state) => ({ previewRefs: { ...state.previewRefs, [id]: refs } }))
  },

  clearPreviewRefs(id) {
    const target = id ?? get().activeId
    if (!target) return
    set((state) => ({ previewRefs: { ...state.previewRefs, [target]: [] } }))
  },

  setPickMode(id, on) {
    set((state) => ({ pickMode: { ...state.pickMode, [id]: on } }))
  },

  setCommentCards(id, cards) {
    set((state) => ({ commentCards: { ...state.commentCards, [id]: cards } }))
  },

  updateCommentCard(id, refId, comment) {
    set((state) => ({
      commentCards: {
        ...state.commentCards,
        [id]: (state.commentCards[id] ?? []).map((c) =>
          c.ref.id === refId ? { ...c, comment } : c
        )
      }
    }))
  },

  removeCommentCard(id, refId) {
    set((state) => ({
      commentCards: {
        ...state.commentCards,
        [id]: (state.commentCards[id] ?? []).filter((c) => c.ref.id !== refId)
      }
    }))
  },

  clearCommentCards(id) {
    const target = id ?? get().activeId
    if (!target) return
    set((state) => ({ commentCards: { ...state.commentCards, [target]: [] } }))
  },

  scrollToMessage(messageId) {
    set((state) => ({
      flashMessageId: messageId,
      flashTick: state.flashTick + 1
    }))
  },

  async send(text, attachments, conversationId) {
    const {
      activeId: storeActiveId,
      settings,
      turns,
      quotes,
      previewRefs,
      commentCards,
      contextFiles,
      conversations,
      messageQueues
    } = get()
    let activeId = conversationId?.trim() || storeActiveId
    if (activeId && conversations.some((c) => c.id === activeId && c.archived)) return
    // Empty chat shell: mint the session on first send (workspace materializes).
    if (!activeId || !conversations.some((c) => c.id === activeId)) {
      await get().createConversation({ openIn: 'here' })
      activeId = get().activeId
      if (!activeId) return
    }
    const turn = turns[activeId]
    const refs = previewRefs[activeId] ?? []
    const cards = commentCards[activeId] ?? []
    if (!text.trim() && attachments.length === 0 && refs.length === 0 && cards.length === 0) return

    // ask_user_question pause: composer is disabled — never enqueue here.
    if (turn?.awaitingToolCallId) return

    // Built-in VAV needs an API key; structured CLI hosts use their own auth.
    const activeHost =
      conversations.find((c) => c.id === activeId)?.cliHost ?? null
    if (!activeHost && !settings.apiKeyPresent) {
      get().showDialog({
        title: tt('common.hint'),
        body: tt('dialog.configureApiKeyBody'),
        confirmLabel: tt('error.openSettings'),
        onConfirm: () => get().openSettings('agents', 'vav')
      })
      return
    }

    // Streaming: enqueue instead of interrupting (main-chat-streaming.rpml §5).
    if (turn?.isRunning) {
      const queue = messageQueues[activeId] ?? []
      if (queue.length >= MESSAGE_QUEUE_MAX) {
        get().showToast({
          kind: 'error',
          title: tt('queue.fullTitle'),
          description: tt('queue.fullBody', { n: MESSAGE_QUEUE_MAX })
        })
        return
      }
      const quote = quotes[activeId] ?? null
      const contextFile =
        (contextFiles[activeId] ?? null) ||
        conversations.find((c) => c.id === activeId)?.focusedFilePath ||
        null
      const item: QueuedMessage = {
        id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        text: text.trim(),
        attachments: [...attachments],
        previewRefs: refs.map((r) => ({ ...r })),
        commentCards: cards.map((c) => ({
          ref: { ...c.ref },
          comment: c.comment
        })),
        quote: quote ? { ...quote } : null,
        contextFile,
        createdAt: Date.now()
      }
      set((state) => ({
        messageQueues: {
          ...state.messageQueues,
          [activeId!]: [...(state.messageQueues[activeId!] ?? []), item]
        },
        drafts: { ...state.drafts, [activeId!]: '' },
        attachments: { ...state.attachments, [activeId!]: [] },
        quotes: { ...state.quotes, [activeId!]: null },
        previewRefs: { ...state.previewRefs, [activeId!]: [] },
        commentCards: { ...state.commentCards, [activeId!]: [] },
        errorBanner: null,
        errorBannerKind: null,
        errorBannerDetail: null
      }))
      return
    }

    // Keep global selection aligned so Transcript / tools / IPC stay on the
    // same conversation as this send (file drawer / workspace column).
    if (storeActiveId !== activeId) {
      await get().selectConversation(activeId)
    }

    const quote = quotes[activeId] ?? null

    // Comment cards → structured PreviewRef.comment (bubble shows cards; model
    // gets block + note via composeContextUserText). Do not bake into content.
    const cardRefs = cards.map((c) => {
      const note = c.comment.trim()
      return note ? { ...c.ref, comment: note } : { ...c.ref }
    })
    // Dedupe by id: a ref both pinned as chip and as comment card keeps the
    // commented version.
    const byId = new Map<string, (typeof refs)[number]>()
    for (const ref of refs) byId.set(ref.id, ref)
    for (const ref of cardRefs) byId.set(ref.id, ref)
    const allRefs = [...byId.values()]

    const contextFile =
      (contextFiles[activeId] ?? null) ||
      conversations.find((c) => c.id === activeId)?.focusedFilePath ||
      null

    // No optimistic echo: the stored message comes back as a `user` turn event
    // a moment later, already carrying the id and parent the tree needs.
    set((state) => ({
      drafts: { ...state.drafts, [activeId]: '' },
      attachments: { ...state.attachments, [activeId]: [] },
      quotes: { ...state.quotes, [activeId]: null },
      previewRefs: { ...state.previewRefs, [activeId]: [] },
      commentCards: { ...state.commentCards, [activeId]: [] },
      errorBanner: null,
      errorBannerKind: null,
      errorBannerDetail: null
    }))

    await window.vav.agent.send(
      activeId,
      text,
      attachments,
      quote,
      allRefs.length ? allRefs : null,
      contextFile
    )
  },

  updateQueuedMessage(conversationId, queueId, text) {
    set((state) => {
      const queue = state.messageQueues[conversationId]
      if (!queue) return state
      const next = queue.map((item) =>
        item.id === queueId ? { ...item, text: text.trim() } : item
      )
      return { messageQueues: { ...state.messageQueues, [conversationId]: next } }
    })
  },

  removeQueuedMessage(conversationId, queueId) {
    set((state) => {
      const queue = state.messageQueues[conversationId]
      if (!queue) return state
      return {
        messageQueues: {
          ...state.messageQueues,
          [conversationId]: queue.filter((item) => item.id !== queueId)
        }
      }
    })
  },

  async sendQueuedNow(conversationId, queueId) {
    const state = get()
    const queue = state.messageQueues[conversationId] ?? []
    const item = queue.find((q) => q.id === queueId)
    if (!item) return
    if (
      !item.text.trim() &&
      item.attachments.length === 0 &&
      item.previewRefs.length === 0 &&
      item.commentCards.length === 0
    ) {
      get().removeQueuedMessage(conversationId, queueId)
      return
    }

    // Drop from queue first so a second click can't double-send.
    get().removeQueuedMessage(conversationId, queueId)

    queueSendInFlight.add(conversationId)
    try {
      const turn = get().turns[conversationId]
      if (turn?.isRunning) {
        await get().cancel(conversationId)
        const idle = await new Promise<boolean>((resolve) => {
          const started = Date.now()
          const tick = (): void => {
            if (!get().turns[conversationId]?.isRunning) {
              resolve(true)
              return
            }
            if (Date.now() - started >= 20_000) {
              resolve(false)
              return
            }
            window.setTimeout(tick, 40)
          }
          tick()
        })
        if (!idle) {
          // Put the item back if we could not interrupt cleanly.
          set((s) => ({
            messageQueues: {
              ...s.messageQueues,
              [conversationId]: [item, ...(s.messageQueues[conversationId] ?? [])]
            }
          }))
          get().showToast({
            kind: 'error',
            title: tt('queue.sendNowFailed'),
            description: tt('queue.sendNowFailedBusy')
          })
          return
        }
      }

      set({ errorBanner: null, errorBannerKind: null, errorBannerDetail: null })
      await dispatchQueuedPayload(conversationId, item, async () => {
        if (get().activeId !== conversationId) {
          await get().selectConversation(conversationId)
        }
      })
    } finally {
      queueSendInFlight.delete(conversationId)
    }
  },

  /**
   * After a turn ends, send the head of the queue (FIFO) if idle.
   * Does nothing while ask_user_question is pending or a manual send-now is in flight.
   */
  async drainMessageQueue(conversationId) {
    if (queueSendInFlight.has(conversationId)) return
    const turn = get().turns[conversationId]
    if (turn?.isRunning || turn?.awaitingToolCallId) return
    const head = get().messageQueues[conversationId]?.[0]
    if (!head) return
    // Re-use sendQueuedNow so removal + payload path stay single-sourced.
    await get().sendQueuedNow(conversationId, head.id)
  },

  async regenerate(messageId) {
    const state = get()
    const { activeId } = state
    if (!activeId || state.turns[activeId]?.isRunning) return
    if (state.conversations.some((c) => c.id === activeId && c.archived)) return
    // Drop back to the prompt right away, or the reply being replaced would sit
    // above the stream and look like one more record.
    const target = state.messages[activeId]?.find((m) => m.id === messageId)
    if (!target) return
    setLeaf(set, state, activeId, target.role === 'assistant' ? target.parentId : target.id)
    set({ errorBanner: null, errorBannerKind: null, errorBannerDetail: null })
    await window.vav.agent.regenerate(activeId, messageId)
  },

  async editUserMessage(messageId, text) {
    const state = get()
    const { activeId } = state
    if (!activeId || state.turns[activeId]?.isRunning || !text.trim()) return
    if (state.conversations.some((c) => c.id === activeId && c.archived)) return
    const target = state.messages[activeId]?.find((m) => m.id === messageId)
    if (!target) return
    setLeaf(set, state, activeId, target.parentId)
    set({ errorBanner: null, errorBannerKind: null, errorBannerDetail: null })
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
    const { activeId, conversations } = get()
    if (!activeId) return
    if (conversations.some((c) => c.id === activeId && c.archived)) return
    setLeaf(set, get(), activeId, parentKey)
    await window.vav.conversations.setLeaf(activeId, parentKey)
    get().focusComposer()
  },

  requestDeleteMessage(messageId) {
    const { activeId } = get()
    if (!activeId) return
    if (get().turns[activeId]?.isRunning) return
    if (get().conversations.some((c) => c.id === activeId && c.archived)) return
    const nodes = get().messages[activeId] ?? []
    if (!nodes.some((message) => message.id === messageId)) return
    const extra = Math.max(0, subtreeIds(nodes, messageId).size - 1)
    get().showDialog({
      title: tt('message.delete'),
      body:
        extra > 0
          ? tt('message.deleteConfirmFollow', { count: extra })
          : tt('message.deleteConfirm'),
      confirmLabel: tt('common.delete'),
      destructive: true,
      onConfirm: () => void get().deleteMessage(messageId)
    })
  },

  async deleteMessage(messageId) {
    const { activeId } = get()
    if (!activeId) return
    if (get().turns[activeId]?.isRunning) return
    if (get().conversations.some((c) => c.id === activeId && c.archived)) return
    const result = await window.vav.conversations.deleteMessage(activeId, messageId)
    if (!result) return
      set((state) => ({
        conversations: mergeConversationList(state.conversations, result.conversations),
        messages: { ...state.messages, [activeId]: result.messages },
        messagesHydrated: { ...state.messagesHydrated, [activeId]: true },
        activeLeaf: { ...state.activeLeaf, [activeId]: result.activeLeafId }
      }))
  },

  async fork(messageId) {
    const state = get()
    const { activeId } = state
    if (!activeId || state.turns[activeId]?.isRunning) return
    if (state.conversations.some((c) => c.id === activeId && c.archived)) return
    const leaf = await window.vav.agent.fork(activeId, messageId)
    if (leaf === null) return
    setLeaf(set, get(), activeId, leaf)
    get().focusComposer()
  },

  async continueInNewSession(messageId) {
    const { activeId, conversations } = get()
    if (!activeId) return
    if (conversations.some((c) => c.id === activeId && c.archived)) return
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

  async compactConversation(keepAfterMessageId) {
    const { activeId } = get()
    if (!activeId) return false
    if (get().conversations.some((c) => c.id === activeId && c.archived)) return false
    if (get().conversations.find((c) => c.id === activeId)?.cliHost) {
      set({
        errorBanner: tt('compact.error.cliHost'),
        errorBannerKind: 'generic',
        errorBannerDetail: tt('compact.error.cliHost')
      })
      return false
    }
    if (get().turns[activeId]?.isRunning) {
      set({
        errorBanner: tt('compact.error.busy'),
        errorBannerKind: 'generic',
        errorBannerDetail: tt('compact.error.busy')
      })
      return false
    }
    const result = await window.vav.agent.compact(
      activeId,
      keepAfterMessageId ? { keepAfterMessageId } : undefined
    )
    if (!result.ok) {
      set({
        errorBanner: result.error,
        errorBannerKind: 'generic',
        errorBannerDetail: result.error
      })
      return false
    }
    // No toast — transcript shows a quiet "history compact" log via CompactionBanner.
    // Shrink context fill on the conversation meta so the composer ring updates.
    set((state) => ({
      compactions: {
        ...state.compactions,
        [activeId]: upsertCompaction(state.compactions[activeId], result.compaction)
      },
      liveUsage: omitLiveUsage(state.liveUsage, activeId),
      conversations: state.conversations.map((c) =>
        c.id === activeId
          ? { ...c, tokensUsed: result.compaction.estimatedContextTokens }
          : c
      )
    }))
    return true
  },

  async clearCompaction() {
    const { activeId } = get()
    if (!activeId) return false
    if (get().conversations.find((c) => c.id === activeId)?.cliHost) {
      set({
        errorBanner: tt('compact.error.cliHost'),
        errorBannerKind: 'generic',
        errorBannerDetail: tt('compact.error.cliHost')
      })
      return false
    }
    const leafId = get().activeLeaf[activeId]
    const messages = get().messages[activeId] ?? []
    const active = compactionForLeaf(get().compactions[activeId], messages, leafId)
    if (!active) return false
    const result = await window.vav.agent.clearCompaction(activeId, active.leafId)
    if (!result.ok) {
      set({
        errorBanner: result.error,
        errorBannerKind: 'generic',
        errorBannerDetail: result.error
      })
      return false
    }
    set((state) => ({
      compactions: {
        ...state.compactions,
        [activeId]: (state.compactions[activeId] ?? []).filter((c) => c.leafId !== active.leafId)
      }
    }))
    return true
  },

  async cancel(id) {
    await window.vav.agent.cancel(id)
  },

  async answerTool(toolCallId, answer) {
    const { activeId } = get()
    // Main resolves by toolCallId when activeId is desynced (file preview).
    // Prefer the conversation that is actually awaiting this card.
    let conversationId = activeId || ''
    if (toolCallId) {
      for (const [id, turn] of Object.entries(get().turns)) {
        if (turn.awaitingToolCallId === toolCallId || turn.phase === 'awaiting-user') {
          conversationId = id
          if (turn.awaitingToolCallId === toolCallId) break
        }
      }
    }
    const ok = await window.vav.agent.answer(conversationId, toolCallId, answer)
    if (ok === false) {
      console.warn('[session] answerTool: main had no pending waiter', {
        conversationId,
        toolCallId,
        activeId
      })
    }
    return ok !== false
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

  openSettings(category, agentId) {
    // Settings own a window; the main window only asks for it to be raised.
    void window.vav.window.openSettings(category ?? 'appearance', agentId)
  },

  closeSettings() {
    void window.vav.window.closeSettings()
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
    let matchIds = EMPTY_SEARCH_MATCH_IDS
    if (trimmed) {
      const next = visibleMessages(state, state.activeId)
        .filter((m) => m.content.toLowerCase().includes(trimmed.toLowerCase()))
        .map((m) => m.id)
      // Reuse previous array when hits are unchanged so selectors/effects stay quiet.
      const prev = state.search.matchIds
      matchIds =
        prev.length === next.length && prev.every((id, i) => id === next[i]) ? prev : next
    }
    set((s) => ({
      search: {
        ...s.search,
        query,
        matchIds,
        index: 0,
        // Only bump tick when the hit list changes so Enter/navigation still
        // re-scrolls; pure keystrokes with the same hits do not thrash layout.
        tick: matchIds === s.search.matchIds ? s.search.tick : s.search.tick + 1
      }
    }))
  },

  stepSearch(direction) {
    set((state) => {
      const count = state.search.matchIds.length
      if (count === 0) return state
      const index = (state.search.index + direction + count) % count
      if (index === state.search.index) {
        // Same hit (single match): still bump tick so scroll re-fires.
        return { search: { ...state.search, tick: state.search.tick + 1 } }
      }
      return { search: { ...state.search, index, tick: state.search.tick + 1 } }
    })
  },

  setErrorBanner(message) {
    set({
      errorBanner: message,
      errorBannerKind: message ? 'generic' : null,
      errorBannerDetail: message
    })
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

  showToast(toast) {
    set({ toast })
    if (toast) {
      window.setTimeout(() => {
        if (get().toast === toast) set({ toast: null })
      }, 4200)
    }
  },

  async openChangeReview(changeSetId) {
    if (!changeSetId) return
    // Already cached — do not clear or thrash on remount / next turn.
    const hit = get().changeSetsById[changeSetId]
    if (hit) {
      set({ changeSet: hit })
      return
    }
    // Cache only — full-screen takeover removed; inline cards use changeSetsById.
    const changeSet = await window.vav.changeSets.get(changeSetId)
    if (!changeSet) return
    set((state) => ({
      changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet },
      changeSet
    }))
  },

  closeChangeReview() {
    set({ changeReviewId: null })
  },

  async refreshChangeSet() {
    const id = get().changeReviewId ?? get().changeSet?.id
    if (!id) return
    const changeSet = await window.vav.changeSets.get(id)
    if (!changeSet) {
      set({ changeReviewId: null, changeSet: null })
      return
    }
    set((state) => ({
      changeSet,
      changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet }
    }))
    syncPendingBanner(set, changeSet)
  },

  async acceptChangeFiles(filePaths) {
    const id = get().changeReviewId ?? get().changeSet?.id
    if (!id) return
    await get().acceptChangeFilesFor(id, filePaths)
  },

  async rejectChangeFiles(filePaths) {
    const id = get().changeReviewId ?? get().changeSet?.id
    if (!id) return
    await get().rejectChangeFilesFor(id, filePaths)
  },

  async acceptAllChanges() {
    const id = get().changeReviewId ?? get().changeSet?.id
    if (!id) return
    await get().acceptAllChangesFor(id)
  },

  async rejectAllChanges() {
    const id = get().changeReviewId ?? get().changeSet?.id
    if (!id) return
    await get().rejectAllChangesFor(id)
  },

  async undoChangeFile(filePath) {
    const id = get().changeReviewId ?? get().changeSet?.id
    if (!id) return
    await get().undoChangeFileFor(id, filePath)
  },

  async applyChangeEdit(filePath, content) {
    const id = get().changeReviewId ?? get().changeSet?.id
    if (!id) return
    const changeSet = await window.vav.changeSets.applyEdit(id, filePath, content)
    if (changeSet) {
      set((state) => ({
        changeSet,
        changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet }
      }))
      syncPendingBanner(set, changeSet)
    }
  },

  async acceptChangeFilesFor(changeSetId, filePaths) {
    if (!changeSetId || filePaths.length === 0) return
    const changeSet = await window.vav.changeSets.accept(changeSetId, filePaths)
    if (changeSet) {
      set((state) => ({
        changeSet: state.changeSet?.id === changeSet.id ? changeSet : state.changeSet,
        changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet }
      }))
      syncPendingBanner(set, changeSet)
    }
  },

  async rejectChangeFilesFor(changeSetId, filePaths) {
    if (!changeSetId || filePaths.length === 0) return
    const changeSet = await window.vav.changeSets.reject(changeSetId, filePaths)
    if (changeSet) {
      set((state) => ({
        changeSet: state.changeSet?.id === changeSet.id ? changeSet : state.changeSet,
        changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet }
      }))
      syncPendingBanner(set, changeSet)
    }
  },

  async acceptAllChangesFor(changeSetId) {
    if (!changeSetId) return
    const changeSet = await window.vav.changeSets.acceptAll(changeSetId)
    if (changeSet) {
      set((state) => ({
        changeSet: state.changeSet?.id === changeSet.id ? changeSet : state.changeSet,
        changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet },
        changeReviewId: null
      }))
      syncPendingBanner(set, changeSet)
    }
  },

  async rejectAllChangesFor(changeSetId) {
    if (!changeSetId) return
    const changeSet = await window.vav.changeSets.rejectAll(changeSetId)
    if (changeSet) {
      set((state) => ({
        changeSet: state.changeSet?.id === changeSet.id ? changeSet : state.changeSet,
        changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet },
        changeReviewId: null
      }))
      syncPendingBanner(set, changeSet)
    }
  },

  async undoChangeFileFor(changeSetId, filePath) {
    if (!changeSetId) return
    const changeSet = await window.vav.changeSets.undo(changeSetId, filePath)
    if (changeSet) {
      set((state) => ({
        changeSet: state.changeSet?.id === changeSet.id ? changeSet : state.changeSet,
        changeSetsById: { ...state.changeSetsById, [changeSet.id]: changeSet }
      }))
      syncPendingBanner(set, changeSet)
    }
  },

  async checkForUpdates() {
    set((current) => ({
      updateState: { ...current.updateState, phase: 'checking', message: null }
    }))
    const state = await window.vav.updates.check()
    set({ updateState: state })
  },

  async downloadUpdate() {
    const state = await window.vav.updates.openDownload()
    set({ updateState: state })
  },

  async installUpdate() {
    await window.vav.updates.install()
  },

  toggleSidebar() {
    set((state) => {
      const sidebarVisible = !state.sidebarVisible
      saveGlobalLayout({ sidebarVisible })
      return { sidebarVisible }
    })
  },

  setSidebarVisible(visible) {
    set((state) => {
      if (state.sidebarVisible === visible) return {}
      saveGlobalLayout({ sidebarVisible: visible })
      return { sidebarVisible: visible }
    })
  },

  setSidebarListMode(mode) {
    set({ sidebarListMode: mode })
  },

  toggleToolsPanel() {
    set((state) => {
      if (!state.activeId) return {}
      if (!state.toolsCollapsed) {
        return patchActiveTools(state, {
          toolsCollapsed: true,
          lastActiveSegment: state.panelSegment
        })
      }

      let segment = state.lastActiveSegment ?? state.panelSegment
      const tabs = useWorkspaceStore.getState().workspaces[state.activeId]?.tabs ?? []
      if (segment === 'terminal' && tabs.length === 0) segment = 'files'
      return patchActiveTools(state, {
        toolsCollapsed: false,
        panelSegment: segment,
        lastActiveSegment: segment
      })
    })
  },

  setToolsCollapsed(collapsed) {
    set((state) => {
      if (!state.activeId) return {}
      return collapsed
        ? patchActiveTools(state, {
            toolsCollapsed: true,
            lastActiveSegment: state.panelSegment
          })
        : patchActiveTools(state, { toolsCollapsed: false })
    })
  },

  setPanelSegment(segment) {
    set((state) => {
      if (!state.activeId) return {}
      return patchActiveTools(state, {
        panelSegment: segment,
        lastActiveSegment: segment,
        toolsCollapsed: false
      })
    })
  },

  setPanelSegmentQuiet(segment) {
    set((state) => {
      if (!state.activeId) return {}
      return patchActiveTools(state, {
        panelSegment: segment,
        lastActiveSegment: segment
      })
    })
  },

  togglePanelSegment() {
    get().setPanelSegment(get().panelSegment === 'files' ? 'terminal' : 'files')
  },

  focusBashTerminal() {
    const { activeId, toolsCollapsed, panelSegment } = get()
    if (!activeId) return
    const ws = useWorkspaceStore.getState()
    const tabs = (ws.workspaces[activeId]?.tabs ?? []).filter(
      (t) => !t.agentId || t.agentId === 'vav' || t.isAgent
    )
    const terminalOpen = !toolsCollapsed && panelSegment === 'terminal'

    // Toggle close when tray is already open on terminal with a bash session.
    if (terminalOpen && tabs.length > 0) {
      const host = document.querySelector(
        '.tools-body .xterm-helper-textarea'
      ) as HTMLTextAreaElement | null
      if (host && document.activeElement === host) {
        get().setToolsCollapsed(true)
        return
      }
    }

    get().setPanelSegment('terminal')
    if (tabs.length === 0) {
      void ws.newBash(activeId, 80, 24)
    }
    // Focus after layout paints.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const ta = document.querySelector(
          '.tools-body .xterm-helper-textarea'
        ) as HTMLTextAreaElement | null
        ta?.focus()
      })
    })
  },

  async installAgentInToolsTray(payload) {
    const cmd = payload.command.trim()
    if (!cmd && !payload.tabId) return
    let id = payload.conversationId?.trim() || get().activeId
    if (payload.conversationId && payload.conversationId !== get().activeId) {
      await get().selectConversation(payload.conversationId)
      id = payload.conversationId
    }
    if (!id) {
      await get().createConversation({ openIn: 'here' })
      id = get().activeId
    }
    if (!id) return
    get().setToolsCollapsed(false)
    get().setPanelSegment('terminal')
    const ws = useWorkspaceStore.getState()
    if (payload.tabId) {
      await ws.hydratePtyState(id)
      ws.selectTab(id, payload.tabId)
    } else {
      const name = payload.name?.trim() || payload.agentId?.trim() || 'CLI'
      const tabId = await ws.newBash(id, 80, 24, 'row', {
        title: tt('agents.installingNamed', { name }),
        purpose: 'install',
        installAgentId: payload.agentId?.trim() || undefined
      })
      if (!tabId) return
      window.setTimeout(() => {
        window.vav.pty.write(tabId, `${cmd}\r`)
      }, 280)
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const ta = document.querySelector(
          '.tools-body .xterm-helper-textarea'
        ) as HTMLTextAreaElement | null
        ta?.focus()
      })
    })
  },

  setPanelHeight(height) {
    const clamped = Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.round(height)))
    set((state) => {
      if (!state.activeId) return {}
      return patchActiveTools(state, { panelHeight: clamped })
    })
  },

  focusComposer(conversationId) {
    const id = conversationId?.trim() || get().activeId
    set((state) => ({
      composerFocusId: id || null,
      composerFocusTick: state.composerFocusTick + 1
    }))
  },

  focusCommentCard(refId: string) {
    set((state) => ({
      commentFocusId: refId,
      commentFocusTick: state.commentFocusTick + 1
    }))
  },

  setPreviewAgentForPath(path: string, conversationId: string) {
    const map = { ...get().previewAgentByPath, [path]: conversationId }
    set({ previewAgentByPath: map })
    savePreviewAgents(map)
  },

  openWorkspaceSwitcher() {
    const { activeId, settings } = get()
    if (swarmBlocksWorkdirSwitch(activeId, settings.swarmModeEnabled === true)) return
    set((state) => ({ workspaceMenuNonce: state.workspaceMenuNonce + 1 }))
  },

  openModelPicker() {
    set((state) => ({
      modelPickerConversationId: state.activeId || null,
      modelPickerMenuNonce: state.modelPickerMenuNonce + 1
    }))
  },

  openApprovalMenu() {
    set((state) => ({
      approvalConversationId: state.activeId || null,
      approvalMenuNonce: state.approvalMenuNonce + 1
    }))
  },

  applyTurnEvent(event) {
    const id = event.conversationId
    const projection = getProjection(id)

    switch (event.type) {
      case 'start': {
        projection.start()
        const started = get().conversations.find((c) => c.id === id)
        patchTurn(set, id, {
          isRunning: true,
          phase: 'thinking',
          toolCount: 0,
          awaitingToolCallId: null,
          startedModel: started?.model,
          startedCliHost: started?.cliHost ?? null,
          startedAccountId: started?.accountId ?? null
        })
        // New turn supersedes prior file-review cards (avoid stale "Could not load changes").
        set((state) => ({
          ...clearPriorChangeReviews(state, id),
          errorBanner: null,
          errorBannerKind: null,
          errorBannerDetail: null
        }))
        break
      }

      case 'user':
        // User message = next turn intent: drop previous review chrome immediately.
        set((state) => {
          const cleared = clearPriorChangeReviews(state, id)
          const baseMessages = cleared.messages ?? state.messages
          return {
            ...cleared,
            messages: {
              ...baseMessages,
              [id]: upsert(baseMessages[id], event.message)
            },
            activeLeaf: { ...state.activeLeaf, [id]: event.message.id }
          }
        })
        break

      case 'notice':
        // UI / workspace notice — no turn, but advances the leaf for history.
        set((state) => ({
          messages: {
            ...state.messages,
            [id]: upsert(state.messages[id], event.message)
          },
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
        // Keep StreamProjection phase in sync — StreamingMessage reads phase from
        // the projection, not the session store. Without this, a second approval
        // still shows "Outputting" and the live/awaiting chrome desyncs.
        projection.setPhase('awaiting-user')
        projection.upsertTool(event.index, event.block)
        patchTurn(set, id, { awaitingToolCallId: event.toolCallId, phase: 'awaiting-user' })
        break

      case 'mirror': {
        const workspace = useWorkspaceStore.getState()
        workspace.mirrorAgentTranscript(id, event.text)
        // Spec 9ed447d6…: tools panel does NOT auto-expand when the agent runs a
        // command. Output still lands in the PTY buffer; user opens tools manually.
        // Select the agent tab once — not on every mirror chunk (chip-row thrash).
        const slice = workspace.workspaces[id]
        if (slice?.tabs.some((tab) => tab.isAgent) && slice.activeTabId !== AGENT_TAB_ID) {
          workspace.selectTab(id, AGENT_TAB_ID)
        }
        break
      }

      case 'fs-changed':
        useWorkspaceStore.getState().agentDidWriteFile(id, event.parentPath, event.filePath)
        break

      case 'file-draft':
        // Preview windows listen on the raw agent event; no session state.
        break

      case 'cli-session':
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, acpSession: event.state } : c
          )
        }))
        break

      case 'usage':
        // Mid-turn usage must not remap `conversations` — that re-renders
        // SessionDetail / Transcript / Sidebar. Ring reads `liveUsage`.
        set((state) => {
          const prev = state.liveUsage[id]
          const tokenLimit =
            typeof event.tokenLimit === 'number' ? event.tokenLimit : prev?.tokenLimit
          const usageSame =
            prev?.tokensUsed === event.tokensUsed && prev?.tokenLimit === tokenLimit
          return {
            tokenHistories: { ...state.tokenHistories, [id]: event.history },
            cacheCreatedAt: { ...state.cacheCreatedAt, [id]: event.cacheCreatedAt },
            cacheExpiresAt: { ...state.cacheExpiresAt, [id]: event.cacheExpiresAt },
            liveUsage: usageSame
              ? state.liveUsage
              : {
                  ...state.liveUsage,
                  [id]: {
                    tokensUsed: event.tokensUsed,
                    ...(tokenLimit != null ? { tokenLimit } : {})
                  }
                }
          }
        })
        break

      case 'end': {
        projection.end()
        patchTurn(set, id, IDLE_TURN)
        set((state) => {
          const liveUsage = omitLiveUsage(state.liveUsage, id)
          const conversations = state.conversations.map((c) =>
            c.id === id ? { ...c, tokensUsed: event.tokensUsed } : c
          )
          // Store the sealed message when it has content, a review card, or a
          // turn error. (Write-only turns can land with tools + changeSetId
          // and must still upsert; error-only turns must stay on the leaf.)
          if (
            event.message.blocks.length === 0 &&
            !event.message.changeSetId &&
            !event.message.errorText &&
            !event.message.cancelled
          ) {
            return { conversations, liveUsage }
          }
          return {
            messages: { ...state.messages, [id]: upsert(state.messages[id], event.message) },
            activeLeaf: { ...state.activeLeaf, [id]: event.message.id },
            conversations,
            liveUsage
          }
        })
        // Main bumped updatedAt on append/replace — merge so order follows real activity.
        void window.vav.conversations.list().then((list) =>
          useSessionStore.setState((state) => ({
            conversations: mergeConversationList(state.conversations, list)
          }))
        )
        // Transcript already paints `errorText` on the assistant message.
        // Raising the top banner (and a JSON-RPC details sheet) just repeats it.
        if (
          event.error &&
          !event.cancelled &&
          event.errorKind !== 'cancelled' &&
          !event.message.errorText
        ) {
          set({
            errorBanner: event.error,
            errorBannerKind: event.errorKind ?? 'generic',
            errorBannerDetail: event.errorDetail || event.error
          })
        }
        // Auto-run the next queued message after this turn finishes (FIFO).
        void get().drainMessageQueue(id)
        break
      }

      case 'change-review': {
        // Inline review only — never full-screen (bypass already auto-accepted).
        // Seed changeSetsById synchronously when the event carries the full set so
        // InlineChangeReview never remounts into a perpetual "Loading changes…".
        set((state) => {
          const list = state.messages[id] ?? []
          const msgId = event.messageId
          let messages = state.messages
          if (msgId && list.some((m) => m.id === msgId)) {
            messages = {
              ...state.messages,
              [id]: list.map((m) =>
                m.id === msgId ? { ...m, changeSetId: event.changeSetId } : m
              )
            }
          } else if (msgId && !list.some((m) => m.id === msgId)) {
            // end may still be in flight relative to another window; nothing to attach.
          } else if (!msgId) {
            // Fallback: attach to latest assistant message on the active leaf path.
            const path = list.filter((m) => m.role === 'assistant')
            const last = path[path.length - 1]
            if (last) {
              messages = {
                ...state.messages,
                [id]: list.map((m) =>
                  m.id === last.id ? { ...m, changeSetId: event.changeSetId } : m
                )
              }
            }
          }
          const pendingNext = { ...state.pendingReviewByConversation }
          if (event.pendingCount > 0) {
            pendingNext[id] = { changeSetId: event.changeSetId, count: event.pendingCount }
          } else {
            delete pendingNext[id]
          }
          const seeded = event.changeSet
          const changeSetsById = seeded
            ? { ...state.changeSetsById, [seeded.id]: seeded }
            : state.changeSetsById
          return {
            messages,
            pendingReviewByConversation: pendingNext,
            changeSetsById,
            ...(seeded ? { changeSet: seeded } : {})
          }
        })
        // Fallback fetch only when the event did not embed the set.
        if (!event.changeSet) void get().openChangeReview(event.changeSetId)
        break
      }
    }
  }
}))

function syncPendingBanner(
  set: (partial: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void,
  changeSet: ChangeSet
): void {
  const pending = changeSet.files.filter((f) => f.status === 'pending').length
  set((state) => {
    const next = { ...state.pendingReviewByConversation }
    if (pending === 0) delete next[changeSet.conversationId]
    else next[changeSet.conversationId] = { changeSetId: changeSet.id, count: pending }
    return { pendingReviewByConversation: next }
  })
}

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
/** Shared empty search hits — never allocate a fresh [] on every keystroke. */
const EMPTY_SEARCH_MATCH_IDS: string[] = []

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
  // Preserve sticky fields if a later partial snapshot omits them (e.g. mid-turn
  // persist without changeSetId must not wipe a finished review card).
  return existing.map((m) => {
    if (m.id !== message.id) return m
    const merged: ChatMessage = { ...message }
    if (!merged.changeSetId && m.changeSetId) merged.changeSetId = m.changeSetId
    return merged
  })
}

/**
 * Drop inline Change Review cards for a conversation when the next turn starts.
 * Prior changeSetIds often cannot be re-fetched (in-memory store) and surface
 * as "Could not load changes" under Done — clean them off the transcript.
 */
function clearPriorChangeReviews(
  state: SessionState,
  conversationId: string
): Partial<SessionState> {
  const list = state.messages[conversationId]
  const dropIds = new Set(
    (list ?? []).map((m) => m.changeSetId).filter((x): x is string => !!x)
  )
  if (dropIds.size === 0 && !state.pendingReviewByConversation[conversationId]) {
    return {}
  }

  const messages = list
    ? {
        ...state.messages,
        [conversationId]: list.map((m) =>
          m.changeSetId ? { ...m, changeSetId: undefined } : m
        )
      }
    : state.messages

  const changeSetsById = { ...state.changeSetsById }
  for (const cid of dropIds) delete changeSetsById[cid]

  const pendingReviewByConversation = { ...state.pendingReviewByConversation }
  delete pendingReviewByConversation[conversationId]

  return {
    messages,
    changeSetsById,
    pendingReviewByConversation,
    changeSet: state.changeSet && dropIds.has(state.changeSet.id) ? null : state.changeSet,
    changeReviewId:
      state.changeReviewId && dropIds.has(state.changeReviewId) ? null : state.changeReviewId
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

const WORKSPACE_AGENT_KEY = 'vav.workspaceAgentByPath'
const PREVIEW_AGENT_KEY = 'vav.previewAgentByPath'

function loadWorkspaceAgents(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WORKSPACE_AGENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveWorkspaceAgents(map: Record<string, string>): void {
  try {
    localStorage.setItem(WORKSPACE_AGENT_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

function loadPreviewAgents(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PREVIEW_AGENT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function savePreviewAgents(map: Record<string, string>): void {
  try {
    localStorage.setItem(PREVIEW_AGENT_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

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

const noopOff = (): (() => void) => () => undefined

/** Wires main-process turn events into the store. Called once at startup. */
export function installTurnEventBridge(): () => void {
  const onEvent = window.vav?.agent?.onEvent
  if (!onEvent) return noopOff()
  return onEvent((event) => useSessionStore.getState().applyTurnEvent(event))
}

export function installHostsBridge(): () => void {
  const onChanged = window.vav?.hosts?.onChanged
  if (!onChanged) return noopOff()
  return onChanged((hosts) => useSessionStore.setState({ hosts }))
}

/** Mirrors the phone-companion tunnel status (connected devices) into the store. */
export function installRemoteControlBridge(): () => void {
  const api = window.vav?.remoteControl
  if (!api) return noopOff()
  void api
    .status()
    .then((status) => useSessionStore.setState({ remoteControlStatus: status }))
    .catch(() => {})
  return api.onChanged((status) => useSessionStore.setState({ remoteControlStatus: status }))
}

/** Keeps every window's copy of the settings in step. Called once per window. */
export function installSettingsBridge(): () => void {
  const onChanged = window.vav?.onSettingsChanged
  if (!onChanged) return noopOff()
  return onChanged((settings) =>
    useSessionStore.setState({
      settings,
      resolvedLocale: resolveLocale(settings.locale, navigator.language)
    })
  )
}

/** Compact from the token-usage popup (or another window) lands here. */
export function installCompactionsBridge(): () => void {
  const onChanged = window.vav?.agent?.onCompactionsChanged
  if (!onChanged) return noopOff()
  return onChanged(({ conversationId, compactions }) => {
    const active = compactionForLeaf(
      compactions,
      useSessionStore.getState().messages[conversationId] ?? [],
      useSessionStore.getState().activeLeaf[conversationId] ?? null
    )
    useSessionStore.setState((state) => ({
      compactions: { ...state.compactions, [conversationId]: compactions },
      liveUsage: omitLiveUsage(state.liveUsage, conversationId),
      conversations: state.conversations.map((c) => {
        if (c.id !== conversationId) return c
        if (active?.estimatedContextTokens) {
          return { ...c, tokensUsed: active.estimatedContextTokens }
        }
        // Cleared: fall back to last provider-reported input size if we have it.
        const latest = state.tokenHistories[conversationId]?.at(-1)?.totalInputTokens
        if (latest && latest > 0) return { ...c, tokensUsed: latest }
        return c
      })
    }))
  })
}

/**
 * Keeps every window's conversation list in step.
 *
 * The same conversation can be renamed, pinned or created from another window,
 * so no window may treat its own copy of the list as authoritative.
 */
export function installWindowBridge(): () => void {
  const onChanged = window.vav?.conversations?.onChanged
  if (!onChanged) return noopOff()
  return onChanged((list) => {
    // Preserve hydrated file-preview sessions; only reshuffle when recency changed.
    useSessionStore.setState((state) => ({
      conversations: mergeConversationList(state.conversations, list)
    }))
  })
}

export function installActivityBridge(): () => void {
  const onActivity = window.vav?.conversations?.onActivity
  if (!onActivity) return noopOff()
  return onActivity((rows) => {
    const activityById: Record<string, 'running' | 'done'> = {}
    for (const row of rows) activityById[row.conversationId] = row.status
    useSessionStore.setState({ activityById })
  })
}

/**
 * Tracks which conversations have a companion window so the main shell can
 * release its live agent terminal (one PTY → one geometry).
 */
export function installDetachedBridge(): () => void {
  const api = window.vav?.window
  if (!api) return noopOff()
  const apply = (ids: string[]): void => {
    const previous = useSessionStore.getState().detachedConversationIds
    // Reveal immediately — a delayed write can lose a newer publish
    // (close A in-flight, then detach B → stale `[]` wipes B).
    useSessionStore.setState({ detachedConversationIds: ids })
    const next = new Set(ids)
    for (const id of previous) {
      if (next.has(id)) continue
      if (!useWorkspaceStore.getState().workspaces[id]) continue
      void useWorkspaceStore.getState().hydratePtyState(id, { acceptRemoteSurface: true })
    }
  }
  // Initial hydrate (main may boot after companions already exist).
  if (typeof api.listDetachedSessions === 'function') {
    void api.listDetachedSessions().then(apply).catch(() => apply([]))
  }
  if (typeof api.onDetachedChanged !== 'function') {
    return noopOff()
  }
  return api.onDetachedChanged(apply)
}

/** Keeps the composer agent/model picker in sync with background CLI probes. */
export function installAgentModelCatalogBridge(): () => void {
  const onChanged = window.vav?.agents?.onModelCatalogChanged
  if (!onChanged) return noopOff()
  return onChanged((catalog) => {
    useSessionStore.getState().setAgentModelCatalog(catalog)
  })
}

/** Keeps toolbar / About update UI in step with the main-process checker. */
export function installUpdateBridge(): () => void {
  const onChanged = window.vav?.updates?.onChanged
  if (!onChanged) return noopOff()
  return onChanged((updateState) => {
    useSessionStore.setState({ updateState })
  })
}
