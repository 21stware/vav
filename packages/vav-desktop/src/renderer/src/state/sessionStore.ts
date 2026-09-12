import { create } from 'zustand'
import type {
  AboutInfo,
  AppLocale,
  AppSettings,
  ChatMessage,
  ConversationMeta,
  PreviewRef,
  QuoteDraft,
  TerminalSplitAxis,
  TokenSnapshot,
  TurnErrorKind
} from '@shared/types'
import type { SqliteDatabaseInfo } from '@shared/ipc'
import { DEFAULT_CLI_AGENTS, DEFAULT_SETTINGS } from '@shared/types'
import type { WorkspaceHostInfo } from '@shared/workspaceHost'
import type { IncomingController } from '@shared/daemonProtocol'
import type { RemoteControlStatus } from '@shared/remoteControl'
import { mergeConversationList, nextConversationSelection, isArchivedConversation, regenerateActiveLeaf, canMutateActiveSession, compactRefusalReason, genericErrorBanner, patchConversationById, shouldSkipSessionDeleteConfirm, fallbackConversationIdAfterDelete, sessionDeleteDialogCopy, prependConversationIfMissing, listedConversationIdsForSelect, fileSessionHydrateOnDemandPatch, fileSessionHintToMeta, deleteMessageHydratePatch, renameConversationPatch, rememberDroppedConversationIds, isDroppedConversationId, type FileSessionSelectHint } from './sessionListMerge'
import {
  activeToolsFields,
  collapsedFileSessionTools,
  DEFAULT_SESSION_TOOLS,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  loadGlobalLayout,
  loadSessionToolsMap,
  patchActiveTools,
  saveGlobalLayout,
  saveSessionToolsMap,
  toolsFor,
  type SessionToolsLayout
} from './sessionLayout'
import {
  type AgentModelCatalogEntry,
  type DialogState,
  type LiveUsage,
  type QueuedMessage,
  type SearchState,
  type SessionPreview,
  type SettingsCategory,
  type SidebarListMode,
  type ToastState,
  type TurnRuntime,
} from './sessionTypes'
import { conversationIdAwaitingTool, hostHoldsControlPlaneKeys, turnRuntimeFromAgentStatus, compactionSucceededPatch, refreshTokenUsagePatch, clearCompactionPatch, conversationStatusPatch } from './sessionUsage'
import { dispatchQueuedPayload, MESSAGE_QUEUE_MAX, buildQueuedMessage, composerSendDisposition, composerClearedPatch, enqueueQueuedMessagePatch, updateQueuedMessagePatch, removeQueuedMessagePatch, isEmptyComposerSend, mergeComposerFilePaths, mergePreviewAndCommentRefs, pollUntil, resolveComposerContextFile, shouldDrainMessageQueue } from './sessionQueue'
import { applyCliHostSetResult } from './sessionCliHost'
import { applySessionTurnEvent } from './sessionTurnApply'
import {
  searchStateForQuery,
  stepSearchState
} from './sessionSearch'
import {
  acceptAllChangesFor as acceptAllChangesForReview,
  acceptChangeFilesFor as acceptChangeFilesForReview,
  activeChangeSetId,
  applyChangeEdit as applyChangeEditReview,
  closeChangeReview as closeChangeReviewState,
  openChangeReview as openChangeReviewState,
  refreshChangeSet as refreshChangeSetState,
  rejectAllChangesFor as rejectAllChangesForReview,
  rejectChangeFilesFor as rejectChangeFilesForReview,
  undoChangeFileFor as undoChangeFileForReview
} from './sessionChangeReview'
import {
  loadPreviewAgents,
  loadWorkspaceAgents,
  savePreviewAgents,
  saveWorkspaceAgents
} from './sessionAgentPaths'
import {
  clearCommentCardsMap,
  removeCommentCardFromMap,
  setCommentCardsMap,
  updateCommentCardInMap
} from './sessionCommentCards'

export {
  DEFAULT_SESSION_TOOLS,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  PANEL_SNAP_RATIO,
  type SessionToolsLayout
} from './sessionLayout'

export type {
  AgentModelCatalogEntry,
  DialogState,
  LiveUsage,
  QueuedMessage,
  SearchState,
  SessionPreview,
  SettingsCategory,
  SidebarListMode,
  ToastState,
  TurnRuntime
} from './sessionTypes'

export { MESSAGE_QUEUE_MAX }
import type { ChangeSet, UpdateState } from '@shared/changeSet'
import { resolveLocale } from '@shared/i18n'
import {
  imageInputLimits,
  mergeImageAttachments
} from '@shared/agentImageInput'
import { tt } from '../i18n/useT'
import { isDraftScheduledTitle } from '../lib/draftEditorTitle'
import { isTemporaryWorkspace } from '../lib/format'
import { conversationFitsListMode, nextConversationForListMode } from '../lib/sidebarList'
import { isTimerDefinition } from '@shared/sessionKind'
import { isCompanionSessionShell, isMainSessionShell, readWindowMachineId } from '../lib/windowKind'
import { isLocalMachine, normalizeMachineId } from '@shared/workspaceHost'
import { compactionForLeaf } from '@shared/compaction'
import { userBashTabsOnly } from '../lib/workspacePty'
import { bashGroupChips } from '../lib/bashTabGroups'
import { getProjection, disposeProjection } from './StreamProjection'
import { useWorkspaceStore } from './workspaceStore'
import {
  conversationHydrationRefreshPatch,
  conversationFullHydratePatch,
  isCurrentHydration,
  nextHydrationGeneration,
  omitConversationCachePatch,
  omitKeys,
  omitMappedKeys,
  SESSION_DELETE_MAPPED_KEYS
} from '../lib/messageHydration'
import { deleteMessageFollowCount, visibleMessages } from './sessionThread'
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
import { inheritCreateWorkingDirectory, nextConversationForMachine, nextFileCategoryForMachine, pickBootstrapActiveId, seedCliAgentCatalogue, seedEmptyConversationPatch, shouldSpawnDetachedConversation, claimDetachedSessionPatch } from './sessionBootstrap'
import { notifyImageAttachPlan, trimAttachmentPathsForHost } from './sessionAttach'
import { persistSwarmLayout, setLeaf } from './sessionSwarm'
import { swarmBlocksWorkdirSwitch as swarmSurfaceBlocksWorkdir } from '../lib/workdirSwitch'
import { nextFavoriteIds, nextPinnedWorkspaceDirs, setArchivedConversationPatch } from './sessionPins'
import { chatHostPickerModels, coercedChatHostModel, defaultModelSettingsPatch, defaultThinkingSettingsPatch, nextSteppedModelId } from './sessionModels'

function swarmBlocksWorkdirSwitch(
  id: string | null | undefined,
  swarmEnabled: boolean,
  archived?: boolean
): boolean {
  if (archived) return true
  return swarmSurfaceBlocksWorkdir(
    id,
    swarmEnabled,
    !!(id && useWorkspaceStore.getState().workspaces[id]?.cliMode)
  )
}

function trimAttachmentsForHost(
  id: string,
  host: ConversationMeta['cliHost'],
  get: () => SessionState,
  set: (partial: Partial<SessionState> | ((state: SessionState) => Partial<SessionState>)) => void
): void {
  const trimmed = trimAttachmentPathsForHost(get().attachments[id] ?? [], host)
  if (!trimmed) return
  set((state) => ({ attachments: { ...state.attachments, [id]: trimmed.paths } }))
  notifyImageAttachPlan(get().showToast, trimmed.plan, tt)
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
 * Conversations currently inside {@link SessionState.sendQueuedNow} (manual
 * interrupt path). Suppresses auto-drain on the interim `end` from cancel so
 * we do not pop the *next* queue item while "send now" is still running.
 */
const queueSendInFlight = new Set<string>()

interface SessionState {
  sidebarVisible: boolean
  /**
   * Which list the sidebar is showing. Shared so Reveal / open-in-main can
   * jump to File sessions without local Sidebar state.
   */
  sidebarListMode: SidebarListMode
  /**
   * File category main pane: Recent files vs This Mac. Survives opening a
   * file so Back to file list can restore the same source.
   */
  filesSource: 'recent' | 'thisMac'
  /** Selected table inside the active database session. Null = connection info. */
  activeDbTable: string | null
  /** Cached live-DB schema by connection id. */
  dbSchemas: Record<string, SqliteDatabaseInfo | { error: string }>
  setActiveDbTable(table: string | null): void
  setDbSchema(connectionId: string, info: SqliteDatabaseInfo | { error: string }): void
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
  incomingControllers: IncomingController[]
  /**
   * Machine the sidebar is showing (`local` or a paired daemon).
   * Switching stays in this window — no extra host shell.
   */
  windowMachineId: string
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
  activityById: Record<string, 'pending' | 'running' | 'done' | 'failed'>
  sidebarQuery: string
  /** Request focus on the always-visible list search field (not persisted). */
  sidebarSearchOpen: boolean
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
   * Leftover open-file context path. New adds go through composer attachments
   * (right-click / drag). Null = dismissed or none — preview/selection may
   * still show the file; only this context slot is cleared.
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
  errorBannerKind: TurnErrorKind | null
  errorBannerDetail: string | null
  dialog: DialogState | null
  toast: ToastState | null
  settingsCategory: SettingsCategory
  /** Settings → Providers: select this row when the window opens. */
  settingsFocusAgentId: string | null
  /** Settings → Appearance: select this vav-server instance when the window opens. */
  settingsFocusMachineId: string | null
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
      /**
       * File-category click: seed fileId so FileSessionView mounts even when
       * conversations.get misses (body lives on spawned vav-server).
       */
      fileSession?: FileSessionSelectHint
      /** Database category: open this table, or null for connection info. */
      dbTable?: string | null
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
  /** New scheduled task: mint the group, select it, then edit in the form. */
  createScheduledConversation(): Promise<void>
  /**
   * Scheduled category: keep the selected group or run. Empty list stays empty.
   */
  ensureScheduledConversation(): void
  /** New database connection: mint the row, select it, then edit in the form. */
  createDbConversation(): Promise<void>
  /** DB category: keep a connection selected. Empty list stays empty. */
  ensureDbConversation(): void
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
  remoteFolderPick: {
    conversationId: string
    machineId: string
    purpose?: 'workdir' | 'locate' | 'directory'
  } | null
  openRemoteFolderPicker(
    conversationId: string,
    machineId: string,
    purpose?: 'workdir' | 'locate' | 'directory'
  ): void
  closeRemoteFolderPicker(): void
  applyRemoteFolderPick(result: {
    conversationId: string
    machineId: string
    purpose: 'workdir' | 'locate' | 'directory'
    path: string | null
  }): Promise<void>
  /** Move a Temporary workspace so the chosen folder contains `Workspace`. */
  locateWorkspace(id: string): Promise<void>
  finishLocateWorkspace(id: string, destinationDir: string): Promise<void>
  setSidebarQuery(query: string): void
  openSidebarSearch(): void
  closeSidebarSearch(): void
  toggleSidebarSearch(): void
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
  applyAcpGoal(
    id: string,
    action: 'set' | 'pause' | 'resume' | 'clear',
    objective?: string
  ): Promise<void>
  /** Workspace preview focus — built-in VAV agent system / open-file context. */
  setFocusedFile(id: string, path: string | null): Promise<void>
  /** Live-DB table focus — built-in VAV agent system context. */
  setFocusedDbTable(id: string, table: string | null): Promise<void>
  /**
   * Attach (or replace) leftover open-file context for a conversation.
   * Syncs focusedFilePath for the built-in agent. Does not paste into CLI TUIs.
   * Pass null to clear without touching tree selection / preview window.
   */
  attachContextFile(id: string, path: string | null): Promise<void>
  /** Dismiss leftover open-file context — does not close the file preview or deselect. */
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
  answerSecrets(
    toolCallId: string,
    payload: import('@shared/types').SecretAnswerPayload
  ): Promise<boolean>
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
  /** Dock / tray / hotkey raise this daemon’s window. */
  setDefaultMachine(machineId: string): Promise<void>
  /** Switch the sidebar to another vav-server without opening a window. */
  switchMachine(machineId: string): Promise<void>
  refreshApiKeyHint(): Promise<void>
  resetSettings(): Promise<void>
  openSettings(category?: SettingsCategory, agentId?: string, machineId?: string): void
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
  cancelUpdateDownload(): Promise<void>
  installUpdate(): Promise<void>

  toggleSidebar(): void
  setSidebarVisible(visible: boolean): void
  setSidebarListMode(mode: SidebarListMode): void
  setFilesSource(source: 'recent' | 'thisMac'): void
  /** Leave the file canvas and show Recent files / This Mac again. */
  showFileList(): void
  /** Switch Task / File / Scheduled / Archived and clear the list search. */
  activateSidebarListMode(mode: SidebarListMode): void
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
const hydrationGen = new Map<string, number>()
export const useSessionStore = create<SessionState>((set, get) => ({
  sidebarVisible: globalLayout.sidebarVisible,
  sidebarListMode: 'main',
  filesSource: 'recent',
  activeDbTable: null,
  dbSchemas: {},
  toolsLayouts: sessionToolsLayouts,
  // Until a conversation is selected, show the default (collapsed) tray.
  ...activeToolsFields(DEFAULT_SESSION_TOOLS),
  ready: false,
  home: '',
  tmp: '',
  hosts: [],
  incomingControllers: [],
  windowMachineId: readWindowMachineId(),
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
  activityById: {} as Record<string, 'pending' | 'running' | 'done' | 'failed'>,
  sidebarQuery: '',
  sidebarSearchOpen: false,
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
  settingsFocusMachineId: null,
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
    const windowMachineId = normalizeMachineId(
      (await window.vav.hosts.active?.().catch(() => null)) || readWindowMachineId()
    )
    let nextActiveId = activeId
    if (!light && !pinnedConversationId) {
      nextActiveId = pickBootstrapActiveId(data.conversations, nextActiveId, windowMachineId)
    }
    const updateState = await window.vav.updates.getState().catch(() => IDLE_UPDATE)

    // Legacy settings.json often had cliAgents: [] — never surface an empty catalogue.
    const settings = data.settings
    if (seedCliAgentCatalogue(settings, DEFAULT_CLI_AGENTS).persistCliAgents) {
      void window.vav.settings.update({ cliAgents: settings.cliAgents }).catch(() => undefined)
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
      activeId: light && !pinnedConversationId ? '' : nextActiveId,
      selectedIds: light && !pinnedConversationId ? [] : nextActiveId ? [nextActiveId] : [],
      pinnedConversationId: pinnedConversationId ?? null,
      home: data.home,
      tmp: data.tmp,
      hosts: data.hosts,
      windowMachineId,
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
    // Bind files to a session that lives on this window's machine — never a
    // hidden local conversation that the sidebar already filtered out.
    if (!light) {
      await syncActiveConversationToMachine()
      const id = get().activeId
      if (id) await get().selectConversation(id)
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
      return claimDetachedSessionPatch(state, meta, {
        knownEmpty,
        prevMessages,
        toolsLayouts,
        activeTools: activeToolsFields(nextTools)
      })
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
            [meta.id]: turnRuntimeFromAgentStatus(status)
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
      (c) =>
        !c.archived &&
        !c.fileId &&
        c.sessionKind !== 'timer' &&
        c.sessionKind !== 'db' &&
        c.workingDirectory === workdir
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
    if (isDroppedConversationId(id)) return
    let target = conversations.find((c) => c.id === id)
    // File-preview sessions are hidden from listMeta. Seed chrome from the
    // sidebar row first so FileSessionView can mount before / without get().
    if (!target && options?.fileSession?.fileId) {
      const seed = fileSessionHintToMeta(id, options.fileSession)
      set((state) => ({
        conversations: prependConversationIfMissing(state.conversations, seed)
      }))
      target = seed
    }
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
      set((state) =>
        fileSessionHydrateOnDemandPatch(state, id, {
          meta,
          messages,
          activeLeafId,
          compactions,
          tokenHistory,
          cacheExpiresAt
        })
      )
      void cacheCreatedAt
      target = meta
    }
    let nextSelection = nextConversationSelection({
      id,
      selectedIds,
      activeId,
      additive: options?.additive,
      range: options?.range,
      rangeIds: options?.rangeIds,
      listedIds: listedConversationIdsForSelect(conversations, target?.archived)
    })

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
      sessionTools = collapsedFileSessionTools(sessionTools)
      toolsLayoutsPatch = { ...get().toolsLayouts, [id]: sessionTools }
      saveSessionToolsMap(toolsLayoutsPatch)
    }
    // Paint the new session immediately — hydrate in parallel below.
    const nextDbTable =
      options && 'dbTable' in options
        ? (options.dbTable ?? null)
        : id === activeId
          ? get().activeDbTable
          : (target?.focusedDbTable ?? null)
    set({
      activeId: id,
      selectedIds: nextSelection,
      activeGroupId: null,
      activeDbTable: nextDbTable,
      sessionPreview: { kind: 'file' },
      ...(toolsLayoutsPatch ? { toolsLayouts: toolsLayoutsPatch } : {}),
      ...activeToolsFields(sessionTools)
    })

    const conversation = get().conversations.find((c) => c.id === id)
    if ((conversation?.focusedDbTable ?? null) !== nextDbTable) {
      void get().setFocusedDbTable(id, nextDbTable)
    }
    const cached = !!get().messages[id]
    const applyStatus = (status: Awaited<ReturnType<typeof window.vav.agent.status>>): void => {
      if (get().activeId !== id) return
      set((state) => conversationStatusPatch(state, id, status))
      if (status.isRunning) {
        const projection = getProjection(id)
        // Events may have already primed this window while status was in flight;
        // only hydrate when we still have no live view.
        if (!projection.getSnapshot().active) {
          projection.hydrate(status.phase, status.blocks, status.recovery)
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
        set((state) => conversationHydrationRefreshPatch(state, id, conversation))
      })
      return
    }

    const gen = nextHydrationGeneration(hydrationGen, id)
    const conversation = await window.vav.conversations.get(id)
    if (!conversation) return
    if (!isCurrentHydration(hydrationGen, id, gen)) return
    set((state) => conversationFullHydratePatch(state, id, conversation))
  },

  async refreshTokenUsage(id) {
    const target = id ?? get().activeId
    if (!target) return
    const conversation = await window.vav.conversations.get(target)
    if (!conversation) return
    set((state) => refreshTokenUsagePatch(state, target, conversation))
  },

  async createConversation(options) {
    // Prefer explicit opts; else inherit active session workdir (session is the unit).
    // Never inherit a path from another machine — that folder is not on this daemon.
    const activeMachine = normalizeMachineId(
      options?.machineId ?? get().windowMachineId
    )
    let createOpts = { ...options, machineId: activeMachine }
    if (createOpts.workingDirectory === undefined) {
      const inherited = inheritCreateWorkingDirectory({
        active: get().conversations.find((c) => c.id === get().activeId),
        activeMachine,
        isTemporary: (path) => isTemporaryWorkspace(path, get().tmp)
      })
      if (inherited) {
        createOpts = { ...createOpts, workingDirectory: inherited }
      }
    }
    const meta = await window.vav.conversations.create(createOpts)
    if (options?.openIn === 'none') {
      set((state) => seedEmptyConversationPatch(state, meta))
      return meta.id
    }
    // Main publishes the full list on create; `onChanged` may already have
    // applied it by the time we get here. Prepending unconditionally would
    // put the same id in the sidebar twice (⌘N made that obvious).
    set((state) => seedEmptyConversationPatch(state, meta))

    // Companion windows are bound to one conversation (native map + local
    // SessionWindow id). Selecting here replaces the chrome but not the
    // binding — send works, the transcript never updates. Open a new window.
    const spawnDetached = shouldSpawnDetachedConversation(
      options?.openIn,
      isCompanionSessionShell() && Boolean(get().pinnedConversationId)
    )
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

  async createScheduledConversation() {
    if (!window.vav?.timers?.createScheduled) return
    set({ sidebarListMode: 'timers' })
    try {
      const result = await window.vav.timers.createScheduled()
      set((state) => ({
        ...seedEmptyConversationPatch(state, result.conversation),
        sidebarListMode: 'timers'
      }))
      await get().selectConversation(result.conversation.id)
      get().focusComposer()
    } catch (err) {
      get().showToast({
        kind: 'error',
        title: tt('timer.createFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  },

  ensureScheduledConversation() {
    const { conversations, activeId, windowMachineId } = get()
    const machineId = normalizeMachineId(windowMachineId)
    const current = conversations.find((row) => row.id === activeId)
    if (current && conversationFitsListMode(current, 'timers')) return
    const nextId = nextConversationForListMode(conversations, 'timers', activeId, machineId)
    if (nextId && nextId !== activeId) void get().selectConversation(nextId)
  },

  async createDbConversation() {
    if (!window.vav?.db?.create) return
    set({ sidebarListMode: 'databases', activeDbTable: null })
    try {
      const result = await window.vav.db.create()
      set((state) => ({
        ...seedEmptyConversationPatch(state, result.conversation),
        sidebarListMode: 'databases',
        activeDbTable: null
      }))
      await get().selectConversation(result.conversation.id)
    } catch (err) {
      get().showToast({
        kind: 'error',
        title: tt('db.createFailed'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  },

  setActiveDbTable(table) {
    const next = table?.trim() || null
    if (get().activeDbTable === next) return
    set({ activeDbTable: next })
    const id = get().activeId
    if (id) void get().setFocusedDbTable(id, next)
  },

  setDbSchema(connectionId, info) {
    const id = connectionId.trim()
    if (!id) return
    set((state) => ({ dbSchemas: { ...state.dbSchemas, [id]: info } }))
  },

  ensureDbConversation() {
    const { conversations, activeId, windowMachineId } = get()
    const machineId = normalizeMachineId(windowMachineId)
    const current = conversations.find((row) => row.id === activeId)
    if (current && conversationFitsListMode(current, 'databases')) return
    const nextId = nextConversationForListMode(conversations, 'databases', activeId, machineId)
    if (nextId && nextId !== activeId) void get().selectConversation(nextId)
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
      conversations: prependConversationIfMissing(state.conversations, meta)
    }))
    // Drop any stale cache so selectConversation reloads the deep-copied tree.
    set((state) => omitConversationCachePatch(state, meta.id))
    await get().selectConversation(meta.id)
    get().focusComposer()
  },

  async openWorkspaceInMainPanel(workdir) {
    const path = workdir.trim()
    if (!path) return
    const activeId = get().activeId
    const msgs = activeId ? (get().messages[activeId] ?? []) : []
    const machineId = get().windowMachineId
    set({ activeGroupId: null })
    if (activeId && msgs.length > 0) {
      await get().duplicateConversation(activeId)
    } else {
      await get().createConversation({ workingDirectory: path, machineId, openIn: 'here' })
    }
    get().focusComposer()
  },

  async renameConversation(id, title) {
    const conversations = await window.vav.conversations.rename(id, title)
    set((state) => renameConversationPatch(state, conversations))
    const row = get().conversations.find((item) => item.id === id)
    if (isTimerDefinition(row ?? {}) && row?.timerJobId && window.vav?.timers?.updateJob) {
      void window.vav.timers.updateJob(row.timerJobId, { title })
    }
    if (row?.sessionKind === 'db' && row.dbConnectionId && window.vav?.db?.update) {
      void window.vav.db.update(row.dbConnectionId, { title })
    }
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
        const jobIds = new Set<string>()
        const dbIds = new Set<string>()
        for (const id of toRemove) {
          const row = get().conversations.find((item) => item.id === id)
          if (row?.timerJobId) jobIds.add(row.timerJobId)
          if (row?.dbConnectionId) dbIds.add(row.dbConnectionId)
          if (window.vav?.timers?.getJobForConversation) {
            try {
              const job = await window.vav.timers.getJobForConversation(id)
              if (job) jobIds.add(job.id)
            } catch {
              // Job lookup is best-effort; conversation remove still proceeds.
            }
          }
          if (window.vav?.db?.getForConversation) {
            try {
              const connection = await window.vav.db.getForConversation(id)
              if (connection) dbIds.add(connection.id)
            } catch {
              // Connection lookup is best-effort.
            }
          }
        }
        if (window.vav?.timers?.removeJob) {
          for (const jobId of jobIds) {
            try {
              const ok = await window.vav.timers.removeJob(jobId)
              if (ok === false) {
                get().showToast({ kind: 'error', title: tt('timer.deleteFailed') })
              }
            } catch (err) {
              get().showToast({
                kind: 'error',
                title: tt('timer.deleteFailed'),
                description: err instanceof Error ? err.message : String(err)
              })
            }
          }
        }
        if (window.vav?.db?.remove) {
          for (const connectionId of dbIds) {
            try {
              await window.vav.db.remove(connectionId)
            } catch {
              // Connection may already be gone.
            }
          }
        }
        const runIds = get()
          .conversations.filter(
            (row) =>
              row.sessionKind === 'timer' &&
              !!row.timerRunId &&
              !!row.timerJobId &&
              jobIds.has(row.timerJobId)
          )
          .map((row) => row.id)
        const departing = [...toRemove, ...runIds]
        rememberDroppedConversationIds(departing)
        let removed = departing
        let next = get().conversations.filter((row) => !departing.includes(row.id))
        try {
          const result = await window.vav.conversations.remove(departing)
          removed = result.removed.length > 0 ? result.removed : departing
          next = result.conversations
        } catch (err) {
          get().showToast({
            kind: 'error',
            title: tt('dialog.deleteSession'),
            description: err instanceof Error ? err.message : String(err)
          })
          return
        }
        rememberDroppedConversationIds(removed)
        for (const id of departing) {
          disposeProjection(id)
          useWorkspaceStore.getState().disposeConversation(id)
        }
        const departingSet = new Set(departing)
        set((state) => {
          for (const id of departing) hydrationGen.delete(id)
          const toolsLayouts = omitKeys(state.toolsLayouts, departing)
          saveSessionToolsMap(toolsLayouts)
          return {
            conversations: mergeConversationList(
              state.conversations.filter((row) => !departingSet.has(row.id)),
              next
            ),
            toolsLayouts,
            ...omitMappedKeys(state, SESSION_DELETE_MAPPED_KEYS, departing)
          }
        })
        if (departingSet.has(get().activeId)) {
          const fallback =
            get().sidebarListMode === 'timers'
              ? next.find(
                  (c) =>
                    c.sessionKind === 'timer' &&
                    !c.archived &&
                    !c.timerRunId &&
                    !departingSet.has(c.id) &&
                    !isDraftScheduledTitle(c.title, tt('timer.untitled'))
                )?.id ??
                next.find((c) => c.sessionKind === 'timer' && !c.archived && !departingSet.has(c.id))
                  ?.id ??
                null
              : get().sidebarListMode === 'databases'
                ? next.find((c) => c.sessionKind === 'db' && !c.archived && !departingSet.has(c.id))
                  ?.id ?? fallbackConversationIdAfterDelete(next.filter((c) => !departingSet.has(c.id)))
                : fallbackConversationIdAfterDelete(next.filter((c) => !departingSet.has(c.id)))
          if (fallback) await get().selectConversation(fallback)
          else {
            set({
              activeId: '',
              selectedIds: [],
              activeGroupId: null
            })
          }
        }
      }

      // A lone empty chat can go without a sheet. Multi-select always confirms
      // — even if every target is empty — so Backspace on a range is reversible.
      if (shouldSkipSessionDeleteConfirm(targets.length, empty.length)) {
        await applyRemove(empty)
        return
      }

      const { title, body } = sessionDeleteDialogCopy(targets, conversations, tt)

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
    const ws = useWorkspaceStore.getState().workspaces[activeId]
    const bashTabs = userBashTabsOnly(ws?.tabs ?? [])
    const chips = bashGroupChips(bashTabs, ws?.bashGroups ?? null, ws?.layout ?? null)
    const chip = chips[slot - 2]
    if (!chip) return
    useWorkspaceStore.getState().selectBashGroup(activeId, chip.groupId)
    const tabId = chip.tabIds[0]
    if (tabId) useWorkspaceStore.getState().selectTab(activeId, tabId)
    get().setPanelSegment('terminal')
  },

  async setModel(id, model) {
    // Optimistic update so the picker reflects the choice immediately (and so
    // file-preview sessions, which are omitted from listMeta, stay in the store).
    set((state) => ({
      conversations: patchConversationById(state.conversations, id, { model })
    }))
    try {
      const list = await window.vav.conversations.setModel(id, model)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
      const host = get().conversations.find((c) => c.id === id)?.cliHost ?? null
      const settings = get().settings
      const defaults = defaultModelSettingsPatch(host, model, settings)
      if (defaults) void get().updateSettings(defaults)
    } catch (err) {
      console.error('[setModel] failed', err)
    }
  },

  async stepModel(id, delta) {
    const conv = get().conversations.find((c) => c.id === id)
    if (!conv) return

    const { settings, agentModelCatalog } = get()
    const { vendorId, list } = chatHostPickerModels({
      cliHost: conv.cliHost,
      accountId: conv.accountId,
      catalog: agentModelCatalog,
      customModels: settings.customModels,
      defaultModel: settings.defaultModel,
      disabledAgentModels: settings.disabledAgentModels,
      apiEndpoint: settings.apiEndpoint
    })
    if (list.length <= 1) return

    const activeModel = coercedChatHostModel({
      host: conv.cliHost,
      currentModel: conv.model,
      customModels: settings.customModels,
      vavDefaultModel: settings.defaultModel,
      defaultAgentModels: settings.defaultAgentModels,
      catalogue: list,
      vendorId
    })

    const nextModel = nextSteppedModelId(list, activeModel, delta)
    if (!nextModel) return
    await get().setModel(id, nextModel)
  },

  async setAgentBinaryName(id, agentBinaryName) {
    // Optimistic first — file-preview sessions never appear in listMeta, so a
    // raw `set({ conversations: list })` would drop them and snap the switcher
    // back to vav (single-file window agent switch looked broken).
    set((state) => ({
      conversations: patchConversationById(state.conversations, id, { agentBinaryName })
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
      conversations: patchConversationById(state.conversations, id, {
        cliHost: nextHost,
        agentBinaryName: host,
        accountId: accountId ?? current?.accountId
      })
    }))
    try {
      const result = await window.vav.conversations.setCliHost(id, host, accountId)
      if (result.hostChanged) disposeProjection(id)
      set((state) => applyCliHostSetResult(state, id, result))
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
    const nextModel = coercedChatHostModel({
      host: host as ConversationMeta['cliHost'],
      currentModel: conversation.model,
      customModels: state.settings.customModels,
      vavDefaultModel: state.settings.defaultModel,
      defaultAgentModels: state.settings.defaultAgentModels,
      catalog: state.agentModelCatalog,
      vendorId,
      accountId
    })
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
    const conversation = get().conversations.find((c) => c.id === id)
    if (
      swarmBlocksWorkdirSwitch(
        id,
        get().settings.swarmModeEnabled === true,
        conversation?.archived
      )
    )
      return
    const machineId = normalizeMachineId(conversation?.machineId ?? get().windowMachineId)
    if (!isLocalMachine(machineId)) {
      get().openRemoteFolderPicker(id, machineId)
      return
    }
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
    if (
      swarmBlocksWorkdirSwitch(
        id,
        get().settings.swarmModeEnabled === true,
        get().conversations.find((c) => c.id === id)?.archived
      )
    )
      return
    const conversations = await window.vav.conversations.useTempWorkingDirectory(id)
    get().revealWorkdirPath(id)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations)
    }))
    const next = conversations.find((c) => c.id === id)?.workingDirectory ?? null
    await useWorkspaceStore.getState().setWorkingDirectory(id, next)
  },

  async setWorkingDirectory(id, path, machineId) {
    if (
      swarmBlocksWorkdirSwitch(
        id,
        get().settings.swarmModeEnabled === true,
        get().conversations.find((c) => c.id === id)?.archived
      )
    )
      return
    // User-driven switch (menu / recent) — always reveal real path thereafter.
    get().revealWorkdirPath(id)
    const conversations = await window.vav.conversations.setWorkingDirectory(id, path, machineId)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations)
    }))
    await useWorkspaceStore.getState().setWorkingDirectory(id, path)
  },

  openRemoteFolderPicker(conversationId, machineId, purpose = 'workdir') {
    const pick = { conversationId, machineId, purpose }
    const openNative = window.vav?.window?.openRemoteFolderPicker
    if (typeof openNative === 'function') {
      void openNative(pick)
      return
    }
    set({ remoteFolderPick: pick })
  },

  closeRemoteFolderPicker() {
    set({ remoteFolderPick: null })
  },

  async applyRemoteFolderPick(result) {
    if (result.purpose === 'directory') {
      window.dispatchEvent(
        new CustomEvent('vav:phone-folder-picked', { detail: { path: result.path } })
      )
      return
    }
    const chosen = result.path?.trim() ?? ''
    if (!chosen) return
    if (result.purpose === 'locate' && result.conversationId) {
      await get().finishLocateWorkspace(result.conversationId, chosen)
      return
    }
    if (!result.conversationId) {
      await get().createConversation({
        workingDirectory: chosen,
        machineId: result.machineId,
        openIn: 'here'
      })
      return
    }
    await get().setWorkingDirectory(result.conversationId, chosen, result.machineId)
  },

  async locateWorkspace(id) {
    const conversation = get().conversations.find((c) => c.id === id)
    if (
      swarmBlocksWorkdirSwitch(
        id,
        get().settings.swarmModeEnabled === true,
        conversation?.archived
      )
    )
      return
    const machineId = normalizeMachineId(conversation?.machineId ?? get().windowMachineId)
    if (!isLocalMachine(machineId)) {
      get().openRemoteFolderPicker(id, machineId, 'locate')
      return
    }
    const destination = await window.vav.settings.pickDirectory()
    if (!destination) return
    await get().finishLocateWorkspace(id, destination)
  },

  async finishLocateWorkspace(id, destinationDir) {
    const result = await window.vav.conversations.locateWorkspace(id, destinationDir)
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

  openSidebarSearch() {
    set((state) => {
      if (state.sidebarSearchOpen && state.sidebarVisible) return {}
      const next: Partial<SessionState> = { sidebarSearchOpen: true }
      if (!state.sidebarVisible) {
        saveGlobalLayout({ sidebarVisible: true })
        next.sidebarVisible = true
      }
      return next
    })
  },

  closeSidebarSearch() {
    set({ sidebarSearchOpen: false, sidebarQuery: '' })
  },

  toggleSidebarSearch() {
    if (get().sidebarSearchOpen) get().closeSidebarSearch()
    else get().openSidebarSearch()
  },

  async setPinned(id, pinned) {
    const conversations = await window.vav.conversations.setPinned(id, pinned)
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations)
    }))
  },

  async setFavorite(id, favorite) {
    const next = nextFavoriteIds(get().settings.favoriteConversationIds ?? [], id, favorite)
    if (!next) return
    await get().updateSettings({ favoriteConversationIds: next })
  },

  async setWorkspacePinned(workdir, pinned) {
    const next = nextPinnedWorkspaceDirs(
      get().settings.pinnedWorkspaceDirectories ?? [],
      workdir,
      pinned
    )
    if (!next) return
    await get().updateSettings({ pinnedWorkspaceDirectories: next })
  },

  async setArchived(id, archived) {
    const conversations = await window.vav.conversations.setArchived(id, archived)
    const { activeId, sidebarListMode } = get()
    // Archiving keeps the current list — the sidebar moves the selection to
    // the archived row's neighbor instead of jumping to the archive view.
    set((state) =>
      setArchivedConversationPatch(
        state,
        conversations,
        activeId,
        sidebarListMode,
        id,
        archived
      )
    )
  },

  async setApprovalMode(id, mode) {
    set((state) => ({
      conversations: patchConversationById(state.conversations, id, { approvalMode: mode })
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
      conversations: patchConversationById(state.conversations, id, (c) => ({
        ...c,
        acpSession: patchAcpSessionMode(c.acpSession, modeId)
      }))
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
      conversations: patchConversationById(state.conversations, id, (c) => {
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

  async applyAcpGoal(id, action, objective) {
    try {
      const result = await window.vav.conversations.setAcpGoal(id, action, objective)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, result.conversations)
      }))
      if (!result.ok) {
        get().showToast({ kind: 'error', title: result.error || tt('goal.controlFailed') })
        return
      }
      if (result.via === 'slash') {
        await get().send(result.text, [], id)
      }
    } catch (err) {
      console.error('[applyAcpGoal] failed', err)
      get().showToast({ kind: 'error', title: tt('goal.controlFailed') })
    }
  },

  async setThinkingLevel(id, level) {
    set((state) => ({
      conversations: patchConversationById(state.conversations, id, { thinkingLevel: level })
    }))
    try {
      const list = await window.vav.conversations.setThinkingLevel(id, level)
      set((state) => ({
        conversations: mergeConversationList(state.conversations, list)
      }))
      const thinking = defaultThinkingSettingsPatch(level, get().settings.defaultThinkingLevel)
      if (thinking) void get().updateSettings(thinking)
    } catch (err) {
      console.error('[setThinkingLevel] failed', err)
    }
  },

  async setFast(id, fast) {
    set((state) => ({
      conversations: patchConversationById(state.conversations, id, { fast })
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
      conversations: patchConversationById(state.conversations, id, { focusedFilePath: path })
    }))
    try {
      await window.vav.conversations.setFocusedFile(id, path)
    } catch {
      // keep local patch; main may be unavailable
    }
  },

  async setFocusedDbTable(id, table) {
    const next = table?.trim() || null
    const current = get().conversations.find((c) => c.id === id)
    if (current && (current.focusedDbTable ?? null) === next) return
    set((state) => ({
      conversations: patchConversationById(state.conversations, id, { focusedDbTable: next })
    }))
    try {
      await window.vav.conversations.setFocusedDbTable(id, next)
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
    // every file click. Use Files → “Add to composer” for that.
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
    notifyImageAttachPlan(get().showToast, plan, tt)
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
    set((state) => ({ commentCards: setCommentCardsMap(state.commentCards, id, cards) }))
  },

  updateCommentCard(id, refId, comment) {
    set((state) => ({
      commentCards: updateCommentCardInMap(state.commentCards, id, refId, comment)
    }))
  },

  removeCommentCard(id, refId) {
    set((state) => ({
      commentCards: removeCommentCardFromMap(state.commentCards, id, refId)
    }))
  },

  clearCommentCards(id) {
    const target = id ?? get().activeId
    if (!target) return
    set((state) => ({ commentCards: clearCommentCardsMap(state.commentCards, target) }))
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
      hosts,
      messageQueues
    } = get()
    let activeId = conversationId?.trim() || storeActiveId
    if (isArchivedConversation(conversations, activeId)) return
    // Empty chat shell: mint the session on first send (workspace materializes).
    if (!activeId || !conversations.some((c) => c.id === activeId)) {
      await get().createConversation({ openIn: 'here' })
      activeId = get().activeId
      if (!activeId) return
    }
    const turn = turns[activeId]
    const refs = previewRefs[activeId] ?? []
    const cards = commentCards[activeId] ?? []
    const leftoverContext = resolveComposerContextFile(contextFiles, activeId)
    const files = mergeComposerFilePaths(leftoverContext, attachments)
    const activeConversation = conversations.find((c) => c.id === activeId)
    const activeHost = activeConversation?.cliHost ?? null
    const hostHoldsKeys = hostHoldsControlPlaneKeys(hosts, activeConversation?.machineId)
    const disposition = composerSendDisposition({
      empty: isEmptyComposerSend(text, files, refs, cards),
      awaitingTool: !!turn?.awaitingToolCallId,
      needsApiKey: !activeHost && !settings.apiKeyPresent && !hostHoldsKeys,
      isRunning: !!turn?.isRunning,
      queueLength: (messageQueues[activeId] ?? []).length
    })
    if (disposition === 'empty' || disposition === 'awaiting') return
    if (disposition === 'need-key') {
      get().showDialog({
        title: tt('common.hint'),
        body: tt('dialog.configureApiKeyBody'),
        confirmLabel: tt('error.openSettings'),
        onConfirm: () => get().openSettings('agents', 'vav')
      })
      return
    }
    if (disposition === 'full') {
      get().showToast({
        kind: 'error',
        title: tt('queue.fullTitle'),
        description: tt('queue.fullBody', { n: MESSAGE_QUEUE_MAX })
      })
      return
    }

    // Streaming: enqueue instead of interrupting (main-chat-streaming.rpml §5).
    if (disposition === 'enqueue') {
      const quote = quotes[activeId] ?? null
      const item: QueuedMessage = buildQueuedMessage({
        text,
        attachments: files,
        previewRefs: refs,
        commentCards: cards,
        quote,
        contextFile: null
      })
      set((state) => enqueueQueuedMessagePatch(state, activeId!, item))
      return
    }

    // Keep global selection aligned so Transcript / tools / IPC stay on the
    // same conversation as this send (file drawer / workspace column).
    if (storeActiveId !== activeId) {
      await get().selectConversation(activeId)
    }

    const quote = quotes[activeId] ?? null

    const allRefs = mergePreviewAndCommentRefs(refs, cards)

    // No optimistic echo: the stored message comes back as a `user` turn event
    // a moment later, already carrying the id and parent the tree needs.
    set((state) => composerClearedPatch(state, activeId))

    await window.vav.agent.send(
      activeId,
      text,
      files,
      quote,
      allRefs.length ? allRefs : null,
      null
    )
  },

  updateQueuedMessage(conversationId, queueId, text) {
    set((state) => updateQueuedMessagePatch(state, conversationId, queueId, text))
  },

  removeQueuedMessage(conversationId, queueId) {
    set((state) => removeQueuedMessagePatch(state, conversationId, queueId))
  },

  async sendQueuedNow(conversationId, queueId) {
    const state = get()
    const queue = state.messageQueues[conversationId] ?? []
    const item = queue.find((q) => q.id === queueId)
    if (!item) return
    if (
      isEmptyComposerSend(
        item.text,
        item.attachments,
        item.previewRefs,
        item.commentCards
      )
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
        const idle = await pollUntil(() => !get().turns[conversationId]?.isRunning, {
          timeoutMs: 20_000,
          intervalMs: 40
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
    const turn = get().turns[conversationId]
    if (
      !shouldDrainMessageQueue({
        sendNowInFlight: queueSendInFlight.has(conversationId),
        isRunning: turn?.isRunning,
        awaitingToolCallId: turn?.awaitingToolCallId,
        queueLength: get().messageQueues[conversationId]?.length ?? 0
      })
    ) {
      return
    }
    const head = get().messageQueues[conversationId]?.[0]
    if (!head) return
    // Re-use sendQueuedNow so removal + payload path stay single-sourced.
    await get().sendQueuedNow(conversationId, head.id)
  },

  async regenerate(messageId) {
    const state = get()
    const { activeId } = state
    if (
      !canMutateActiveSession(activeId, state.conversations, {
        isRunning: state.turns[activeId]?.isRunning
      })
    ) {
      return
    }
    // Drop back to the prompt right away, or the reply being replaced would sit
    // above the stream and look like one more record.
    const target = state.messages[activeId]?.find((m) => m.id === messageId)
    if (!target) return
    setLeaf(set, state.activeLeaf, activeId, regenerateActiveLeaf(target))
    set({ errorBanner: null, errorBannerKind: null, errorBannerDetail: null })
    await window.vav.agent.regenerate(activeId, messageId)
  },

  async editUserMessage(messageId, text) {
    const state = get()
    const { activeId } = state
    if (
      !canMutateActiveSession(activeId, state.conversations, {
        isRunning: state.turns[activeId]?.isRunning
      })
    ) {
      return
    }
    if (!text.trim()) return
    const target = state.messages[activeId]?.find((m) => m.id === messageId)
    if (!target) return
    setLeaf(set, state.activeLeaf, activeId, target.parentId)
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
    if (!canMutateActiveSession(activeId, conversations, { requireIdle: false })) return
    setLeaf(set, get().activeLeaf, activeId, parentKey)
    await window.vav.conversations.setLeaf(activeId, parentKey)
    get().focusComposer()
  },

  requestDeleteMessage(messageId) {
    const { activeId } = get()
    if (
      !canMutateActiveSession(activeId, get().conversations, {
        isRunning: get().turns[activeId]?.isRunning
      })
    ) {
      return
    }
    const nodes = get().messages[activeId] ?? []
    if (!nodes.some((message) => message.id === messageId)) return
    const extra = deleteMessageFollowCount(nodes, messageId)
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
    if (
      !canMutateActiveSession(activeId, get().conversations, {
        isRunning: get().turns[activeId]?.isRunning
      })
    ) {
      return
    }
    const result = await window.vav.conversations.deleteMessage(activeId, messageId)
    if (!result) return
      set((state) => deleteMessageHydratePatch(state, activeId, result))
  },

  async fork(messageId) {
    const state = get()
    const { activeId } = state
    if (
      !canMutateActiveSession(activeId, state.conversations, {
        isRunning: state.turns[activeId]?.isRunning
      })
    ) {
      return
    }
    const leaf = await window.vav.agent.fork(activeId, messageId)
    if (leaf === null) return
    setLeaf(set, get().activeLeaf, activeId, leaf)
    get().focusComposer()
  },

  async continueInNewSession(messageId) {
    const { activeId, conversations } = get()
    if (!canMutateActiveSession(activeId, conversations, { requireIdle: false })) return
    const meta = await window.vav.conversations.continueInNewSession(activeId, messageId)
    if (!meta) return
    set((state) => ({
      conversations: prependConversationIfMissing(state.conversations, meta)
    }))
    await get().selectConversation(meta.id)
    get().focusComposer()
  },

  async compactConversation(keepAfterMessageId) {
    const { activeId } = get()
    if (!canMutateActiveSession(activeId, get().conversations, { requireIdle: false })) {
      return false
    }
    const reason = compactRefusalReason({
      cliHost: get().conversations.find((c) => c.id === activeId)?.cliHost,
      isRunning: get().turns[activeId]?.isRunning
    })
    if (reason === 'cli-host') {
      set(genericErrorBanner(tt('compact.error.cliHost')))
      return false
    }
    if (reason === 'busy') {
      set(genericErrorBanner(tt('compact.error.busy')))
      return false
    }
    const result = await window.vav.agent.compact(
      activeId,
      keepAfterMessageId ? { keepAfterMessageId } : undefined
    )
    if (!result.ok) {
      set(genericErrorBanner(result.error))
      return false
    }
    // No toast — transcript shows a quiet "history compact" log via CompactionBanner.
    // Shrink context fill on the conversation meta so the composer ring updates.
    set((state) => compactionSucceededPatch(state, activeId, result.compaction))
    return true
  },

  async clearCompaction() {
    const { activeId } = get()
    if (!activeId) return false
    if (
      compactRefusalReason({
        cliHost: get().conversations.find((c) => c.id === activeId)?.cliHost,
        requireIdle: false
      }) === 'cli-host'
    ) {
      set(genericErrorBanner(tt('compact.error.cliHost')))
      return false
    }
    const leafId = get().activeLeaf[activeId]
    const messages = get().messages[activeId] ?? []
    const active = compactionForLeaf(get().compactions[activeId], messages, leafId)
    if (!active) return false
    const result = await window.vav.agent.clearCompaction(activeId, active.leafId)
    if (!result.ok) {
      set(genericErrorBanner(result.error))
      return false
    }
    set((state) => clearCompactionPatch(state, activeId, active.leafId))
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
      conversationId = conversationIdAwaitingTool(get().turns, toolCallId, conversationId)
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

  async answerSecrets(toolCallId, payload) {
    const { activeId } = get()
    let conversationId = activeId || ''
    if (toolCallId) {
      conversationId = conversationIdAwaitingTool(get().turns, toolCallId, conversationId)
    }
    const ok = await window.vav.agent.answerSecrets(conversationId, toolCallId, payload)
    if (ok === false) {
      console.warn('[session] answerSecrets: main had no pending waiter', {
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

  async setDefaultMachine(machineId) {
    const id = normalizeMachineId(machineId)
    if (normalizeMachineId(get().settings.defaultMachineId) === id) return
    await get().updateSettings({ defaultMachineId: id })
  },

  async switchMachine(machineId) {
    const id = normalizeMachineId(machineId)
    if (normalizeMachineId(get().windowMachineId) === id) return
    const host = get().hosts.find((row) => row.id === id)
    set({
      windowMachineId: id,
      ...(host?.home ? { home: host.home } : {}),
      ...(host?.tmp ? { tmp: host.tmp } : {})
    })
    await syncActiveConversationToMachine()
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

  openSettings(category, agentId, machineId) {
    // Settings own a window; the main window only asks for it to be raised.
    void window.vav.window.openSettings(category ?? 'appearance', agentId, machineId)
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
    set({
      search: searchStateForQuery(state.search, visibleMessages(state, state.activeId), query)
    })
  },

  stepSearch(direction) {
    set((state) => {
      const next = stepSearchState(state.search, direction)
      return next ? { search: next } : state
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
    await openChangeReviewState(get, set, changeSetId)
  },

  closeChangeReview() {
    closeChangeReviewState(set)
  },

  async refreshChangeSet() {
    await refreshChangeSetState(get, set)
  },

  async acceptChangeFiles(filePaths) {
    const id = activeChangeSetId(get)
    if (!id) return
    await get().acceptChangeFilesFor(id, filePaths)
  },

  async rejectChangeFiles(filePaths) {
    const id = activeChangeSetId(get)
    if (!id) return
    await get().rejectChangeFilesFor(id, filePaths)
  },

  async acceptAllChanges() {
    const id = activeChangeSetId(get)
    if (!id) return
    await get().acceptAllChangesFor(id)
  },

  async rejectAllChanges() {
    const id = activeChangeSetId(get)
    if (!id) return
    await get().rejectAllChangesFor(id)
  },

  async undoChangeFile(filePath) {
    const id = activeChangeSetId(get)
    if (!id) return
    await get().undoChangeFileFor(id, filePath)
  },

  async applyChangeEdit(filePath, content) {
    await applyChangeEditReview(get, set, filePath, content)
  },

  async acceptChangeFilesFor(changeSetId, filePaths) {
    await acceptChangeFilesForReview(set, changeSetId, filePaths)
  },

  async rejectChangeFilesFor(changeSetId, filePaths) {
    await rejectChangeFilesForReview(set, changeSetId, filePaths)
  },

  async acceptAllChangesFor(changeSetId) {
    await acceptAllChangesForReview(set, changeSetId)
  },

  async rejectAllChangesFor(changeSetId) {
    await rejectAllChangesForReview(set, changeSetId)
  },

  async undoChangeFileFor(changeSetId, filePath) {
    await undoChangeFileForReview(set, changeSetId, filePath)
  },

  async checkForUpdates() {
    set((current) => ({
      updateState: { ...current.updateState, phase: 'checking', message: null }
    }))
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    const state = await window.vav.updates.check()
    set({ updateState: state })
  },

  async downloadUpdate() {
    const state = await window.vav.updates.openDownload()
    set({ updateState: state })
  },

  async cancelUpdateDownload() {
    const cancel = window.vav.updates.cancelDownload
    if (!cancel) return
    const state = await cancel()
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

  setFilesSource(source) {
    set({ filesSource: source })
  },

  showFileList() {
    set({
      sidebarListMode: 'fileSessions',
      activeId: '',
      selectedIds: []
    })
  },

  activateSidebarListMode(mode) {
    const { sidebarListMode } = get()
    if (sidebarListMode === mode) return
    set({
      sidebarListMode: mode,
      sidebarQuery: '',
      sidebarSearchOpen: false
    })
    // AppKit leaves the workdir / path-chip menu up when only the renderer swaps.
    void window.vav?.window?.closePopupMenu?.()
    if (mode === 'timers') get().ensureScheduledConversation()
    if (mode === 'databases') get().ensureDbConversation()
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
    const tabs = userBashTabsOnly(ws.workspaces[activeId]?.tabs ?? [])
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
      const tabId = await ws.newBash(id, 80, 24, {
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
    const { activeId, settings, conversations } = get()
    if (
      swarmBlocksWorkdirSwitch(
        activeId,
        settings.swarmModeEnabled === true,
        conversations.find((c) => c.id === activeId)?.archived
      )
    )
      return
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
    applySessionTurnEvent(event, {
      get,
      set,
      refreshConversations: () => {
        void window.vav.conversations.list().then((list) =>
          useSessionStore.setState((state) => ({
            conversations: mergeConversationList(state.conversations, list)
          }))
        )
      },
      drainQueue: (id) => {
        void get().drainMessageQueue(id)
      },
      openChangeReview: (changeSetId) => {
        void get().openChangeReview(changeSetId)
      }
    })
  }
}))

export { visibleMessages }

let syncingMachine = false

/**
 * After the sidebar switches machines, show a session that actually lives
 * there — pick the newest, or idle with an empty detail pane.
 */
async function syncActiveConversationToMachine(): Promise<void> {
  if (!isMainSessionShell() || syncingMachine) return
  const state = useSessionStore.getState()
  if (!state.ready) return
  const machineId = normalizeMachineId(state.windowMachineId)
  if (state.sidebarListMode === 'fileSessions') {
    const fileDecision = nextFileCategoryForMachine(state.conversations, state.activeId, machineId)
    if (fileDecision.action === 'keep') return
    useSessionStore.setState({ activeId: '', selectedIds: [] })
    return
  }
  const decision = nextConversationForMachine(state.conversations, state.activeId, machineId)
  if (decision.action === 'keep') return
  syncingMachine = true
  try {
    if (decision.action === 'select') await useSessionStore.getState().selectConversation(decision.id)
    else useSessionStore.setState({ activeId: '', selectedIds: [] })
  } finally {
    syncingMachine = false
  }
}
