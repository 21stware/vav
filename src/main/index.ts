import {
  app,
  autoUpdater as electronAutoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { APP_NAME, applyBranding, applyDockIcon, loadAppIcon, pinUserDataPath } from './brand'
import {
  IPC,
  type Bootstrap,
  type FileInspectResult,
  type MenuCommand,
  type NativeMenuItem,
  type SettingsView,
  type ProviderAccountViewPayload,
  type SwarmHistoryResumeEvent,
  type SwarmHistoryViewPayload,
  type TokenUsageViewPayload
} from '@shared/ipc'
import {
  DEFAULT_CLI_AGENTS,
  DEFAULT_SETTINGS,
  enabledCliAgents,
  type AppSettings,
  type Conversation,
  type ConversationMeta,
  type FileSortKey,
  type ShellKind,
  type TurnEvent
} from '@shared/types'
import { agentBinaryCandidates } from '@shared/agentBinary'
import { localFileStreamUrl } from '@shared/localFileUrl'
import { compactionForLeaf } from '@shared/compaction'
import { hasActiveAgentWork, shouldBlockIdleSleep } from '@shared/sleepBlocker'
import { createSwarmFinishAlert } from './sound/swarmFinishAlert'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import { threadPath } from '@shared/thread'
import { SettingsStore } from './store/SettingsStore'
import { SleepBlocker } from './power/SleepBlocker'
import { SecretStore } from './store/SecretStore'
import { ConversationStore } from './store/ConversationStore'
import { VavPackService } from './store/VavPackService'
import { FileSessionStore } from './store/FileSessionStore'
import { SwarmHistoryStore } from './store/SwarmHistoryStore'
import { FileService } from './fs/FileService'
import { writeClip } from './fs/clipStore'
import { isFileSessionEligible } from '@shared/clipPath'
import { OVERLAY_IMAGE_EXTS, shouldOpenAsOverlay } from '@shared/previewOverlay'
import {
  inferDiagramKind,
  inferOverlayKind,
  overlayIdentity,
  type OverlayNavigatePayload,
  type OverlayPayload
} from '@shared/overlayOpen'
import { WorkingCopyService } from './fs/WorkingCopyService'
import { FileAssociationService, formatIdForPath } from './fs/FileAssociationService'
import { DocumentRetrievalService } from './retrieval/DocumentRetrievalService'
import { DuckDbService } from './fs/DuckDbService'
import { WebSearchService } from './web/WebSearchService'
import { WebFetchService } from './web/WebFetchService'
import { importSurfacePattern, surfacePatternFilePath } from './importSurfacePattern'
import { ChangeSetStore } from './agent/ChangeSetStore'
import {
  checkoutGitBranch,
  createGitBranch,
  createGitWorktree,
  getGitDiff,
  getGitShowBase64,
  getGitSnapshot,
  initGitRepo
} from './git/GitService'
import {
  getGithubActionRun,
  getGithubPull,
  getGithubSite,
  listGithubActions,
  listGithubPulls,
  listGithubReleases
} from './github/GithubService'
import { getCloudflareStatus } from './cloudflare/CloudflareService'
import { getSupabaseStatus } from './supabase/SupabaseService'
import { UpdateService } from './updates'
import { PtyManager, type PtySessionMeta } from './terminal/PtyManager'
import { ensureLoginPath, probeAgentExecutables, resolveAgentExecutable } from './terminal/loginPath'
import { menuCommandFromInput, matchesNewSessionWindow } from './menuShortcuts'
import { resolveKeyBindings } from '@shared/keyBindings'
import { isDevRuntime } from './devRuntime'
import { installDevParentWatchdog } from './devParentWatchdog'
import { AgentRuntime } from './agent/AgentRuntime'
import { CliAgentHost } from './agent/CliAgentHost'
import { createSwarmSessionService } from './agent/swarmSession'
import { hostSessionHasConversation } from './agent/hostSessionStore'
import { buildSwarmHistoryView } from './agent/swarmHistoryView'
import {
  getModelCatalogSnapshot,
  listHostModels,
  preloadHostModels,
  seedModelCatalog
} from './agent/listHostModels'
import { SkillService } from './agent/SkillService'
import {
  cancelAgentInstall,
  clearAgentInstall,
  listAgentInstallRuns,
  onAgentInstallRunsChanged,
  startAgentInstall,
  stopAllAgentInstalls
} from './agent/AgentInstaller'
import { readHostAccountInfo } from './agent/hostAuth'
import type { HostAuthKind } from '@shared/cliAccountParse'
import {
  displayNameForCliHost,
  isStructuredCliHost,
  resolveDefaultChatHost,
  type CliHostKind
} from '@shared/cliHost'
import {
  labelForChatModel,
  resolveModelForChatHost
} from '@shared/agentModels'
import {
  providerLabel as vavProviderLabel
} from '@shared/tokenUsage'
import { contextWindowFor } from './agent/modelMeta'
import { validateApiKey } from './agent/provider'
import { shellPath } from './terminal/StickyShell'
import { buildAppMenu } from './menu'
import { currentLocale, setLocalePreference, t } from './i18n'
import { codeFonts, type Platform } from '@shared/platform'
import { isTsJsPath } from '@shared/previewBlock'
import {
  getCliStatus,
  installCli,
  argvRequestsCliOpen,
  parseCliWorkdir,
  parseOpenPathsFromArgv,
  resolveExistingDirectory,
  classifyOpenPaths,
  setCliPreferredLocation,
  uninstallCli,
  type CliInstallLocation
} from './cli'
import { ensureMacOpenDirectoryService } from './macOpenDirectoryService'
import { NotificationCenter } from './notifications'
import { QuotaService } from './quota/QuotaService'
import { deepseekBalanceUrl } from '@shared/apiBalance'
import { fetchDeepSeekApiBalance } from './quota/deepseekBalance'
import { buildAnalysisSnapshot } from './analysis/buildAnalysisSnapshot'
import {
  configureAnalysisCache,
  invalidateAnalysisCache,
  serveAnalysisSnapshot
} from './analysis/analysisSnapshotCache'
import { hostMayHaveAccountQuota, mergeQuotaWindowsPreferNewer } from '@shared/quotaWindows'
import { nativeSessionId } from '@shared/cliPaneBinding'
import {
  buildSwarmHistoryMenuEntries,
  isBlankSwarmSessionTitle,
  parseSwarmHistoryId,
  swarmSessionKey
} from '@shared/cliSessionHistory'
import {
  mergeLiveAndUnseenTrayPanes,
  shouldRecordPtyCompletion,
  trayItemLabel,
  trayPaneKey,
  type TrayPane
} from '@shared/traySessions'

const PLATFORM = process.platform as Platform
const IS_MAC = PLATFORM === 'darwin'
const IS_WIN = PLATFORM === 'win32'

/**
 * Dev runners / IDE task hosts often close the stdio pipe while Electron is
 * still alive. Unhandled `write EPIPE` from console.log/error then surfaces as
 * a fatal "Uncaught Exception" dialog. Swallow only EPIPE on the process
 * streams and on late IPC to a dead frame.
 */
function ignoreEpipe(stream: NodeJS.WriteStream | null | undefined): void {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') return
    // Re-emit anything else so real stream failures still surface.
    if (stream.listenerCount('error') <= 1) {
      // no other handlers — avoid throwing from the error event itself
    }
  })
}
ignoreEpipe(process.stdout)
ignoreEpipe(process.stderr)
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  // Broken stdio / dead IPC frame — never fatal.
  if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') return
  const msg = String(err?.message ?? err ?? '')
  if (/EPIPE|ERR_STREAM_DESTROYED/i.test(msg)) return
  try {
    console.error('[uncaughtException]', err)
  } catch {
    // stdout may already be dead
  }
})

// Pin userData + menu name before any store touches disk (and before ready so
// the menu bar reads "VAV" instead of "Electron").
pinUserDataPath()
applyBranding()
// Dev: quit if `npm run dev` / electron-vite dies (prevents orphan VAV).
installDevParentWatchdog()

// Local-file scheme for in-window PDF (and other) previews. Must be registered
// before ready so Chromium treats it as a privileged, streamable origin.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'vav-local',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tokenUsageWindow: BrowserWindow | null = null
let providerAccountWindow: BrowserWindow | null = null
/** Last BrowserWindow that held focus — Dock activate raises this, not always main. */
let lastFocusedWindow: BrowserWindow | null = null
/** Conversation currently shown in the token-usage panel (for live hydrate). */
let tokenUsageConversationId: string | null = null
/** Parent window id the panel was last attached to (recreate if parent changes). */
let tokenUsageParentId: number | null = null
/** True once the token-usage renderer has finished its first load. */
let tokenUsageReady = false
/** Open requested while the panel shell was still loading — show on did-finish-load. */
let tokenUsagePendingShow: {
  parent: BrowserWindow
  anchor?: { x: number; y: number; width: number; height: number }
} | null = null
let providerAccountConversationId: string | null = null
let providerAccountParentId: number | null = null
let providerAccountReady = false
let providerAccountAuth: {
  signedIn: boolean
  accountId: string | null
  plan: string | null
  authKind: HostAuthKind
} | null = null
let providerAccountPendingShow: {
  parent: BrowserWindow
  anchor?: { x: number; y: number; width: number; height: number }
} | null = null
let providerAccountAnchor: ProviderAccountAnchor | undefined
/** At most one standalone window per conversation (sidebar spec, 双击). */
const detachedWindows = new Map<string, BrowserWindow>()
/** Reverse lookup so park/close can resolve the bound conversation. */
const detachedWindowIds = new WeakMap<BrowserWindow, string>()
/** At most one preview window per absolute file path. */
const previewWindows = new Map<string, BrowserWindow>()
/**
 * Conversations minted by ⌘⇧↵. Closing one that never got a message deletes
 * it, so the quick-ask shortcut cannot litter the sidebar with empty shells.
 */
const ephemeralConversations = new Set<string>()
let quitting = false

/**
 * Hidden warm session shells — ⌘⇧↵ claims one instead of cold BrowserWindow+load.
 * One is enough for the hotkey (single new chat); refill after claim.
 */
const SESSION_WARM_POOL = 1
const SESSION_POOL_REFILL_MS = 200
/**
 * If the user hits ⌘⇧↵ while a shell is still booting, wait this long before
 * falling back to cold create. Avoids racing a second BrowserWindow against the
 * in-flight warm load (which made "first open" feel even slower).
 */
const SESSION_WARM_WAIT_MS = 1200
const warmSessionPool: BrowserWindow[] = []
const warmSessionReady = new WeakSet<BrowserWindow>()
/** Monotonic navigate seq so late IPC cannot clobber a newer open. */
let sessionNavigateSeq = 0
/** Hotkey / open clock for [session-perf] logs. */
let sessionOpenT0 = 0

const settingsStore = new SettingsStore()
const secretStore = new SecretStore()
const conversationStore = new ConversationStore()
const swarmHistoryStore = new SwarmHistoryStore(
  join(app.getPath('userData'), 'swarm-session-history.json')
)
const liveAgentPanes = {
  list: (): { conversationId: string; tabId: string; agentId: string }[] => []
}
const swarmSession = createSwarmSessionService({
  conversations: conversationStore,
  history: swarmHistoryStore,
  publish: () => publishConversations(),
  listLivePanes: () => liveAgentPanes.list()
})
// resolveNewWorkdir is a function declaration below (hoisted) — mint Temporary Workspaces on import.
const vavPackService = new VavPackService(conversationStore, () => resolveNewWorkdir())
const fileSessionStore = new FileSessionStore()

const fileAssociationService = new FileAssociationService()
const workingCopyService = new WorkingCopyService()
const fileService = new FileService((conversationId, dirs) => {
  sendToWorkspaceWindows(IPC.filesDirty, { conversationId, dirs }, conversationId)
})
fileService.workingCopies = workingCopyService
workingCopyService.onCopyChanged = (realPath) => {
  sendToWorkspaceWindows(IPC.agentEvent, {
    type: 'fs-changed',
    conversationId: '',
    parentPath: dirname(realPath),
    filePath: realPath
  })
}
// Wired after construction — retrieval is defined below; assigned once created.

let swarmFinishAlert: ReturnType<typeof createSwarmFinishAlert> | null = null

const ptyManager = new PtyManager(
  (tabId, data) =>
    sendToWorkspaceWindows(IPC.ptyData, { tabId, data }, ptyManager.conversationIdFor(tabId)),
  (tabId, conversationId) => {
    sendToWorkspaceWindows(IPC.ptyExit, tabId, conversationId)
    swarmFinishAlert?.noteGone(tabId)
  },
  // Workspace windows re-hydrate tab maps from main — no per-renderer PTY ownership.
  (conversationId) => {
    sendToWorkspaceWindows(IPC.ptyChanged, { conversationId }, conversationId)
    // Live CLI / bash panes plus unseen completions drive the tray menu.
    refreshTraySessions()
  },
  (tabId, conversationId, status) => {
    sendToWorkspaceWindows(IPC.ptyStatus, { tabId, conversationId, status }, conversationId)
    syncSleepBlocker()
    handlePtyStatusForTray(tabId, conversationId, status)
    if (status === 'exited') {
      swarmFinishAlert?.noteGone(tabId)
      return
    }
    const target = ptyManager.cliAgentWatchTarget(tabId)
    if (!target) return
    swarmFinishAlert?.noteStatus({
      tabId,
      conversationId,
      agentId: target.agentId,
      status,
      createdAt: target.createdAt,
      lastDataAt: target.lastDataAt
    })
  }
)
liveAgentPanes.list = () =>
  ptyManager
    .listCliAgentSessions()
    .filter((session): session is typeof session & { agentId: string } => !!session.agentId)
    .map((session) => ({
      conversationId: session.conversationId,
      tabId: session.id,
      agentId: session.agentId
    }))

/** Conversation ids with a live or paused turn — counted on the tray badge. */
const activeTurns = new Map<string, 'running' | 'paused'>()
/** Completed runs the user has not opened/focused yet — stay in the tray. */
const unseenResults = new Map<string, TrayPane>()
/** PTY tab has settled once (so the next idle is a finished command). */
const ptyPrimed = new Set<string>()
/** PTY tabId → when the current running streak started. */
const ptyRunningSince = new Map<string, number>()
/** Last built pane for a PTY tab (exit removes the session before we read it). */
const ptyTrayPanes = new Map<string, TrayPane>()
const sleepBlocker = new SleepBlocker()

function syncSleepBlocker(): void {
  const enabled = settingsStore.get().keepAwakeWhileAgentRunning === true
  const hasWork = hasActiveAgentWork({
    turns: activeTurns.values(),
    cliAgentStatuses: ptyManager.listCliAgentSessions().map((session) => session.status)
  })
  sleepBlocker.setActive(shouldBlockIdleSleep(enabled, hasWork))
}

/**
 * Raise the session where the user left it (detached companion if open, else
 * main) and tell the renderer which surface/pane to show.
 *
 * Tray CLI rows pass surface=cli + tabId so we enter CLI Agents and focus that
 * pane. Bash rows pass surface=bash + tabId to open Tools → Terminal on that tab.
 * Chat rows pass surface=vav to raise the conversation transcript.
 */
function focusRunningSession(target: {
  conversationId: string
  surface?: 'vav' | 'cli' | 'bash'
  tabId?: string
  agentId?: string
}): void {
  const conversationId = target.conversationId
  if (!conversationId) return
  markResultViewed(conversationId)
  const payload = {
    conversationId,
    toast: null as string | null,
    surface: target.surface,
    tabId: target.tabId,
    agentId: target.agentId
  }

  const detached = detachedWindows.get(conversationId)
  if (detached && !detached.isDestroyed()) {
    raiseDetachedWindow(detached)
    const send = (): void => {
      if (detached.isDestroyed()) return
      safeSend(detached.webContents, IPC.cliOpen, payload)
    }
    if (detached.webContents.isLoading()) {
      detached.webContents.once('did-finish-load', () => setTimeout(send, 50))
    } else {
      setTimeout(send, 50)
    }
    return
  }

  const wasMissing = !mainWindow || mainWindow.isDestroyed()
  showMainWindow()
  const send = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    safeSend(mainWindow.webContents, IPC.cliOpen, payload)
  }
  // Main may still be loading after create/show — wait so the renderer
  // has onCliOpen wired before we ask it to select the session.
  if (
    wasMissing ||
    (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isLoading())
  ) {
    mainWindow?.webContents.once('did-finish-load', () => setTimeout(send, 50))
  } else {
    setTimeout(send, 50)
  }
}

/**
 * Detached session / file preview → main window: select the row, raise main,
 * close the companion. Must not go through {@link focusRunningSession} — that
 * prefers an open detached pane and never shows the sidebar list.
 */
async function revealConversationInList(conversationId: string): Promise<void> {
  // Always raise the main shell first. A missing id / unknown conversation
  // must still summon the list — otherwise the companion close leaves no UI.
  if (conversationId) ephemeralConversations.delete(conversationId)
  await showMainWindow()

  if (conversationId && conversationStore.get(conversationId)) {
    const payload = {
      conversationId,
      toast: null as string | null,
      surface: 'vav' as const
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow.webContents, IPC.cliOpen, payload)
          }
        })
      } else {
        safeSend(mainWindow.webContents, IPC.cliOpen, payload)
      }
    }
  }

  const detached = conversationId ? detachedWindows.get(conversationId) : undefined
  if (detached && !detached.isDestroyed()) {
    detached.close()
  }
}

const notifications = new NotificationCenter(
  () => settingsStore.get(),
  (target) => focusRunningSession(target),
  () => openSettingsWindow(),
  showMainWindow,
  () => mainWindow
)
swarmFinishAlert = createSwarmFinishAlert(
  (conversationId) => {
    const conversation = conversationStore.get(conversationId)
    const title = conversation?.title ?? t('window.sessionFallback')
    notifications.alertUser('turn-complete', conversationId, title, t('notify.turnComplete'))
  },
  {
    isForeground: (conversationId) => notifications.isConversationForeground(conversationId)
  }
)

/** Compact path for tray labels: `/Users/me/repo/vav` → `~/repo/vav`. */
function trayDirLabel(workingDirectory: string | null | undefined): string {
  if (!workingDirectory || workingDirectory === '~') return '~'
  const home = homedir()
  if (workingDirectory === home) return '~'
  if (workingDirectory.startsWith(home + '/') || workingDirectory.startsWith(home + '\\')) {
    return `~${workingDirectory.slice(home.length).replace(/\\/g, '/')}`
  }
  // Fall back to last segment if path is long and outside home.
  const parts = workingDirectory.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : workingDirectory
}

function trayAgentLabel(agentId: string): string {
  const fromSettings = settingsStore.get().cliAgents?.find((a) => a.id === agentId)
  if (fromSettings?.name) return fromSettings.name
  return agentId
}

function trayPaneFromConversation(
  conversationId: string,
  kind: TrayPane['kind'],
  extra?: {
    tabId?: string
    paneTitle?: string
    createdAt?: number
    agentId?: string
    sessionTitle?: string
  }
): TrayPane | null {
  const conversation = conversationStore.get(conversationId)
  if (!conversation || conversation.archived) return null
  const dir = conversation.workingDirectory || '~'
  const title =
    extra?.sessionTitle ||
    (conversation.title && conversation.title.trim()) ||
    conversationId
  const agentId = extra?.agentId || conversation.cliHost || undefined
  const paneTitle =
    extra?.paneTitle ||
    (kind === 'agent'
      ? agentId
        ? trayAgentLabel(agentId)
        : 'CLI'
      : kind === 'bash'
        ? 'bash'
        : conversation.cliHost
          ? displayNameForCliHost(conversation.cliHost)
          : 'VAV')
  return {
    conversationId,
    tabId: extra?.tabId ?? '',
    kind,
    sessionTitle: title,
    paneTitle,
    dirKey: dir,
    dirLabel: trayDirLabel(dir),
    createdAt: extra?.createdAt ?? conversation.updatedAt,
    agentId
  }
}

function agentSessionTitle(session: PtySessionMeta): string {
  const conversation = conversationStore.get(session.conversationId)
  const binding = conversationStore.getCliPaneBindings(session.conversationId)[session.id]
  const sessionId = nativeSessionId(binding?.cursor)
  const named =
    sessionId && session.agentId
      ? swarmHistoryStore.get(swarmSessionKey(session.agentId, sessionId))?.name?.trim()
      : null
  const bindingTitle = binding?.title?.trim()
  return (
    named ||
    bindingTitle ||
    (conversation?.title && conversation.title.trim()) ||
    session.title ||
    session.conversationId
  )
}

function trayPaneFromAgentSession(session: PtySessionMeta): TrayPane | null {
  if (session.agentId) swarmSession.adoptPane(session.conversationId, session.id, session.agentId)
  return trayPaneFromConversation(session.conversationId, 'agent', {
    tabId: session.id,
    paneTitle: session.agentId ? trayAgentLabel(session.agentId) : 'CLI',
    createdAt: session.createdAt,
    agentId: session.agentId || undefined,
    sessionTitle: agentSessionTitle(session)
  })
}

function trayPaneFromBashSession(session: PtySessionMeta): TrayPane | null {
  return trayPaneFromConversation(session.conversationId, 'bash', {
    tabId: session.id,
    paneTitle: session.title || 'bash',
    createdAt: session.createdAt
  })
}

function persistResultUnseen(conversationId: string, unseen: boolean): void {
  const conversation = conversationStore.get(conversationId)
  if (!conversation || conversation.resultUnseen === unseen) return
  conversationStore.updateMeta(conversationId, { resultUnseen: unseen })
}

function markResultUnseen(pane: TrayPane): void {
  if (ephemeralConversations.has(pane.conversationId)) return
  if (notifications.isConversationForeground(pane.conversationId)) {
    markResultViewed(pane.conversationId)
    return
  }
  unseenResults.set(trayPaneKey(pane), pane)
  persistResultUnseen(pane.conversationId, true)
  refreshTraySessions()
}

function markResultViewed(conversationId: string): void {
  if (!conversationId) return
  let changed = false
  for (const [key, pane] of unseenResults) {
    if (pane.conversationId !== conversationId) continue
    unseenResults.delete(key)
    changed = true
  }
  const conversation = conversationStore.get(conversationId)
  if (conversation?.resultUnseen) {
    persistResultUnseen(conversationId, false)
    changed = true
  }
  if (changed) refreshTraySessions()
}

function clearUnseenForConversation(conversationId: string): void {
  for (const [key, pane] of unseenResults) {
    if (pane.conversationId === conversationId) unseenResults.delete(key)
  }
}

function handlePtyStatusForTray(
  tabId: string,
  _conversationId: string,
  status: 'running' | 'idle' | 'exited'
): void {
  if (status === 'running') {
    const agent = ptyManager.listCliAgentSessions().find((s) => s.id === tabId)
    const bash = agent ? undefined : ptyManager.listBashSessions().find((s) => s.id === tabId)
    const pane = agent
      ? trayPaneFromAgentSession(agent)
      : bash
        ? trayPaneFromBashSession(bash)
        : (ptyTrayPanes.get(tabId) ?? null)
    if (pane) ptyTrayPanes.set(tabId, pane)
    if (!ptyRunningSince.has(tabId)) ptyRunningSince.set(tabId, Date.now())
    refreshTraySessions()
    return
  }

  const runningSince = ptyRunningSince.get(tabId) ?? null
  ptyRunningSince.delete(tabId)
  const pane = ptyTrayPanes.get(tabId)
  const record = shouldRecordPtyCompletion({
    primed: ptyPrimed.has(tabId),
    runningSince,
    now: Date.now()
  })
  ptyPrimed.add(tabId)
  if (record && pane) markResultUnseen(pane)
  else refreshTraySessions()
  if (status === 'exited') {
    ptyPrimed.delete(tabId)
    ptyTrayPanes.delete(tabId)
  }
}

function refreshTraySessions(): void {
  try {
    const live: TrayPane[] = []

    for (const id of activeTurns.keys()) {
      if (ephemeralConversations.has(id)) continue
      const pane = trayPaneFromConversation(id, 'chat')
      if (pane) live.push(pane)
    }

    for (const s of ptyManager.listCliAgentSessions()) {
      const pane = trayPaneFromAgentSession(s)
      if (!pane) continue
      ptyTrayPanes.set(s.id, pane)
      if (s.status === 'running') live.push(pane)
    }
    for (const s of ptyManager.listBashSessions()) {
      const pane = trayPaneFromBashSession(s)
      if (!pane) continue
      ptyTrayPanes.set(s.id, pane)
      if (s.status === 'running') live.push(pane)
    }

    // Restart / persist: a conversation flagged unseen with no in-memory pane.
    for (const conversation of conversationStore.all()) {
      if (!conversation.resultUnseen || conversation.archived) continue
      if (ephemeralConversations.has(conversation.id)) continue
      const already = [...unseenResults.values()].some((p) => p.conversationId === conversation.id)
      if (already) continue
      const pane = trayPaneFromConversation(conversation.id, 'chat')
      if (pane) unseenResults.set(trayPaneKey(pane), pane)
    }

    const panes = mergeLiveAndUnseenTrayPanes(
      live,
      [...unseenResults.values()].filter((pane) => {
        const conversation = conversationStore.get(pane.conversationId)
        return conversation && !conversation.archived
      })
    )
    notifications.updateRunningSessions(
      panes.map((pane) => ({
        conversationId: pane.conversationId,
        title: trayItemLabel(pane),
        surface:
          pane.kind === 'agent' ? ('cli' as const) : pane.kind === 'bash' ? ('bash' as const) : 'vav',
        tabId: pane.tabId || undefined,
        agentId: pane.agentId,
        kind: pane.kind,
        dirKey: pane.dirKey,
        dirLabel: pane.dirLabel,
        createdAt: pane.createdAt
      })),
      live.length
    )
  } finally {
    syncSleepBlocker()
  }
}

/** Last built app menu — Windows/Linux attach it per-window so the bar stays visible. */
let appMenu: Menu | null = null

/**
 * On Windows/Linux the menu is a window chrome strip (not the macOS menu bar).
 * With `titleBarStyle: 'hidden'` Electron often auto-hides it — force it on.
 */
function applyMenuBar(window: BrowserWindow): void {
  if (IS_MAC || window.isDestroyed()) return
  if (appMenu) window.setMenu(appMenu)
  window.setAutoHideMenuBar(false)
  window.setMenuBarVisibility(true)
}

function currentKeyBindings() {
  return resolveKeyBindings(settingsStore.get().keyBindings)
}

function rebuildAppChrome(): void {
  appMenu = buildAppMenu(
    sendMenuCommand,
    () => openSettingsWindow(),
    newDetachedSession,
    currentKeyBindings()
  )
  Menu.setApplicationMenu(appMenu)
  for (const window of BrowserWindow.getAllWindows()) {
    applyMenuBar(window)
  }
  refreshTraySessions()
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setTitle(t('app.settingsWindowTitle'))
  }
}

function handleAgentEvent(event: TurnEvent): void {
  sendToWorkspaceWindows(IPC.agentEvent, event, event.conversationId)
  const conversation = conversationStore.get(event.conversationId)
  const title = conversation?.title ?? t('window.sessionFallback')

  if (event.type === 'start') {
    activeTurns.set(event.conversationId, 'running')
    refreshTraySessions()
    pushTokenUsageIfOpen(event.conversationId)
    return
  }
  if (event.type === 'phase') {
    if (event.phase === 'awaiting-user') {
      activeTurns.set(event.conversationId, 'paused')
      refreshTraySessions()
      pushTokenUsageIfOpen(event.conversationId)
    } else if (event.phase === 'working' || event.phase === 'thinking' || event.phase === 'outputting') {
      activeTurns.set(event.conversationId, 'running')
      refreshTraySessions()
      pushTokenUsageIfOpen(event.conversationId)
      // User answered / approved — drop that session's Dock attention items.
      notifications.acknowledgeConversation(event.conversationId)
    }
    return
  }
  if (event.type === 'awaiting') {
    activeTurns.set(event.conversationId, 'paused')
    refreshTraySessions()
    const tool = event.block.tool
    const body = event.block.summary || event.block.tool
    if (tool === 'ask_user_question') {
      notifications.alertUser(
        'ask',
        event.conversationId,
        t('notify.awaitingAnswer', { title }),
        body,
        event.toolCallId
      )
    } else if (tool === 'plan_doc') {
      notifications.alertUser(
        'approval',
        event.conversationId,
        t('notify.awaitingApproval', { title }),
        body,
        event.toolCallId
      )
    } else if (tool === 'request') {
      notifications.alertUser(
        'request',
        event.conversationId,
        t('notify.requestConfirm', { title }),
        body,
        event.toolCallId
      )
    } else if (event.block.choices?.length) {
      notifications.alertUser(
        'approval',
        event.conversationId,
        t('notify.awaitingApproval', { title }),
        body,
        event.toolCallId
      )
    }
    return
  }
  if (event.type === 'usage') {
    pushTokenUsageIfOpen(event.conversationId)
    return
  }
  if (event.type === 'end') {
    activeTurns.delete(event.conversationId)
    const pane = trayPaneFromConversation(event.conversationId, 'chat')
    if (pane) markResultUnseen(pane)
    else refreshTraySessions()
    pushTokenUsageIfOpen(event.conversationId)
    if (!event.cancelled && !event.error) {
      const body = event.message.content || t('notify.turnComplete')
      notifications.alertUser('turn-complete', event.conversationId, title, body)
    } else {
      notifications.acknowledgeConversation(event.conversationId)
    }
  }
}

const changeSetStore = new ChangeSetStore()
changeSetStore.workingCopies = workingCopyService
const updateService = new UpdateService()
const documentRetrieval = new DocumentRetrievalService()
fileService.retrieval = documentRetrieval
const duckdb = new DuckDbService()
const webSearch = new WebSearchService()
const webFetch = new WebFetchService()
const skillService = new SkillService()
const quotaService = new QuotaService({
  onUpdate: () => {
    const id = tokenUsageConversationId
    if (id && id !== '_') pushTokenUsageIfOpen(id)
    const accountId = providerAccountConversationId
    if (accountId && accountId !== '_') void pushProviderAccountIfOpen(accountId)
  }
})

const agent = new AgentRuntime({
  conversations: conversationStore,
  settings: settingsStore,
  secrets: secretStore,
  files: fileService,
  changeSets: changeSetStore,
  retrieval: documentRetrieval,
  duckdb,
  webSearch,
  webFetch,
  skills: skillService,
  fileSessions: fileSessionStore,
  emit: handleAgentEvent,
  onFileReadOnlyChange: (conversationId, readOnly) => {
    broadcast(IPC.fileSessionReadOnlyChanged, { sessionId: conversationId, readOnly })
    publishConversations()
  }
})

/** Structured CLI hosts (Claude stream-json, Codex app-server, ACP, …). */
const cliHost = new CliAgentHost({
  conversations: conversationStore,
  settings: settingsStore,
  changeSets: changeSetStore,
  emit: handleAgentEvent,
  logicalPath: (path) => workingCopyService.logicalPath(path),
  quota: {
    get: (host) => quotaService.get(host),
    forceRefresh: (host) => quotaService.forceRefresh(host)
  }
})

setInterval(() => cliHost.reapIdle(), 5 * 60_000)

function agentFor(conversationId: string): 'builtin' | 'cli' {
  return cliHost.owns(conversationId) ? 'cli' : 'builtin'
}

/** IPC to a renderer that may already be tearing down (close / HMR / pkill). */
function safeSend(contents: Electron.WebContents | null | undefined, channel: string, payload?: unknown): void {
  if (!contents || contents.isDestroyed()) return
  try {
    if (payload === undefined) contents.send(channel)
    else contents.send(channel, payload)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') return
    // Frame can vanish between isDestroyed check and send under load.
  }
}

function isAuxiliaryWindow(window: BrowserWindow): boolean {
  // Settings and the warm token-usage panel never host PTYs / file trees /
  // streaming transcripts — skip them on the hot path.
  if (settingsWindow && !settingsWindow.isDestroyed() && window === settingsWindow) return true
  if (tokenUsageWindow && !tokenUsageWindow.isDestroyed() && window === tokenUsageWindow) return true
  if (providerAccountWindow && !providerAccountWindow.isDestroyed() && window === providerAccountWindow) {
    return true
  }
  return false
}

/**
 * High-frequency turn / PTY / FS events.
 *
 * Deliver to the main shell, the matching detached session (when known), and
 * all file-preview companions (they may host an agent tray). Never fan out to
 * settings or the token-usage panel.
 */
function sendToWorkspaceWindows(
  channel: string,
  payload: unknown,
  conversationId?: string | null
): void {
  const delivered = new Set<number>()
  const deliver = (window: BrowserWindow | null | undefined): void => {
    if (!window || window.isDestroyed() || isAuxiliaryWindow(window)) return
    if (delivered.has(window.id)) return
    delivered.add(window.id)
    safeSend(window.webContents, channel, payload)
  }

  deliver(mainWindow)

  if (conversationId) {
    deliver(detachedWindows.get(conversationId))
  } else {
    for (const window of detachedWindows.values()) deliver(window)
  }

  for (const window of previewWindows.values()) deliver(window)
}

/** Settings / conversation-list style events — every live window. */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    safeSend(window.webContents, channel, payload)
  }
}

/** Debounce twin fires (menu accelerator + before-input, or key repeat). */
let lastMenuCommandAt = 0
let lastMenuCommand: MenuCommand | null = null

/** Accelerators act on the window the user is actually looking at. */
function sendMenuCommand(command: MenuCommand): void {
  const now = Date.now()
  // close-context needs a longer window: before-input + menu often arrive
  // >80ms apart, and the second stroke used to close the window right after
  // Swarm reseeding the agent picker.
  const debounceMs = command === 'close-context' ? 400 : 80
  if (command === lastMenuCommand && now - lastMenuCommandAt < debounceMs) return
  lastMenuCommand = command
  lastMenuCommandAt = now
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (!target || target.isDestroyed()) return
  if (target === settingsWindow) {
    // Settings runs a light renderer with no menu-command router; ⌘W still closes it.
    if (command === 'close-context') hideSettingsWindow()
    return
  }
  if (command === 'close-context' && isAppClipBrowserWindow(target)) {
    target.close()
    return
  }
  safeSend(target.webContents, IPC.menuCommand, command)
}

/**
 * Re-dispatch product shortcuts when focus is inside xterm (or any input).
 * Menu accelerators alone often never fire once the terminal helper textarea
 * owns keyboard focus — `before-input-event` runs first and is reliable.
 */
function wireMenuAccelerators(contents: Electron.WebContents): void {
  contents.on('before-input-event', (event, input) => {
    // Branded vav.app often reports isPackaged=true, so the View → DevTools menu
    // item may be missing — keep ⌥⌘I / Ctrl+Shift+I available in dev anyway.
    if (isDevRuntime() && input.type === 'keyDown' && (input.key === 'I' || input.key === 'i')) {
      const macDevtools = process.platform === 'darwin' && input.meta && input.alt && !input.control
      const winDevtools =
        process.platform !== 'darwin' && input.control && input.shift && !input.meta
      if (macDevtools || winDevtools) {
        event.preventDefault()
        contents.toggleDevTools()
        return
      }
    }

    const bindings = currentKeyBindings()
    if (matchesNewSessionWindow(input, bindings)) {
      event.preventDefault()
      newDetachedSession()
      return
    }
    const command = menuCommandFromInput(input, bindings)
    if (!command) return
    event.preventDefault()
    // open-settings is owned by main (native window), not the renderer list.
    if (command === 'open-settings') {
      openSettingsWindow()
      return
    }
    const host = BrowserWindow.fromWebContents(contents)
    if (command === 'close-context' && host && isAppClipBrowserWindow(host)) {
      host.close()
      return
    }
    sendMenuCommand(command)
  })
}

/** When a window dies, drop its PTY size votes so max-across-viewers updates. */
function wirePtyViewerLifecycle(contents: Electron.WebContents): void {
  const viewerId = contents.id
  contents.once('destroyed', () => {
    ptyManager.releaseViewer(viewerId)
  })
}

/** ⌘⇧↵ empty shells stay ephemeral until the user does something durable. */
function promoteEphemeralConversation(conversationId: string): void {
  if (!conversationId) return
  ephemeralConversations.delete(conversationId)
}

function publishConversations(): void {
  broadcast(IPC.convChanged, conversationStore.listMeta())
  // Sidebar title / swarm projection also drive the tray dropdown.
  refreshTraySessions()
}

/** Conversation ids with a live companion window — main UI must not dual-attach PTYs. */
function listDetachedConversationIds(): string[] {
  const ids: string[] = []
  for (const [id, win] of detachedWindows) {
    if (win && !win.isDestroyed()) ids.push(id)
  }
  return ids
}

function publishDetachedSessions(): void {
  broadcast(IPC.windowDetachedChanged, listDetachedConversationIds())
}

// ---------------------------------------------------------------------------
// Window chrome
// ---------------------------------------------------------------------------

/** The window's own fill, shown for the frame or two before the renderer paints. */
function windowBackground(): string {
  // Match mono light chrome (`--bg-window`); tinted washes are painted in CSS.
  // Uses nativeTheme after applyTheme(), so forced dark/light follow app settings.
  return nativeTheme.shouldUseDarkColors ? '#121213' : '#ececee'
}

/** `dark` | `light` for renderer bootstrap (query + early HTML paint). */
function windowThemeName(): 'dark' | 'light' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

/** Clear native fill so macOS vibrancy (NSVisualEffectView) can show through. */
const VIBRANCY_CLEAR = '#00000000'

/**
 * Paint html/body/#root before React/CSS arrive so dark-mode cold opens
 * (session / Settings / main) never flash system white.
 * Main window with vibrancy must stay transparent or it masks the system glass.
 */
function primeRendererShell(win: BrowserWindow, options?: { clear?: boolean }): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  const bg = options?.clear ? 'transparent' : windowBackground()
  const scheme = windowThemeName()
  const css = `html,body,#root{background:${bg}!important;margin:0;height:100%;color-scheme:${scheme}}`
  const inject = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    void win.webContents.insertCSS(css).catch(() => undefined)
  }
  inject()
  win.webContents.once('dom-ready', inject)
}

/**
 * macOS system glass (not CSS backdrop-filter).
 * `under-window` blurs the desktop through transparent regions — `sidebar`
 * alone is nearly invisible on recent macOS when the web layer was opaque.
 * Used by the main shell and the Settings nav column.
 */
function applyWindowVibrancy(win: BrowserWindow): void {
  if (!IS_MAC || win.isDestroyed()) return
  try {
    win.setBackgroundColor(VIBRANCY_CLEAR)
    win.setVibrancy('under-window', { animationDuration: 0 })
  } catch {
    try {
      win.setVibrancy('under-window')
    } catch {
      // Older Electron / non-mac
    }
  }
}

function clearWindowVibrancy(win: BrowserWindow): void {
  if (!IS_MAC || win.isDestroyed()) return
  try {
    win.setVibrancy(null)
    win.setBackgroundColor(windowBackground())
  } catch {
    // ignore
  }
}

function isVibrancyEnabled(): boolean {
  return IS_MAC && settingsStore.get().windowVibrancyEnabled !== false
}

function isVibrancyShellWindow(win: BrowserWindow): boolean {
  if (!IS_MAC || win.isDestroyed()) return false
  if (mainWindow && !mainWindow.isDestroyed() && win.id === mainWindow.id) return true
  if (settingsWindow && !settingsWindow.isDestroyed() && win.id === settingsWindow.id) {
    return true
  }
  return false
}

/** Apply or clear glass on one vibrancy-capable window from the settings toggle. */
function syncWindowMaterial(win: BrowserWindow): void {
  if (!IS_MAC || win.isDestroyed()) return
  if (isVibrancyEnabled()) applyWindowVibrancy(win)
  else clearWindowVibrancy(win)
  applyTrafficLights(win)
}

/** Apply or clear glass on main + Settings (create, toggle, theme repaint). */
function syncVibrancyShellWindows(): void {
  if (!IS_MAC) return
  if (mainWindow && !mainWindow.isDestroyed()) syncWindowMaterial(mainWindow)
  if (settingsWindow && !settingsWindow.isDestroyed()) syncWindowMaterial(settingsWindow)
}


/** Matches renderer `--toolbar-height` (sidebar / agent / file-preview chrome). */
const TOOLBAR_HEIGHT = 42
/** Main window + detached session column — narrowest useful shell. */
const MAIN_WINDOW_MIN_WIDTH = 400

function trafficLightOrigin(barHeight = TOOLBAR_HEIGHT): { x: number; y: number } {
  return { x: 12, y: Math.round((barHeight - 12) / 2) }
}

function applyTrafficLights(win: BrowserWindow, barHeight = TOOLBAR_HEIGHT): void {
  if (!IS_MAC || win.isDestroyed()) return
  try {
    win.setWindowButtonPosition(trafficLightOrigin(barHeight))
  } catch {
    // setWindowButtonPosition is macOS-only.
  }
}

/** `barHeight` matches the renderer's own title bar, so the two rows line up. */
function overlayColors(barHeight = TOOLBAR_HEIGHT): {
  color: string
  symbolColor: string
  height: number
} {
  const dark = nativeTheme.shouldUseDarkColors
  return {
    color: dark ? '#121213' : '#ececee',
    symbolColor: dark ? '#efeff1' : '#141416',
    height: barHeight
  }
}

/**
 * Frameless on both platforms, but for different reasons.
 *
 * macOS hides the bar and keeps the traffic lights, which the renderer's
 * titlebar leaves room for. Windows has no equivalent of `hiddenInset`, so it
 * gets a native overlay drawn on top of our own title bar instead — the only
 * way to keep the system buttons without also getting the system frame.
 */
function chrome(
  barHeight: number,
  options?: { vibrancyShell?: boolean }
): Electron.BrowserWindowConstructorOptions {
  if (IS_MAC) {
    // Main + Settings stay transparent so Appearance can toggle vibrancy live.
    // Companion / preview / token stay solid (avoids resize black-edge lag).
    // acceptFirstMouse: an inactive window's first click also hits the control
    // (native AppKit), instead of only focusing the window.
    if (options?.vibrancyShell) {
      return {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: trafficLightOrigin(barHeight),
        acceptFirstMouse: true,
        transparent: true,
        backgroundColor: VIBRANCY_CLEAR,
        ...(isVibrancyEnabled()
          ? {
              vibrancy: 'under-window' as const,
              visualEffectState: 'active' as const
            }
          : {})
      }
    }
    return {
      titleBarStyle: 'hiddenInset',
      // Vertically centred on the title bar, so the traffic lights sit on the
      // same line as the buttons at the other end of it.
      trafficLightPosition: trafficLightOrigin(barHeight),
      acceptFirstMouse: true,
      backgroundColor: windowBackground()
    }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(barHeight),
    backgroundColor: windowBackground(),
    acceptFirstMouse: true,
    // Keep File/Edit/View… visible; default + titleBarOverlay often Alt-hides it.
    autoHideMenuBar: false
  }
}

/** The system chrome does not follow `nativeTheme` on its own once overridden. */
function repaintChrome(): void {
  const background = windowBackground()
  // Dock tile follows system/app light·dark (icon.png vs icon-dark.png).
  applyDockIcon()
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    // Main + Settings: respect the vibrancy toggle (do not force solid chrome).
    if (isVibrancyShellWindow(window)) {
      syncWindowMaterial(window)
      continue
    }
    window.setBackgroundColor(background)
    if (IS_MAC) continue
    try {
      // Height is omitted so the overlay keeps whatever it was created with.
      const { color, symbolColor } = overlayColors()
      window.setTitleBarOverlay({ color, symbolColor })
    } catch {
      // Only set on windows created with an overlay; nothing to do otherwise.
    }
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

/**
 * Never let hyperlinks navigate the BrowserWindow away from the app shell.
 *
 * - Chat / agent log / tool cards: open http(s) in the system browser.
 * - File previews (MD/office/HTML): renderer preventDefaults on click, so
 *   `will-navigate` usually never fires for those surfaces.
 */
function wireExternalLinks(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    // Agent responses, logs, tool cards — open outside the app.
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
  })
}

/** The app's own entry (dev server or packaged file://), not a chat hyperlink. */
function isRendererUrl(url: string): boolean {
  const devBase = process.env.ELECTRON_RENDERER_URL
  if (devBase && (url === devBase || url.startsWith(devBase + '/') || url.startsWith(devBase + '?'))) {
    return true
  }
  return url.startsWith('file:')
}

/** Shared renderer prefs — keep timers/rAF alive while the window is hidden. */
function rendererPrefs(extra: Electron.WebPreferences = {}): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
    // Hidden main window / tray / background turns must keep streaming.
    backgroundThrottling: false,
    ...extra
  }
}

const PREVIEW_IDLE_MS = 5 * 60 * 1000
const PREVIEW_MAX_OPEN = 6
/** Default preview window width — see the note where it is clamped to the display. */
const PREVIEW_DEFAULT_WIDTH = 880
/**
 * Hidden warm shells kept ready so the next open skips BrowserWindow+load.
 * Two, not one: a fresh shell needs ~1s of renderer boot before
 * `previewShellReady`, and opening a second file inside that window used to
 * fall all the way back to a cold create.
 */
const PREVIEW_WARM_POOL = 2
/** Let the just-shown window paint before a replacement shell steals CPU. */
const PREVIEW_POOL_REFILL_MS = 200

/** Preview windows that must confirm before close (unsaved edit). */
const previewCloseGuards = new WeakSet<BrowserWindow>()
/** Idle warm shells (loaded, hidden, no path claimed). */
const warmPreviewPool: BrowserWindow[] = []
/** Warm shell finished renderer bootstrap. */
const warmPreviewReady = new WeakSet<BrowserWindow>()
/** Monotonic navigate seq so late IPC cannot clobber a newer open. */
let previewNavigateSeq = 0

/** Close an unfocused preview after idle; cap how many stay around. */
function wirePreviewLifecycle(window: BrowserWindow, path: string): void {
  let idleTimer: NodeJS.Timeout | null = null
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isFocused() && !previewCloseGuards.has(window)) {
        afterLeavingFullscreen(window, () => {
          if (!window.isDestroyed() && !window.isFocused()) {
            parkWarmPreviewShell(window)
          }
        })
      }
    }, PREVIEW_IDLE_MS)
  }
  // Replace prior blur/focus/close handlers when reclaiming a warm shell.
  window.removeAllListeners('blur')
  window.removeAllListeners('focus')
  window.removeAllListeners('close')
  window.on('blur', armIdle)
  window.on('focus', () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  })
  // Unsaved guard → park into warm pool (hide) instead of destroy when clean.
  window.on('close', (event) => {
    if (quitting) return
    if (fullscreenCloseAllowed.has(window)) {
      fullscreenCloseAllowed.delete(window)
      return
    }
    if (previewCloseGuards.has(window)) {
      event.preventDefault()
      safeSend(window.webContents, IPC.previewCloseAttempt)
      return
    }
    if (window.isFullScreen()) {
      event.preventDefault()
      window.once('leave-full-screen', () => {
        if (window.isDestroyed()) return
        parkWarmPreviewShell(window)
      })
      window.setFullScreen(false)
      return
    }
    // Recycle into the warm pool — next open skips cold start.
    event.preventDefault()
    if (idleTimer) clearTimeout(idleTimer)
    parkWarmPreviewShell(window)
  })

  // Cap open previews: park the oldest unfocused ones first.
  while (previewWindows.size > PREVIEW_MAX_OPEN) {
    let victimPath: string | null = null
    let victim: BrowserWindow | null = null
    for (const [otherPath, other] of previewWindows) {
      if (otherPath === path || other.isDestroyed()) continue
      if (!other.isFocused()) {
        victimPath = otherPath
        victim = other
        break
      }
    }
    if (!victimPath || !victim) break
    previewWindows.delete(victimPath)
    afterLeavingFullscreen(victim, () => {
      if (!victim.isDestroyed()) parkWarmPreviewShell(victim)
    })
  }
}

/**
 * Fullscreen hides the traffic-light gutter; tell the renderer so it can drop
 * the reserved leading inset that would otherwise read as empty space.
 */
function wireFullscreenState(window: BrowserWindow): void {
  const publish = (): void => {
    if (window.isDestroyed()) return
    safeSend(window.webContents, IPC.windowFullscreen, window.isFullScreen())
  }
  window.on('enter-full-screen', publish)
  window.on('leave-full-screen', publish)
  window.webContents.on('did-finish-load', publish)
}

/**
 * macOS leaves a blank black Space if a window is hidden/destroyed while still
 * in native fullscreen. Always exit fullscreen first, then run the action.
 */
function afterLeavingFullscreen(win: BrowserWindow, next: () => void): void {
  if (win.isDestroyed()) return
  if (!win.isFullScreen()) {
    next()
    return
  }
  win.once('leave-full-screen', () => {
    if (!win.isDestroyed()) next()
  })
  win.setFullScreen(false)
}

function hideLeavingFullscreen(win: BrowserWindow): void {
  afterLeavingFullscreen(win, () => {
    if (!win.isDestroyed()) win.hide()
  })
}

/**
 * Raycast-style reveal: paint a frame *before* the window becomes visible so
 * hotkey summon never flashes empty chrome (their WebKit `_doAfterNextPresentationUpdate`).
 *
 * Electron equivalent: keep `paintWhenInitiallyHidden`, wait two rAFs in the
 * renderer while still hidden, then `show()`. Caps wait so a stuck renderer
 * cannot block the hotkey.
 */
const REVEAL_PAINT_BUDGET_MS = 64

/**
 * Windows that have been through a hidden → shown reveal.
 *
 * Only the *second* reveal onwards is a summon. A window opening for the first
 * time (new companion, detach-to-window) is new content arriving, and its
 * entrance animations should play — suppressing them there is why detaching a
 * session used to land at rest.
 */
const revealedWindows = new WeakSet<BrowserWindow>()

async function waitForRendererPaint(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  if (win.webContents.isLoadingMainFrame()) return
  const summon = revealedWindows.has(win)
  revealedWindows.add(win)
  // `revealing` spans the off-screen paint (entrances wait it out so they are
  // not spent while hidden); `summoning` additionally says the user has seen
  // this window before, so its chrome must come back at rest.
  const script = `(function(){
    try {
      document.documentElement.dataset.revealing = '1';
      ${summon ? "document.documentElement.dataset.summoning = '1';" : ''}
      var prev = window.__vavSummonClear;
      if (prev) window.clearTimeout(prev);
      window.__vavSummonClear = window.setTimeout(function(){
        try {
          delete document.documentElement.dataset.summoning;
          delete document.documentElement.dataset.revealing;
        } catch (e) {}
      }, 160);
    } catch (e) {}
    return new Promise(function(resolve){
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){ resolve(true); });
      });
    });
  })()`
  try {
    await Promise.race([
      win.webContents.executeJavaScript(script, true),
      new Promise<void>((resolve) => setTimeout(resolve, REVEAL_PAINT_BUDGET_MS))
    ])
  } catch {
    // Mid-reload / torn-down frame — show anyway.
  }
}

/**
 * The window is on screen: release entrances that were waiting for it. The
 * renderer's own timeout is only a fallback for a torn-down frame — leaving it
 * to fire would start the build-up a beat after the window landed.
 */
function markRevealDone(win: BrowserWindow): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents
    .executeJavaScript(
      `try { delete document.documentElement.dataset.revealing } catch (e) {}`,
      true
    )
    .catch(() => {
      // Navigated away mid-reveal — the fallback timeout clears it.
    })
}

async function revealBrowserWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  // Steal focus first so Space switching starts before pixels land.
  app.focus({ steal: true })
  try {
    if (isVibrancyShellWindow(win)) syncWindowMaterial(win)
    else win.setBackgroundColor(windowBackground())
  } catch {
    // ignore
  }
  if (win.isMinimized()) win.restore()
  if (win.isVisible()) {
    win.moveTop()
    win.focus()
    return
  }
  await waitForRendererPaint(win)
  if (win.isDestroyed()) return
  win.show()
  win.focus()
  markRevealDone(win)
}

/** Windows that may proceed with close after a deferred leave-full-screen. */
const fullscreenCloseAllowed = new WeakSet<BrowserWindow>()

/**
 * On `close`, if still fullscreen, cancel and exit FS first, then re-close.
 * Pair with real destroy (preview, non-Mac main, etc.) — not hide-on-close.
 */
function wireCloseLeavingFullscreen(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (quitting || win.isDestroyed()) return
    if (fullscreenCloseAllowed.has(win)) {
      fullscreenCloseAllowed.delete(win)
      return
    }
    if (!win.isFullScreen()) return
    event.preventDefault()
    win.once('leave-full-screen', () => {
      if (win.isDestroyed()) return
      fullscreenCloseAllowed.add(win)
      win.close()
    })
    win.setFullScreen(false)
  })
}

function wirePopupDismiss(window: BrowserWindow): void {
  // Hide-on-close and Space hops leave AppKit menus floating unless we close them.
  window.on('blur', () => closeActiveNativePopup())
  window.on('hide', () => closeActiveNativePopup())
  window.on('closed', () => closeActiveNativePopup())
}

function createWindow(): BrowserWindow {
  const icon = loadAppIcon()
  const snapshotting = Boolean(process.env.VAV_SNAPSHOT)
  const window = new BrowserWindow({
    width: snapshotting ? 1440 : 720,
    height: snapshotting ? 900 : 820,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: 560,
    show: false,
    // Paint while hidden so ready-to-show / hotkey reveal has a real frame.
    paintWhenInitiallyHidden: true,
    title: APP_NAME,
    icon,
    ...chrome(TOOLBAR_HEIGHT, { vibrancyShell: IS_MAC }),
    webPreferences: rendererPrefs()
  })
  applyMenuBar(window)
  wirePopupDismiss(window)
  applyTrafficLights(window)

  window.once('ready-to-show', () => {
    applyTrafficLights(window)
    void revealBrowserWindow(window)
  })

  // ⌘W / traffic light / Win close only hide the window: agent turns and PTYs
  // must survive (README §2.9). Only an explicit Quit tears things down.
  //
  // macOS re-summons via Dock; Windows via the always-on tray icon.
  const hideOnClose = (IS_MAC || IS_WIN) && !snapshotting
  if (hideOnClose) {
    window.on('close', (event) => {
      if (quitting) return
      event.preventDefault()
      // Must leave native fullscreen before hide, or macOS keeps a black Space.
      hideLeavingFullscreen(window)
    })
  } else {
    // Linux / snapshot: real close — still leave FS first.
    wireCloseLeavingFullscreen(window)
  }

  wireExternalLinks(window.webContents)
  wireMenuAccelerators(window.webContents)
  wirePtyViewerLifecycle(window.webContents)
  wireFullscreenState(window)

  // Log even when the branded Electron binary reports isPackaged=true (common in
  // local `vav.app … /path/to/repo` launches).
  window.webContents.on('console-message', (event) => {
    console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
  })
  window.webContents.on('preload-error', (_event, path, error) => {
    console.error('[preload error]', path, error)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('[did-fail-load]', code, description, url)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[render-process-gone]', details.reason, details.exitCode)
  })

  installSnapshotHook(window)
  loadRenderer(window)

  return window
}

/** One renderer bundle serves both windows; `view` picks which one to mount. */
function loadRenderer(window: BrowserWindow, query: Record<string, string> = {}): void {
  // Always stamp theme so index.html can paint the matching wash before CSS.
  const withTheme = { theme: windowThemeName(), ...query }
  const search = new URLSearchParams(withTheme).toString()
  // Main (no view=) and Settings use system vibrancy — keep the page clear.
  // Session / preview / token stay opaque.
  const useClear = IS_MAC && (!query.view || query.view === 'settings')
  primeRendererShell(window, { clear: useClear })
  try {
    if (useClear) {
      // createWindow calls loadRenderer before `mainWindow = …` is assigned.
      if (isVibrancyEnabled()) applyWindowVibrancy(window)
      else clearWindowVibrancy(window)
    } else {
      window.setBackgroundColor(windowBackground())
    }
  } catch {
    // ignore
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL + (search ? `?${search}` : ''))
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { query: withTheme })
  }
}

function openSettingsWindow(view: SettingsView = 'api', agentId?: string): void {
  void serveAnalysisSnapshot({ refresh: false }).catch((err) => {
    console.error('[analysis] prefetch failed', err)
  })
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    safeSend(settingsWindow.webContents, IPC.settingsView, { view, agentId })
    void revealBrowserWindow(settingsWindow)
    return
  }

  ensureSettingsWindow(view, true, agentId)
}

/**
 * Keep Settings warm like the token panel: hide on close, show instantly next time.
 */
function ensureSettingsWindow(
  view: SettingsView = 'api',
  showNow: boolean,
  agentId?: string
): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (showNow) openSettingsWindow(view, agentId)
    return
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 620,
    minHeight: 440,
    show: false,
    paintWhenInitiallyHidden: true,
    title: t('app.settingsWindowTitle'),
    icon: loadAppIcon(),
    // Matches --toolbar-height / .settings-head so traffic lights align.
    ...chrome(TOOLBAR_HEIGHT, { vibrancyShell: IS_MAC }),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: rendererPrefs()
  })
  applyMenuBar(settingsWindow)
  applyTrafficLights(settingsWindow)

  settingsWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide()
  })
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  wireExternalLinks(settingsWindow.webContents)

  if (!app.isPackaged) {
    settingsWindow.webContents.on('console-message', (event) => {
      console.log(`[settings:${event.level}] ${event.message}`)
    })
  }

  if (showNow) {
    settingsWindow.once('ready-to-show', () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        void revealBrowserWindow(settingsWindow)
      }
    })
  }
  loadRenderer(settingsWindow, {
    view: 'settings',
    category: view,
    ...(agentId ? { agentId } : {})
  })
}

/** Hide (don't destroy) so the next open is instant. */
function hideSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide()
}

function warmSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) return
  ensureSettingsWindow('api', false)
}

/**
 * A narrow column parked against the right edge of the desktop work area.
 *
 * Place on a normal desktop display (cursor / primary) — not the display of a
 * fullscreen main window — so ⌘⇧↵ lands on the desktop Space, not inside
 * another app’s fullscreen Space.
 */
function detachedBounds(cascade: number): {
  width: number
  height: number
  x: number
  y: number
} {
  // Prefer the display under the cursor; fall back to primary desktop work area.
  // Avoid anchoring to a fullscreen main window’s display — workArea there is
  // the fullscreen Space, which is exactly where we do not want to open.
  let area = screen.getPrimaryDisplay().workArea
  try {
    area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  } catch {
    // keep primary
  }

  // Narrowest useful companion column (matches main-window minWidth).
  const width = Math.min(MAIN_WINDOW_MIN_WIDTH, area.width - 40)
  const height = Math.min(760, area.height - 60)
  const step = (cascade % 5) * 26

  return {
    width,
    height,
    x: area.x + area.width - width - 28 - step,
    y: area.y + Math.max(0, Math.round((area.height - height) / 2) - 20) + step
  }
}

/**
 * Bring a detached companion forward with a single show/focus pass.
 *
 * Avoid stacking raise calls and avoid toggling `setVisibleOnAllWorkspaces`
 * when vav is already the active app — each of those re-composites the window
 * shadow (the flicker users saw on ⌘⇧↵). Only hop Spaces when we are not the
 * frontmost app (e.g. global hotkey from another fullscreen app).
 */
function raiseDetachedWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return Promise.resolve()
  if (win.isMinimized()) win.restore()

  // Only hop Spaces when another app is frontmost (global ⌘⇧↵). When vav is
  // already active, a plain show+focus avoids shadow re-composite flicker.
  const needSpaceHop = IS_MAC && !app.isActive()

  const finish = (): void => {
    if (win.isDestroyed()) return
    try {
      win.setBackgroundColor(windowBackground())
    } catch {
      // ignore
    }
    if (needSpaceHop) {
      try {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
      } catch {
        // older Electron / non-mac
      }
    }
    win.show()
    try {
      win.moveTop()
    } catch {
      // ignore
    }
    if (needSpaceHop) app.focus({ steal: true })
    if (!win.isDestroyed()) win.focus()
    markRevealDone(win)
    // New GPU surface can leave sibling windows on a stale compositor frame
    // (xterm canvas + vibrancy) until the next content write.
    scheduleVisibleWindowRepaint(win)
    if (needSpaceHop) {
      setTimeout(() => {
        if (win.isDestroyed()) return
        try {
          win.setVisibleOnAllWorkspaces(false)
        } catch {
          // ignore
        }
      }, 300)
    }
  }

  if (win.isVisible()) {
    finish()
    return Promise.resolve()
  }
  // Cold companion: paint a frame while still hidden, then raise.
  return waitForRendererPaint(win).then(finish)
}

/**
 * Force visible windows to paint after a sibling BrowserWindow is created.
 * Chromium/macOS often keeps the previous compositor textures until the next
 * write; streaming text hides it, idle transcripts and xterm canvases do not.
 */
function repaintVisibleWindows(except?: BrowserWindow | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (except && win.id === except.id) continue
    if (win.isDestroyed() || !win.isVisible()) continue
    safeSend(win.webContents, IPC.windowRepaint)
  }
}

function scheduleVisibleWindowRepaint(except?: BrowserWindow | null): void {
  const run = (): void => {
    if (except && except.isDestroyed()) {
      repaintVisibleWindows()
      return
    }
    repaintVisibleWindows(except)
  }
  run()
  setTimeout(run, 80)
  setTimeout(run, 260)
}

function isWindowInPlay(win: BrowserWindow | null | undefined): boolean {
  return !!(win && !win.isDestroyed() && (win.isVisible() || win.isMinimized()))
}

function moveWindowTop(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) {
    try {
      win.restore()
    } catch {
      // ignore
    }
  }
  try {
    win.moveTop()
  } catch {
    // ignore
  }
}

/**
 * Fixed Z-order for Dock / second-instance activate (bottom → top):
 *   main shell < Quick Chat (detached session) < Settings
 *
 * `focus()` raises its target, so call this *after* focusing the activate
 * window — higher layers are re-pinned with `moveTop` only (no focus steal).
 */
function enforceAppZOrder(focused: BrowserWindow | null): void {
  if (isWindowInPlay(mainWindow)) moveWindowTop(mainWindow!)

  const quickChats = [...detachedWindows.values()].filter((w) => isWindowInPlay(w))
  for (const win of quickChats) {
    if (focused && win.id === focused.id) continue
    moveWindowTop(win)
  }
  if (focused && quickChats.some((w) => w.id === focused.id)) {
    moveWindowTop(focused)
  }

  if (isWindowInPlay(settingsWindow)) moveWindowTop(settingsWindow!)
}

/** Strip message bodies for IPC seed (sidebar meta shape). */
function conversationToMeta(conversation: Conversation): ConversationMeta {
  const {
    messages: _messages,
    tokenHistory: _history,
    cacheCreatedAt: _created,
    cacheExpiresAt: _expires,
    compactions: _compactions,
    ...meta
  } = conversation
  void _messages
  void _history
  void _created
  void _expires
  void _compactions
  return meta
}

function bindDetachedWindow(window: BrowserWindow, conversationId: string): void {
  for (const [id, win] of detachedWindows) {
    if (win === window && id !== conversationId) detachedWindows.delete(id)
  }
  detachedWindows.set(conversationId, window)
  detachedWindowIds.set(window, conversationId)
  notifications.noteConversationView(window.id, conversationId)
}

function unbindDetachedWindow(window: BrowserWindow): string | null {
  const id = detachedWindowIds.get(window) ?? null
  if (id) {
    const mapped = detachedWindows.get(id)
    if (mapped === window) detachedWindows.delete(id)
    detachedWindowIds.delete(window)
  }
  return id
}

/**
 * Keep the session companion URL in sync with the claimed conversation.
 * Warm shells load as `?view=session&warm=1`; without this, Cmd+R reloads that
 * URL and the renderer never re-claims — blank “hung” quick-chat window.
 */
function syncSessionShellQuery(
  window: BrowserWindow,
  opts: { conversationId: string | null }
): void {
  if (window.isDestroyed()) return
  const wc = window.webContents
  if (wc.isDestroyed()) return
  const conversationId = opts.conversationId ?? ''
  const script = `(() => {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('view', 'session');
      if (${JSON.stringify(conversationId)}) {
        u.searchParams.set('conversationId', ${JSON.stringify(conversationId)});
        u.searchParams.delete('warm');
      } else {
        u.searchParams.set('warm', '1');
        u.searchParams.delete('conversationId');
        u.searchParams.delete('empty');
        u.searchParams.delete('collapseTools');
      }
      const next = u.pathname + u.search + u.hash;
      if (location.pathname + location.search + location.hash !== next) {
        history.replaceState(null, '', next);
      }
    } catch (_) {}
  })();`
  const run = (): void => {
    if (window.isDestroyed() || wc.isDestroyed()) return
    void wc.executeJavaScript(script).catch(() => undefined)
  }
  if (wc.isLoadingMainFrame()) {
    wc.once('did-finish-load', run)
  } else {
    run()
  }
}

/** Re-push claim after refresh / warm reclaim. */
function pushDetachedSessionClaim(window: BrowserWindow, conversationId: string): void {
  const conversation = conversationStore.get(conversationId)
  if (!conversation || window.isDestroyed()) return
  sessionNavigateSeq += 1
  safeSend(window.webContents, IPC.sessionNavigate, {
    conversationId,
    meta: conversationToMeta(conversation),
    empty: conversation.messages.length === 0,
    openSeq: sessionNavigateSeq,
    requestedAt: Date.now()
  })
  syncSessionShellQuery(window, { conversationId })
}

/**
 * Empty ephemeral ⌘⇧↵ shells die on close; anything with messages / CLI / PTY stays.
 */
function disposeEphemeralIfEmpty(conversationId: string): boolean {
  if (!ephemeralConversations.delete(conversationId)) return false
  const stale = conversationStore.get(conversationId)
  const agentActive =
    (!!stale?.agentBinaryName && stale.agentBinaryName !== 'vav') || !!stale?.cliHost
  const hasPty = ptyManager.hasConversation(conversationId)
  if (stale && stale.messages.length === 0 && !agentActive && !hasPty) {
    const removed = conversationStore.remove([conversationId])
    for (const id of removed) {
      agent.disposeConversation(id)
      cliHost.dispose(id)
      swarmSession.clearForConversation(id)
      ptyManager.killForConversation(id)
      fileService.unwatch(id)
    }
    if (removed.length) conversationStore.flush()
    return removed.length > 0
  }
  return false
}

function createSessionBrowserWindow(opts: {
  show: boolean
  title?: string
  bounds?: { width: number; height: number; x: number; y: number }
}): BrowserWindow {
  const bounds = opts.bounds ?? detachedBounds(0)
  const window = new BrowserWindow({
    ...bounds,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: 420,
    show: opts.show,
    paintWhenInitiallyHidden: true,
    title: opts.title ?? 'Session',
    icon: loadAppIcon(),
    ...chrome(TOOLBAR_HEIGHT),
    parent: undefined,
    webPreferences: rendererPrefs()
  })
  applyMenuBar(window)
  applyTrafficLights(window)
  wirePopupDismiss(window)
  wireExternalLinks(window.webContents)
  wireMenuAccelerators(window.webContents)
  wirePtyViewerLifecycle(window.webContents)
  wireFullscreenState(window)
  if (!app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[session:${event.level}] ${event.message}`)
    })
  }
  return window
}

function takeWarmSessionShell(): BrowserWindow | null {
  const notReady: BrowserWindow[] = []
  while (warmSessionPool.length > 0) {
    const win = warmSessionPool.pop()!
    if (win.isDestroyed()) continue
    if (!warmSessionReady.has(win)) {
      notReady.push(win)
      continue
    }
    warmSessionPool.push(...notReady)
    return win
  }
  warmSessionPool.push(...notReady)
  return null
}

function hasWarmSessionInFlight(): boolean {
  return warmSessionPool.some((w) => !w.isDestroyed())
}

/**
 * Prefer a ready shell; if one is still booting, wait up to `budgetMs` instead
 * of spawning a competing cold window.
 */
async function acquireWarmSessionShell(budgetMs: number): Promise<BrowserWindow | null> {
  const ready = takeWarmSessionShell()
  if (ready) return ready

  if (!hasWarmSessionInFlight()) {
    try {
      warmSessionShellPool()
    } catch {
      // non-fatal
    }
  }
  if (!hasWarmSessionInFlight()) return null

  sessionOpenMark('open:warm-wait')
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const win = takeWarmSessionShell()
    if (win) {
      sessionOpenMark('open:warm-wait-hit')
      return win
    }
    await new Promise<void>((r) => setTimeout(r, 20))
  }
  sessionOpenMark('open:warm-wait-miss')
  return null
}

/** Preload hidden session shells so ⌘⇧↵ skips BrowserWindow+renderer boot. */
function warmSessionShellPool(): void {
  const live = warmSessionPool.filter((w) => !w.isDestroyed())
  warmSessionPool.length = 0
  warmSessionPool.push(...live)
  while (warmSessionPool.length < SESSION_WARM_POOL) {
    const window = createSessionBrowserWindow({ show: false })
    warmSessionPool.push(window)
    window.on('closed', () => {
      const idx = warmSessionPool.indexOf(window)
      if (idx >= 0) warmSessionPool.splice(idx, 1)
      warmSessionReady.delete(window)
      unbindDetachedWindow(window)
    })
    loadRenderer(window, { view: 'session', warm: '1' })
    sessionOpenMark('warm-shell-created')
    // Hidden warm shells still allocate a compositor surface (~200ms after
    // ⌘⇧↵). Visible siblings must re-blit or they keep the pre-alloc frame.
    scheduleVisibleWindowRepaint(window)
  }
}

/**
 * Recycle a companion into the warm pool (hide) so the next ⌘⇧↵ is instant.
 * Full pool → destroy.
 */
function parkWarmSessionShell(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (warmSessionPool.includes(window)) return
  if (warmSessionPool.length >= SESSION_WARM_POOL) {
    afterLeavingFullscreen(window, () => {
      if (!window.isDestroyed()) {
        fullscreenCloseAllowed.add(window)
        window.destroy()
      }
    })
    return
  }
  try {
    window.setTitle('Session')
    if (window.isVisible()) window.hide()
  } catch {
    // ignore
  }
  warmSessionPool.push(window)
  sessionNavigateSeq += 1
  safeSend(window.webContents, IPC.sessionNavigate, {
    conversationId: '',
    openSeq: sessionNavigateSeq
  })
  syncSessionShellQuery(window, { conversationId: null })
  setTimeout(() => warmSessionShellPool(), SESSION_POOL_REFILL_MS)
}

/**
 * Close path for companion windows: unbind, maybe drop empty ephemeral, park.
 */
function finalizeDetachedClose(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  const conversationId = unbindDetachedWindow(window)
  publishDetachedSessions()
  if (conversationId) disposeEphemeralIfEmpty(conversationId)
  // Sidebar refresh off the critical path (park/hide first).
  setImmediate(() => publishConversations())
  parkWarmSessionShell(window)
}

function wireDetachedSessionLifecycle(window: BrowserWindow): void {
  // Reclaim may re-wire a warm shell that already had listeners.
  window.removeAllListeners('close')
  window.removeAllListeners('closed')

  window.on('close', (event) => {
    if (quitting || window.isDestroyed()) return
    if (fullscreenCloseAllowed.has(window)) {
      fullscreenCloseAllowed.delete(window)
      return
    }
    if (window.isFullScreen()) {
      event.preventDefault()
      window.once('leave-full-screen', () => {
        if (!window.isDestroyed()) finalizeDetachedClose(window)
      })
      window.setFullScreen(false)
      return
    }
    event.preventDefault()
    finalizeDetachedClose(window)
  })

  window.on('closed', () => {
    const id = unbindDetachedWindow(window)
    if (id) {
      publishDetachedSessions()
      disposeEphemeralIfEmpty(id)
      setImmediate(() => publishConversations())
    }
    const idx = warmSessionPool.indexOf(window)
    if (idx >= 0) warmSessionPool.splice(idx, 1)
    warmSessionReady.delete(window)
  })
}

/**
 * Opens one conversation in its own window: transcript, tools and composer,
 * no sidebar.
 *
 * Prefers a warm hidden shell + in-place navigate (⌘⇧↵ critical path).
 * If a shell is still booting, waits briefly instead of cold-racing it.
 * The main window is deliberately left alone — its selection, transcript,
 * bounds, and PTY size votes are independent.
 */
async function openDetachedWindow(
  conversationId: string,
  options: { collapseTools?: boolean; requestedAt?: number } = {}
): Promise<BrowserWindow | null> {
  const requestedAt = options.requestedAt ?? Date.now()
  sessionOpenT0 = requestedAt
  sessionOpenMark('open:start', conversationId)

  const existing = detachedWindows.get(conversationId)
  if (existing && !existing.isDestroyed()) {
    sessionOpenMark('open:reuse-focus', conversationId)
    raiseDetachedWindow(existing)
    // Restore the surface the session was on (CLI Agents vs VAV composer).
    // Always forcing focus-composer left CLI mode visually stuck / unfocused.
    const listed = ptyManager.listForConversation(conversationId)
    const surface: 'vav' | 'cli' = listed.layouts.cliMode === true ? 'cli' : 'vav'
    safeSend(existing.webContents, IPC.cliOpen, {
      conversationId,
      toast: null,
      surface
    })
    return existing
  }

  const conversation = conversationStore.get(conversationId)
  if (!conversation) return null

  // Snapshot main bounds so we can assert we never mutated them (debug aid).
  const mainBoundsBefore =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null

  const bounds = detachedBounds(detachedWindows.size)
  const meta = conversationToMeta(conversation)
  const empty = conversation.messages.length === 0

  // Ready shell, or wait for an in-flight warm boot (never dual-load).
  const warm = await acquireWarmSessionShell(SESSION_WARM_WAIT_MS)
  const window =
    warm ??
    createSessionBrowserWindow({
      show: false,
      title: conversation.title,
      bounds
    })

  if (warm) {
    sessionOpenMark('open:warm-claim', conversationId)
    try {
      window.setBounds(bounds)
      window.setTitle(conversation.title)
    } catch {
      // geometry races
    }
  } else {
    sessionOpenMark('open:cold-create', conversationId)
  }

  // Space membership is handled in raiseDetachedWindow (brief join-desktops,
  // then pin). Do not set visibleOnFullScreen here — that causes the flash
  // when switching into other apps’ fullscreen Spaces.

  bindDetachedWindow(window, conversationId)
  // Main window must drop its live agent xterm for this id (exclusive PTY view).
  publishDetachedSessions()
  wireDetachedSessionLifecycle(window)

  sessionNavigateSeq += 1
  const openSeq = sessionNavigateSeq
  const payload = {
    conversationId,
    meta,
    empty,
    collapseTools: !!options.collapseTools,
    openSeq,
    requestedAt
  }

  if (warm) {
    safeSend(window.webContents, IPC.sessionNavigate, payload)
    // Persist id in the URL so Cmd+R / reload can cold-claim the same session.
    syncSessionShellQuery(window, { conversationId })
    // Shell is already bootstrapped — raise now; renderer focuses composer.
    raiseDetachedWindow(window)
    sessionOpenMark('open:warm-raised', conversationId)
    setTimeout(() => warmSessionShellPool(), SESSION_POOL_REFILL_MS)
  } else {
    // Cold companion: raise once when ready — a second raise on did-finish-load
    // re-focused the frame and made the shadow flicker.
    window.once('ready-to-show', () => {
      sessionOpenMark('open:cold-ready-to-show', conversationId)
      raiseDetachedWindow(window)
    })
    const query: Record<string, string> = {
      view: 'session',
      conversationId,
      requestedAt: String(requestedAt)
    }
    if (options.collapseTools) query.collapseTools = '1'
    if (empty) query.empty = '1'
    loadRenderer(window, query)
    sessionOpenMark('open:cold-loaded', conversationId)
    setTimeout(() => warmSessionShellPool(), 1200)
  }

  // Hard invariant: opening a companion must never resize the main window.
  if (mainBoundsBefore && mainWindow && !mainWindow.isDestroyed()) {
    const after = mainWindow.getBounds()
    if (
      after.width !== mainBoundsBefore.width ||
      after.height !== mainBoundsBefore.height ||
      after.x !== mainBoundsBefore.x ||
      after.y !== mainBoundsBefore.y
    ) {
      console.warn('[window] main bounds changed during openDetached — restoring', {
        before: mainBoundsBefore,
        after
      })
      mainWindow.setBounds(mainBoundsBefore)
    }
  }

  return window
}

function previewQuery(
  path: string,
  options?: { origin?: 'dock' | 'session'; conversationId?: string; requestedAt?: number }
): Record<string, string> {
  const query: Record<string, string> = {
    view: 'file-preview',
    path,
    origin: options?.origin ?? 'session'
  }
  if (options?.conversationId) query.conversationId = options.conversationId
  if (options?.requestedAt) query.requestedAt = String(options.requestedAt)
  return query
}

/** Remove a preview window entry by window identity (path may have been remapped). */
function forgetPreviewWindow(window: BrowserWindow): void {
  for (const [key, win] of previewWindows) {
    if (win === window) previewWindows.delete(key)
  }
}

/** Stable map key for preview windows (aliases / relative paths collapse). */
function previewPathKey(filePath: string): string {
  const raw = filePath.trim()
  if (!raw) return ''
  try {
    if (existsSync(raw)) return realpathSync(raw)
  } catch {
    // fall through
  }
  return raw
}

/**
 * `app.isPackaged` is true even in `npm run dev` — the dev Electron binary is
 * rebranded to vav.app. The renderer dev-server URL is the reliable signal.
 */
const IS_DEV_LAUNCH = Boolean(process.env.ELECTRON_RENDERER_URL)
/** Env escape hatch so a real build can be timed too. */
const PREVIEW_PERF_LOG = IS_DEV_LAUNCH || process.env.VAV_PREVIEW_PERF === '1'
/** Session companion open timing (⌘⇧↵). Always on in dev; force with VAV_SESSION_PERF=1. */
const SESSION_PERF_LOG = IS_DEV_LAUNCH || process.env.VAV_SESSION_PERF === '1'

function previewOpenMark(label: string, detail?: string): void {
  if (!PREVIEW_PERF_LOG) return
  const suffix = detail ? ` ${detail}` : ''
  console.log(`[preview-perf] ${label}${suffix} t=${Date.now()}`)
}

function sessionOpenMark(label: string, detail?: string): void {
  if (!SESSION_PERF_LOG) return
  const now = Date.now()
  const elapsed = sessionOpenT0 ? ` +${now - sessionOpenT0}ms` : ''
  const suffix = detail ? ` ${detail}` : ''
  console.log(`[session-perf] ${label}${suffix}${elapsed}`)
}

/**
 * `inspect()` started the moment the open request lands, so the stat + first
 * text window overlap window show and renderer mount instead of queueing
 * behind them. The renderer's own `files.inspect` call then resolves from here.
 *
 * Served once and short-lived — a later reopen must re-read disk.
 */
const inspectPreload = new Map<string, Promise<FileInspectResult>>()
const INSPECT_PRELOAD_TTL_MS = 4000

function preloadInspect(path: string): void {
  if (inspectPreload.has(path)) return
  const pending = fileService.inspect(path)
  inspectPreload.set(path, pending)
  // Never let a failed/ignored preload keep a stale result reachable.
  void pending.catch(() => undefined)
  setTimeout(() => {
    if (inspectPreload.get(path) === pending) inspectPreload.delete(path)
  }, INSPECT_PRELOAD_TTL_MS)
}

function takePreloadedInspect(path: string): Promise<FileInspectResult> | null {
  const pending = inspectPreload.get(path)
  if (!pending) return null
  inspectPreload.delete(path)
  return pending
}

function takeWarmPreviewShell(): BrowserWindow | null {
  const notReady: BrowserWindow[] = []
  while (warmPreviewPool.length > 0) {
    const win = warmPreviewPool.pop()!
    if (win.isDestroyed()) continue
    if (!warmPreviewReady.has(win)) {
      notReady.push(win)
      continue
    }
    warmPreviewPool.push(...notReady)
    return win
  }
  warmPreviewPool.push(...notReady)
  return null
}

function parkWarmPreviewShell(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (warmPreviewPool.includes(window)) return
  if (warmPreviewPool.length >= PREVIEW_WARM_POOL) {
    afterLeavingFullscreen(window, () => {
      if (!window.isDestroyed()) {
        fullscreenCloseAllowed.add(window)
        window.destroy()
      }
    })
    return
  }
  previewCloseGuards.delete(window)
  forgetPreviewWindow(window)
  try {
    window.setTitle('Preview')
    if (window.isVisible()) window.hide()
  } catch {
    // ignore
  }
  warmPreviewPool.push(window)
  // Clear canvas so the next navigate starts clean.
  previewNavigateSeq += 1
  safeSend(window.webContents, IPC.previewNavigate, {
    path: '',
    openSeq: previewNavigateSeq
  })
  // Top up pool asynchronously.
  setTimeout(() => warmPreviewShellPool(), PREVIEW_POOL_REFILL_MS)
}

function createPreviewBrowserWindow(opts: {
  show: boolean
  path?: string
  width: number
  height: number
  x?: number
  y?: number
}): BrowserWindow {
  const window = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    ...(opts.x != null && opts.y != null ? { x: opts.x, y: opts.y } : {}),
    minWidth: 520,
    minHeight: 400,
    show: opts.show,
    paintWhenInitiallyHidden: true,
    title: opts.path ? basename(opts.path) : 'Preview',
    icon: loadAppIcon(),
    ...chrome(TOOLBAR_HEIGHT),
    webPreferences: rendererPrefs({
      plugins: true
    })
  })
  applyMenuBar(window)
  applyTrafficLights(window)
  wireFullscreenState(window)
  wireExternalLinks(window.webContents)
  wireMenuAccelerators(window.webContents)
  wirePtyViewerLifecycle(window.webContents)
  if (IS_DEV_LAUNCH || !app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[preview:${event.level}] ${event.message}`)
    })
  }
  return window
}

/** Preload hidden preview shells after the main window is up. */
function warmPreviewShellPool(): void {
  const live = warmPreviewPool.filter((w) => !w.isDestroyed())
  warmPreviewPool.length = 0
  warmPreviewPool.push(...live)
  while (warmPreviewPool.length < PREVIEW_WARM_POOL) {
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(PREVIEW_DEFAULT_WIDTH, area.width - 40)
    const height = Math.min(700, area.height - 40)
    // Only the lead shell warms every format canvas; the pptx renderer alone is
    // ~2 MB of parsed JS and spares should not each hold a copy.
    const deep = warmPreviewPool.length === 0
    const window = createPreviewBrowserWindow({ show: false, width, height })
    warmPreviewPool.push(window)
    window.on('closed', () => {
      const idx = warmPreviewPool.indexOf(window)
      if (idx >= 0) warmPreviewPool.splice(idx, 1)
      warmPreviewReady.delete(window)
      forgetPreviewWindow(window)
    })
    // Warm entry: no path — renderer bootstraps and prefetches canvases.
    loadRenderer(window, { view: 'file-preview', warm: deep ? 'deep' : '1' })
    previewOpenMark(`warm-shell-created${deep ? ':deep' : ''}`)
  }
}

/**
 * File preview in its own window (file-preview.rpml).
 * Prefers a warm hidden shell + in-place navigate (no cold BrowserWindow load).
 * Same path → focus existing. Capped by PREVIEW_MAX_OPEN.
 */
const OVERLAY_WARM_POOL = 2
const overlayWarmPool: BrowserWindow[] = []
const overlayWarmReady = new WeakSet<BrowserWindow>()
const appClipWindows = new Map<string, BrowserWindow>()
const pendingOverlayNav = new WeakMap<BrowserWindow, OverlayNavigatePayload>()

function forgetOverlayWindow(window: BrowserWindow): void {
  for (const [key, win] of appClipWindows) {
    if (win === window) appClipWindows.delete(key)
  }
}

function overlayGeometry(): { width: number; height: number; x?: number; y?: number } {
  const anchor = BrowserWindow.getFocusedWindow() ?? mainWindow
  const area = (
    anchor && !anchor.isDestroyed() ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay()
  ).workArea
  const width = Math.min(1180, area.width - 48)
  const height = Math.min(860, area.height - 48)
  let x: number | undefined
  let y: number | undefined
  const others = [...appClipWindows.values()].filter((w) => !w.isDestroyed())
  if (others.length > 0) {
    const b = others[others.length - 1]!.getBounds()
    x = b.x + 28
    y = b.y + 28
    if (x + width > area.x + area.width) x = area.x + Math.max(0, area.width - width)
    if (y + height > area.y + area.height) y = area.y + Math.max(0, area.height - height)
  }
  return { width, height, x, y }
}

function createOverlayBrowserWindow(opts: {
  show: boolean
  width: number
  height: number
  x?: number
  y?: number
}): BrowserWindow {
  const window = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    ...(opts.x != null && opts.y != null ? { x: opts.x, y: opts.y } : {}),
    minWidth: 320,
    minHeight: 240,
    show: opts.show,
    paintWhenInitiallyHidden: true,
    title: 'App',
    icon: loadAppIcon(),
    titleBarStyle: 'hidden',
    acceptFirstMouse: true,
    backgroundColor: windowBackground(),
    hasShadow: true,
    fullscreenable: true,
    webPreferences: rendererPrefs({
      plugins: true
    })
  })
  if (IS_MAC) {
    try {
      window.setWindowButtonVisibility(false)
    } catch {
      // ignore
    }
  }
  wireExternalLinks(window.webContents)
  wireMenuAccelerators(window.webContents)
  return window
}

function takeWarmOverlayShell(): BrowserWindow | null {
  const notReady: BrowserWindow[] = []
  while (overlayWarmPool.length > 0) {
    const win = overlayWarmPool.pop()!
    if (win.isDestroyed()) continue
    if (!overlayWarmReady.has(win)) {
      notReady.push(win)
      continue
    }
    overlayWarmPool.push(...notReady)
    return win
  }
  overlayWarmPool.push(...notReady)
  return null
}

function parkWarmOverlayShell(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (overlayWarmPool.includes(window)) return
  forgetOverlayWindow(window)
  if (overlayWarmPool.length >= OVERLAY_WARM_POOL) {
    afterLeavingFullscreen(window, () => {
      if (!window.isDestroyed()) {
        fullscreenCloseAllowed.add(window)
        window.destroy()
      }
    })
    return
  }
  try {
    window.setTitle('Preview')
    if (window.isVisible()) window.hide()
  } catch {
    // ignore
  }
  previewNavigateSeq += 1
  safeSend(window.webContents, IPC.previewNavigate, {
    path: '',
    openSeq: previewNavigateSeq
  } satisfies OverlayNavigatePayload)
  overlayWarmPool.push(window)
  overlayWarmReady.add(window)
  setTimeout(() => warmOverlayShellPool(), PREVIEW_POOL_REFILL_MS)
}

function warmOverlayShellPool(): void {
  const live = overlayWarmPool.filter((w) => !w.isDestroyed())
  overlayWarmPool.length = 0
  overlayWarmPool.push(...live)
  while (overlayWarmPool.length < OVERLAY_WARM_POOL) {
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(960, area.width - 48)
    const height = Math.min(720, area.height - 48)
    const window = createOverlayBrowserWindow({ show: false, width, height })
    overlayWarmPool.push(window)
    window.on('closed', () => {
      const idx = overlayWarmPool.indexOf(window)
      if (idx >= 0) overlayWarmPool.splice(idx, 1)
      overlayWarmReady.delete(window)
      forgetOverlayWindow(window)
    })
    loadRenderer(window, { view: 'app-window', warm: '1' })
  }
}

function wireOverlayLifecycle(window: BrowserWindow): void {
  window.removeAllListeners('close')
  window.on('close', (event) => {
    if (quitting) return
    if (fullscreenCloseAllowed.has(window)) {
      fullscreenCloseAllowed.delete(window)
      return
    }
    if (window.isFullScreen()) {
      event.preventDefault()
      window.once('leave-full-screen', () => {
        if (window.isDestroyed()) return
        parkWarmOverlayShell(window)
      })
      window.setFullScreen(false)
      return
    }
    event.preventDefault()
    parkWarmOverlayShell(window)
  })
}

function sendOverlayNavigate(window: BrowserWindow, payload: OverlayPayload): void {
  previewNavigateSeq += 1
  const full: OverlayNavigatePayload = {
    ...payload,
    openSeq: previewNavigateSeq,
    requestedAt: Date.now()
  }
  if (window.webContents.isLoading()) {
    pendingOverlayNav.set(window, full)
    window.webContents.once('did-finish-load', () => {
      const pending = pendingOverlayNav.get(window)
      if (!pending || window.isDestroyed()) return
      pendingOverlayNav.delete(window)
      safeSend(window.webContents, IPC.previewNavigate, pending)
    })
    return
  }
  safeSend(window.webContents, IPC.previewNavigate, full)
}

function normalizeOverlayPayload(input: OverlayPayload | string): OverlayPayload {
  const raw = typeof input === 'string' ? { path: input } : input
  const path = raw.path ? previewPathKey(raw.path) : ''
  const kind = raw.kind ?? (path ? inferOverlayKind(path) : undefined)
  const diagramKind = raw.diagramKind ?? (path ? inferDiagramKind(path) : undefined)
  return {
    ...raw,
    path: path || raw.path,
    kind,
    diagramKind
  }
}

/** Preview-style overlay: thin native frame, no file-viewer chrome. */
function openAppClipWindow(input: OverlayPayload | string): void {
  const payload = normalizeOverlayPayload(input)
  const key = overlayIdentity(payload)
  if (!key && !payload.text && !payload.mediaSrc && !payload.path) return

  if (key) {
    const existing = appClipWindows.get(key)
    if (existing && !existing.isDestroyed()) {
      sendOverlayNavigate(existing, payload)
      void revealBrowserWindow(existing)
      return
    }
  }

  const geo = overlayGeometry()
  const warm = takeWarmOverlayShell()
  const window =
    warm ??
    createOverlayBrowserWindow({
      show: true,
      ...geo
    })

  if (warm) {
    try {
      window.setBounds({
        width: geo.width,
        height: geo.height,
        ...(geo.x != null && geo.y != null
          ? { x: geo.x, y: geo.y }
          : { x: window.getBounds().x, y: window.getBounds().y })
      })
    } catch {
      // ignore geometry races
    }
  }

  if (key) appClipWindows.set(key, window)
  window.removeAllListeners('closed')
  window.on('closed', () => {
    forgetOverlayWindow(window)
    overlayWarmReady.delete(window)
  })
  wireOverlayLifecycle(window)

  sendOverlayNavigate(window, payload)
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()

  if (warm) {
    setTimeout(() => warmOverlayShellPool(), PREVIEW_POOL_REFILL_MS)
    return
  }

  const query: Record<string, string> = { view: 'app-window' }
  if (payload.path) query.path = payload.path
  if (payload.kind === 'image' || (payload.path && OVERLAY_IMAGE_EXTS.has(extname(payload.path).toLowerCase()))) {
    query.kind = 'image'
  }
  loadRenderer(window, query)
  setTimeout(() => warmOverlayShellPool(), 800)
}

function isAppClipBrowserWindow(win: BrowserWindow): boolean {
  if (overlayWarmPool.includes(win)) return true
  for (const open of appClipWindows.values()) {
    if (open === win) return true
  }
  try {
    return win.webContents.getURL().includes('view=app-window')
  } catch {
    return false
  }
}

function openFilePreviewWindow(
  filePath: string,
  options?: { origin?: 'dock' | 'session'; conversationId?: string; surface?: 'file' | 'app' }
): void {
  const path = previewPathKey(filePath)
  if (!path) return
  // Overlay = ephemeral conversation preview. File Sessions pass surface:'file'.
  if (shouldOpenAsOverlay(path, options?.surface)) {
    openAppClipWindow(path)
    return
  }
  const requestedAt = Date.now()
  previewOpenMark('open:start', path)

  // Directories have no file preview — reveal in Finder / Explorer instead.
  try {
    if (statSync(path).isDirectory()) {
      shell.showItemInFolder(path)
      return
    }
  } catch {
    // Missing / unreadable: fall through to the preview's own error state.
  }

  const existing = previewWindows.get(path)
  if (existing && !existing.isDestroyed()) {
    previewOpenMark('open:reuse-focus', path)
    void revealBrowserWindow(existing)
    return
  }

  const anchor = BrowserWindow.getFocusedWindow() ?? mainWindow
  const area = (
    anchor && !anchor.isDestroyed() ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay()
  ).workArea
  const snapshotting = Boolean(process.env.VAV_SNAPSHOT || process.env.VAV_SNAPSHOT_PLAN)
  // 880 ≈ a Letter/A4 page at 100% plus the document stage's gutters, so paged
  // formats open fitted *and* full size rather than fitted and shrunken.
  const width = Math.min(snapshotting ? 1280 : PREVIEW_DEFAULT_WIDTH, area.width - 40)
  const height = Math.min(snapshotting ? 820 : 700, area.height - 40)

  let x: number | undefined
  let y: number | undefined
  let cascadeFrom: BrowserWindow | null = null
  if (anchor && !anchor.isDestroyed() && [...previewWindows.values()].some((w) => w === anchor)) {
    cascadeFrom = anchor
  } else {
    for (const win of previewWindows.values()) {
      if (!win.isDestroyed()) {
        cascadeFrom = win
        break
      }
    }
  }
  if (cascadeFrom && !cascadeFrom.isDestroyed()) {
    const b = cascadeFrom.getBounds()
    const n = previewWindows.size
    x = b.x + 28 + (n % 5) * 12
    y = b.y + 28 + (n % 5) * 12
    if (x + width > area.x + area.width) x = area.x + Math.max(0, area.width - width)
    if (y + height > area.y + area.height) y = area.y + Math.max(0, area.height - height)
  }

  // Kick the disk work off now so it overlaps window show + renderer mount.
  preloadInspect(path)

  const warm = takeWarmPreviewShell()
  const window =
    warm ??
    createPreviewBrowserWindow({
      show: true,
      path,
      width,
      height,
      x,
      y
    })

  if (warm) {
    previewOpenMark('open:warm-claim', path)
    try {
      window.setBounds({
        width,
        height,
        ...(x != null && y != null ? { x, y } : { x: window.getBounds().x, y: window.getBounds().y })
      })
      window.setTitle(basename(path))
    } catch {
      // ignore geometry races
    }
  } else {
    previewOpenMark('open:cold-create', path)
  }

  previewWindows.set(path, window)
  window.removeAllListeners('closed')
  window.on('closed', () => {
    forgetPreviewWindow(window)
    warmPreviewReady.delete(window)
  })
  wirePreviewLifecycle(window, path)

  previewNavigateSeq += 1
  const openSeq = previewNavigateSeq
  const payload = {
    path,
    origin: options?.origin ?? 'session',
    conversationId: options?.conversationId,
    openSeq,
    requestedAt
  }

  if (warm) {
    safeSend(window.webContents, IPC.previewNavigate, payload)
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
    previewOpenMark('open:warm-navigated', path)
    setTimeout(() => warmPreviewShellPool(), PREVIEW_POOL_REFILL_MS)
    return
  }

  loadRenderer(window, previewQuery(path, { ...options, requestedAt }))
  if (window.isMinimized()) window.restore()
  window.focus()
  previewOpenMark('open:cold-loaded', path)
  setTimeout(() => warmPreviewShellPool(), 1200)
}

type TokenUsageAnchor = { x: number; y: number; width: number; height: number }

let tokenUsageCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelTokenUsageDismiss(): void {
  if (!tokenUsageCloseTimer) return
  clearTimeout(tokenUsageCloseTimer)
  tokenUsageCloseTimer = null
}

/** Hide (not destroy) so the next open is instant. */
function hideTokenUsageWindow(): void {
  cancelTokenUsageDismiss()
  if (!tokenUsageWindow || tokenUsageWindow.isDestroyed()) return
  if (tokenUsageWindow.isVisible()) tokenUsageWindow.hide()
}

function dismissTokenUsageSoon(): void {
  // Keep the popup open while marketing screenshots capture it.
  if (process.env.VAV_SNAPSHOT || process.env.VAV_SNAPSHOT_PLAN) return
  if (tokenUsageCloseTimer) return
  tokenUsageCloseTimer = setTimeout(() => {
    tokenUsageCloseTimer = null
    hideTokenUsageWindow()
  }, 120)
}

function publishModelCatalog(
  catalog: ReturnType<typeof getModelCatalogSnapshot>
): void {
  broadcast(IPC.agentsModelCatalogChanged, catalog)
}

function preferredModelHosts(): CliHostKind[] {
  const hosts: CliHostKind[] = []
  for (const entry of settingsStore.get().recentAgentModels ?? []) {
    if (isStructuredCliHost(entry.hostId)) hosts.push(entry.hostId)
  }
  for (const conversation of conversationStore.all()) {
    const host = conversation.cliHost
    if (host && isStructuredCliHost(host)) hosts.push(host)
  }
  return hosts
}

/** Catalogue size when the host published one; else the model-id table. */
function contextWindowForModel(
  host: CliHostKind | null,
  modelId: string,
  reported?: number
): number {
  const listed = getModelCatalogSnapshot()[host ?? 'vav']?.models?.find((m) => m.id === modelId)
    ?.contextWindow
  if (listed && listed > 0) return listed
  if (host && reported && reported > 0) return reported
  return contextWindowFor(modelId)
}

/**
 * Coerce conversation.model to a valid id for its chat host.
 * Fixes sessions created with defaultAgentId=CLI but still holding the VAV
 * defaultModel (e.g. grok + deepseek-v4-flash) — picker resolved for display
 * only, so the context-window panel showed the wrong model.
 */
function coerceConversationModel(conversationId: string): string | null {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return null
  const settings = settingsStore.get()
  const host = (conversation.cliHost ?? null) as CliHostKind | null
  const key = host ?? 'vav'
  const catalogue = getModelCatalogSnapshot()[key]?.models
  const resolved = resolveModelForChatHost(host, conversation.model, {
    customModels: settings.customModels,
    vavDefaultModel: settings.defaultModel,
    catalogue
  })
  if (resolved !== conversation.model) {
    conversationStore.updateMeta(conversationId, {
      model: resolved,
      tokenLimit: contextWindowForModel(host, resolved)
    })
    // Keep sidebar / composer meta in sync when healing a foreign model id.
    publishConversations()
  }
  return resolved
}

function modelForNewConversation(
  host: CliHostKind | null,
  preferredModel?: string | null
): string {
  const settings = settingsStore.get()
  const key = host ?? 'vav'
  const catalogue = getModelCatalogSnapshot()[key]?.models
  return resolveModelForChatHost(host, preferredModel ?? settings.defaultModel, {
    customModels: settings.customModels,
    vavDefaultModel: settings.defaultModel,
    catalogue
  })
}

/** Lean snapshot for the panel — never ships message bodies. */
function buildTokenUsagePayload(conversationId: string): TokenUsageViewPayload | null {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return null
  const settings = settingsStore.get()
  const phase = activeTurns.get(conversationId)
  const leafId = conversation.activeLeafId
  const pathLen = leafId
    ? threadPath(conversation.messages, leafId).length
    : conversation.messages.length
  const cliHost = (conversation.cliHost ?? null) as CliHostKind | null
  // Compact only affects VAV history — ignore leftovers while on a CLI host.
  const activeCompaction = cliHost
    ? null
    : compactionForLeaf(conversation.compactions, conversation.messages, leafId)
  const latestInput = conversation.tokenHistory?.at(-1)?.totalInputTokens ?? 0
  const estimated = activeCompaction?.estimatedContextTokens ?? 0
  const contextTokens =
    estimated > 0
      ? estimated
      : latestInput > 0
        ? latestInput
        : conversation.tokensUsed
  const model = coerceConversationModel(conversationId) ?? conversation.model
  const catalogue = getModelCatalogSnapshot()[cliHost ?? 'vav']?.models
  const modelLabel = labelForChatModel(
    cliHost,
    model,
    settings.customModels,
    catalogue
  )
  const provider = cliHost
    ? displayNameForCliHost(cliHost)
    : vavProviderLabel(model, settings.apiEndpoint)
  const history = conversation.tokenHistory ?? []
  const reportedSessionCostUsd = conversation.reportedSessionCostUsd ?? null
  const hasProviderUsage =
    history.length > 0 ||
    (conversation.tokensUsed ?? 0) > 0 ||
    reportedSessionCostUsd != null ||
    estimated > 0
  return {
    conversationId: conversation.id,
    model,
    modelLabel,
    providerLabel: provider,
    cliHost,
    tokensUsed: conversation.tokensUsed,
    tokenLimit: contextWindowForModel(cliHost, model, conversation.tokenLimit),
    history,
    cacheCreatedAt: conversation.cacheCreatedAt ?? null,
    cacheExpiresAt: conversation.cacheExpiresAt ?? null,
    isRunning: phase === 'running' || phase === 'paused',
    apiEndpoint: settings.apiEndpoint,
    theme: settings.theme,
    locale: currentLocale(),
    displayCurrency: settings.displayCurrency ?? 'USD',
    now: Date.now(),
    hasCompaction: !!activeCompaction,
    compactedCount: activeCompaction?.compactedCount ?? 0,
    pathMessageCount: pathLen,
    contextTokens,
    contextTokensEstimated: estimated > 0,
    reportedSessionCostUsd,
    hasProviderUsage,
    cacheExpiryEstimated: !!(conversation.cacheExpiresAt && conversation.cacheCreatedAt),
    // Manual compact only rewrites VAV buildHistory — not CLI native sessions.
    compactAvailable: !cliHost,
    quotaWindows: cliHost
      ? mergeQuotaWindowsPreferNewer(quotaService.get(cliHost), conversation.quotaWindows ?? [])
      : []
  }
}

function currentTokenUsagePayload(): TokenUsageViewPayload | null {
  const id = tokenUsageConversationId
  if (!id || id === '_') return null
  try {
    return buildTokenUsagePayload(id)
  } catch (err) {
    console.error('[token-usage] payload failed', err)
    return null
  }
}

function sendTokenUsagePayload(conversationId: string): void {
  if (!tokenUsageWindow || tokenUsageWindow.isDestroyed()) return
  let payload: TokenUsageViewPayload | null = null
  try {
    payload = buildTokenUsagePayload(conversationId)
  } catch (err) {
    console.error('[token-usage] payload failed', err)
    return
  }
  if (!payload) return
  safeSend(tokenUsageWindow.webContents, IPC.tokenUsageView, payload)
  requestAccountQuota(conversationId)
}

function requestAccountQuota(conversationId: string): void {
  const host = conversationStore.get(conversationId)?.cliHost ?? null
  void quotaService.refreshForPanel(host)
}

function pushTokenUsageIfOpen(conversationId: string): void {
  if (!tokenUsageWindow || tokenUsageWindow.isDestroyed()) return
  if (!tokenUsageWindow.isVisible()) return
  if (tokenUsageConversationId !== conversationId) return
  sendTokenUsagePayload(conversationId)
}

/** Place the popup above the ring (or below if there isn’t room). */
function placeTokenUsagePopup(
  win: BrowserWindow,
  parent: BrowserWindow,
  anchor?: TokenUsageAnchor
): void {
  const [width, height] = win.getSize()
  const content = parent.getContentBounds()
  const gap = 8
  let x: number
  let y: number
  if (anchor) {
    x = Math.round(content.x + anchor.x + anchor.width - width)
    y = Math.round(content.y + anchor.y - height - gap)
    if (y < content.y) {
      y = Math.round(content.y + anchor.y + anchor.height + gap)
    }
  } else {
    x = Math.round(content.x + content.width - width - 24)
    y = Math.round(content.y + content.height - height - 80)
  }

  const area = screen.getDisplayMatching(content).workArea
  x = Math.min(Math.max(area.x + 8, x), area.x + area.width - width - 8)
  y = Math.min(Math.max(area.y + 8, y), area.y + area.height - height - 8)
  win.setPosition(x, y)
}

/**
 * Context-window details as a native panel popup — frameless child shell,
 * anchored to the ring, dismisses on blur (hide, not destroy).
 *
 * The BrowserWindow is reused across opens: first open pays one load cost;
 * later opens only re-position + hydrate. No full app bootstrap in the panel.
 */
function openTokenUsageWindow(
  sender: Electron.WebContents,
  conversationId: string,
  anchor?: TokenUsageAnchor
): void {
  const id = conversationId.trim()
  if (!id) return

  cancelTokenUsageDismiss()

  const parent = BrowserWindow.fromWebContents(sender) ?? mainWindow
  if (!parent || parent.isDestroyed()) return

  // Toggle closed when already visible for the same conversation.
  if (
    tokenUsageWindow &&
    !tokenUsageWindow.isDestroyed() &&
    tokenUsageWindow.isVisible() &&
    tokenUsageConversationId === id &&
    tokenUsageParentId === parent.id
  ) {
    hideTokenUsageWindow()
    return
  }

  hideProviderAccountWindow()

  // Parent changed (e.g. main → detached): recreate so z-order stays correct.
  if (
    tokenUsageWindow &&
    !tokenUsageWindow.isDestroyed() &&
    tokenUsageParentId !== null &&
    tokenUsageParentId !== parent.id
  ) {
    tokenUsageWindow.destroy()
    tokenUsageWindow = null
    tokenUsageReady = false
  }

  tokenUsageConversationId = id

  if (tokenUsageWindow && !tokenUsageWindow.isDestroyed() && tokenUsageReady) {
    try {
      tokenUsageWindow.setBackgroundColor(windowBackground())
    } catch {
      // ignore
    }
    placeTokenUsagePopup(tokenUsageWindow, parent, anchor)
    sendTokenUsagePayload(id)
    tokenUsagePendingShow = null
    if (!tokenUsageWindow.isVisible()) tokenUsageWindow.show()
    tokenUsageWindow.focus()
    return
  }

  if (tokenUsageWindow && !tokenUsageWindow.isDestroyed()) {
    // Shell still loading (warm or first open) — show as soon as ready.
    tokenUsagePendingShow = { parent, anchor }
    placeTokenUsagePopup(tokenUsageWindow, parent, anchor)
    return
  }

  const width = 360
  const height = 520
  const bg = windowBackground()

  tokenUsageWindow = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    frame: false,
    parent,
    modal: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    title: t('token.contextWindow'),
    // Solid wash matching the renderer shell — never flash system white.
    backgroundColor: bg,
    ...(IS_MAC
      ? { type: 'panel' as const, roundedCorners: true, acceptFirstMouse: true }
      : {}),
    webPreferences: rendererPrefs()
  })
  tokenUsageParentId = parent.id
  tokenUsageReady = false

  try {
    tokenUsageWindow.setBackgroundColor(bg)
  } catch {
    // ignore
  }

  // Inject shell paint before any renderer CSS so the first frame is never #fff.
  void tokenUsageWindow.webContents.insertCSS(
    `html,body,#root{background:${bg}!important;margin:0;height:100%;color-scheme:${
      nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    }}`
  ).catch(() => undefined)

  tokenUsageWindow.on('blur', () => dismissTokenUsageSoon())
  // Focus can bounce during show(); cancel a pending blur-dismiss so the
  // panel does not flash open then close 120ms later.
  tokenUsageWindow.on('focus', () => cancelTokenUsageDismiss())
  // Hide instead of destroy so reopen is free.
  tokenUsageWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideTokenUsageWindow()
  })
  tokenUsageWindow.on('closed', () => {
    cancelTokenUsageDismiss()
    tokenUsageWindow = null
    tokenUsageConversationId = null
    tokenUsageParentId = null
    tokenUsageReady = false
  })

  wireExternalLinks(tokenUsageWindow.webContents)

  if (!app.isPackaged) {
    tokenUsageWindow.webContents.on('console-message', (event) => {
      console.log(`[token-usage:${event.level}] ${event.message}`)
    })
  }

  // Show only after the renderer has loaded + received the hydrate payload.
  // ready-to-show alone can paint an empty white surface.
  tokenUsagePendingShow = { parent, anchor }
  tokenUsageWindow.webContents.once('did-finish-load', () => {
    onTokenUsageShellReady()
  })

  loadRenderer(tokenUsageWindow, { view: 'token-usage', conversationId: id })
}

function onTokenUsageShellReady(): void {
  if (!tokenUsageWindow || tokenUsageWindow.isDestroyed()) return
  tokenUsageReady = true
  const pending = tokenUsagePendingShow
  tokenUsagePendingShow = null
  if (!pending) return
  const target = tokenUsageConversationId
  if (target && target !== '_') sendTokenUsagePayload(target)
  if (pending.parent && !pending.parent.isDestroyed()) {
    placeTokenUsagePopup(tokenUsageWindow, pending.parent, pending.anchor)
  }
  try {
    tokenUsageWindow.setBackgroundColor(windowBackground())
  } catch {
    // ignore
  }
  tokenUsageWindow.show()
  tokenUsageWindow.focus()
}

/**
 * Preload the token panel shell after the app is idle so the first ring click
 * doesn't pay the full renderer cold-start. Stays hidden until open.
 */
function warmTokenUsageWindow(): void {
  if (tokenUsageWindow && !tokenUsageWindow.isDestroyed()) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  const width = 360
  const height = 520
  const bg = windowBackground()
  tokenUsageWindow = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    frame: false,
    parent: mainWindow,
    modal: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    title: t('token.contextWindow'),
    backgroundColor: bg,
    ...(IS_MAC
      ? { type: 'panel' as const, roundedCorners: true, acceptFirstMouse: true }
      : {}),
    webPreferences: rendererPrefs()
  })
  tokenUsageParentId = mainWindow.id
  tokenUsageReady = false
  try {
    tokenUsageWindow.setBackgroundColor(bg)
  } catch {
    // ignore
  }
  void tokenUsageWindow.webContents.insertCSS(
    `html,body,#root{background:${bg}!important;margin:0;height:100%;color-scheme:${
      nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    }}`
  ).catch(() => undefined)
  tokenUsageWindow.on('blur', () => dismissTokenUsageSoon())
  tokenUsageWindow.on('focus', () => cancelTokenUsageDismiss())
  tokenUsageWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideTokenUsageWindow()
  })
  tokenUsageWindow.on('closed', () => {
    cancelTokenUsageDismiss()
    tokenUsageWindow = null
    tokenUsageConversationId = null
    tokenUsageParentId = null
    tokenUsageReady = false
  })
  wireExternalLinks(tokenUsageWindow.webContents)
  tokenUsageWindow.webContents.once('did-finish-load', () => {
    tokenUsageReady = true
    // User may have clicked the ring while we were warming.
    if (tokenUsagePendingShow) onTokenUsageShellReady()
  })
  loadRenderer(tokenUsageWindow, { view: 'token-usage', conversationId: '_' })
}

type ProviderAccountAnchor = { x: number; y: number; width: number; height: number }

let providerAccountCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelProviderAccountDismiss(): void {
  if (!providerAccountCloseTimer) return
  clearTimeout(providerAccountCloseTimer)
  providerAccountCloseTimer = null
}

function hideProviderAccountWindow(): void {
  cancelProviderAccountDismiss()
  if (!providerAccountWindow || providerAccountWindow.isDestroyed()) return
  if (providerAccountWindow.isVisible()) providerAccountWindow.hide()
}

function dismissProviderAccountSoon(): void {
  if (process.env.VAV_SNAPSHOT || process.env.VAV_SNAPSHOT_PLAN) return
  if (providerAccountCloseTimer) return
  providerAccountCloseTimer = setTimeout(() => {
    providerAccountCloseTimer = null
    hideProviderAccountWindow()
  }, 120)
}

function hostDisplayName(host: CliHostKind | null): string {
  if (!host) return t('agents.plainShell')
  const agent = enabledCliAgents(settingsStore.get().cliAgents).find((a) => a.id === host)
  return agent?.name ?? displayNameForCliHost(host)
}

function buildProviderAccountPayload(
  conversationId: string,
  extras?: {
    loading?: boolean
    signedIn?: boolean
    accountId?: string | null
    plan?: string | null
    authKind?: HostAuthKind
  }
): ProviderAccountViewPayload | null {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return null
  const host = (conversation.cliHost ?? null) as CliHostKind | null
  const settings = settingsStore.get()
  const signedIn = extras?.signedIn ?? false
  return {
    conversationId: conversation.id,
    host,
    hostId: host ?? 'vav',
    hostName: hostDisplayName(host),
    signedIn,
    accountId: extras?.accountId ?? null,
    plan: extras?.plan ?? null,
    authKind: extras?.authKind ?? (signedIn ? 'oauth' : 'none'),
    windows: host
      ? mergeQuotaWindowsPreferNewer(quotaService.get(host), conversation.quotaWindows ?? [])
      : [],
    loading: extras?.loading ?? false,
    theme: settings.theme,
    locale: currentLocale(),
    now: Date.now()
  }
}

function currentProviderAccountPayload(): ProviderAccountViewPayload | null {
  const id = providerAccountConversationId
  if (!id || id === '_') return null
  try {
    return buildProviderAccountPayload(id, {
      loading: !providerAccountAuth,
      signedIn: providerAccountAuth?.signedIn ?? false,
      accountId: providerAccountAuth?.accountId ?? null,
      plan: providerAccountAuth?.plan ?? null,
      authKind: providerAccountAuth?.authKind
    })
  } catch (err) {
    console.error('[provider-account] payload failed', err)
    return null
  }
}

function sendProviderAccountPayload(payload: ProviderAccountViewPayload): void {
  if (!providerAccountWindow || providerAccountWindow.isDestroyed()) return
  safeSend(providerAccountWindow.webContents, IPC.providerAccountView, payload)
}

async function hydrateProviderAccount(conversationId: string): Promise<void> {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return
  const host = (conversation.cliHost ?? null) as CliHostKind | null
  const waitingQuota = hostMayHaveAccountQuota(host) || isStructuredCliHost(host)
  const loading = buildProviderAccountPayload(conversationId, {
    loading: waitingQuota,
    signedIn: providerAccountAuth?.signedIn ?? false,
    accountId: providerAccountAuth?.accountId ?? null,
    plan: providerAccountAuth?.plan ?? null,
    authKind: providerAccountAuth?.authKind
  })
  if (loading) sendProviderAccountPayload(loading)
  const account = await readHostAccountInfo(host)
  providerAccountAuth = {
    signedIn: account.signedIn,
    accountId: account.accountId,
    plan: account.plan,
    authKind: account.authKind
  }
  await quotaService.refreshForPanel(host)
  const next = buildProviderAccountPayload(conversationId, {
    loading: false,
    signedIn: account.signedIn,
    accountId: account.accountId,
    plan: account.plan,
    authKind: account.authKind
  })
  if (next) sendProviderAccountPayload(next)
}

async function pushProviderAccountIfOpen(conversationId: string): Promise<void> {
  if (!providerAccountWindow || providerAccountWindow.isDestroyed()) return
  if (!providerAccountWindow.isVisible()) return
  if (providerAccountConversationId !== conversationId) return
  await hydrateProviderAccount(conversationId)
}

function placeProviderAccountPopup(
  win: BrowserWindow,
  parent: BrowserWindow,
  anchor?: ProviderAccountAnchor
): void {
  const [width, height] = win.getSize()
  const content = parent.getContentBounds()
  const gap = 8
  let x: number
  let y: number
  if (anchor) {
    x = Math.round(content.x + anchor.x)
    y = Math.round(content.y + anchor.y - height - gap)
    if (y < content.y) {
      y = Math.round(content.y + anchor.y + anchor.height + gap)
    }
  } else {
    x = Math.round(content.x + 24)
    y = Math.round(content.y + content.height - height - 80)
  }

  const area = screen.getDisplayMatching(content).workArea
  x = Math.min(Math.max(area.x + 8, x), area.x + area.width - width - 8)
  y = Math.min(Math.max(area.y + 8, y), area.y + area.height - height - 8)
  win.setPosition(x, y)
}

function attachProviderAccountWindowChrome(win: BrowserWindow): void {
  const bg = windowBackground()
  try {
    win.setBackgroundColor(bg)
  } catch {
    // ignore
  }
  void win.webContents.insertCSS(
    `html,body,#root{background:${bg}!important;margin:0;height:100%;color-scheme:${
      nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    }}`
  ).catch(() => undefined)
  win.on('blur', () => dismissProviderAccountSoon())
  win.on('focus', () => cancelProviderAccountDismiss())
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    hideProviderAccountWindow()
  })
  win.on('closed', () => {
    cancelProviderAccountDismiss()
    providerAccountWindow = null
    providerAccountConversationId = null
    providerAccountParentId = null
    providerAccountReady = false
    providerAccountAuth = null
    providerAccountAnchor = undefined
  })
  wireExternalLinks(win.webContents)
}

const PROVIDER_ACCOUNT_WIDTH = 280
const PROVIDER_ACCOUNT_MIN_HEIGHT = 108
const PROVIDER_ACCOUNT_MAX_HEIGHT = 360

function fitProviderAccountWindow(height: number): void {
  if (!providerAccountWindow || providerAccountWindow.isDestroyed()) return
  const next = Math.round(
    Math.min(PROVIDER_ACCOUNT_MAX_HEIGHT, Math.max(PROVIDER_ACCOUNT_MIN_HEIGHT, height))
  )
  const [, current] = providerAccountWindow.getContentSize()
  if (current !== next) providerAccountWindow.setContentSize(PROVIDER_ACCOUNT_WIDTH, next)
  const parent =
    providerAccountParentId != null ? BrowserWindow.fromId(providerAccountParentId) : null
  if (parent && !parent.isDestroyed()) {
    placeProviderAccountPopup(providerAccountWindow, parent, providerAccountAnchor)
  }
}

function createProviderAccountWindow(parent: BrowserWindow): BrowserWindow {
  const bg = windowBackground()
  const win = new BrowserWindow({
    width: PROVIDER_ACCOUNT_WIDTH,
    height: 148,
    useContentSize: true,
    show: false,
    frame: false,
    parent,
    modal: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    title: t('composer.accountTitle'),
    backgroundColor: bg,
    ...(IS_MAC
      ? { type: 'panel' as const, roundedCorners: true, acceptFirstMouse: true }
      : {}),
    webPreferences: rendererPrefs()
  })
  attachProviderAccountWindowChrome(win)
  return win
}

function openProviderAccountWindow(
  sender: Electron.WebContents,
  conversationId: string,
  anchor?: ProviderAccountAnchor
): void {
  const id = conversationId.trim()
  if (!id) return

  cancelProviderAccountDismiss()

  const parent = BrowserWindow.fromWebContents(sender) ?? mainWindow
  if (!parent || parent.isDestroyed()) return

  if (
    providerAccountWindow &&
    !providerAccountWindow.isDestroyed() &&
    providerAccountWindow.isVisible() &&
    providerAccountConversationId === id &&
    providerAccountParentId === parent.id
  ) {
    hideProviderAccountWindow()
    return
  }

  hideTokenUsageWindow()

  if (
    providerAccountWindow &&
    !providerAccountWindow.isDestroyed() &&
    providerAccountParentId !== null &&
    providerAccountParentId !== parent.id
  ) {
    providerAccountWindow.destroy()
    providerAccountWindow = null
    providerAccountReady = false
  }

  if (providerAccountConversationId !== id) providerAccountAuth = null
  providerAccountConversationId = id
  providerAccountAnchor = anchor

  if (providerAccountWindow && !providerAccountWindow.isDestroyed() && providerAccountReady) {
    try {
      providerAccountWindow.setBackgroundColor(windowBackground())
    } catch {
      // ignore
    }
    placeProviderAccountPopup(providerAccountWindow, parent, anchor)
    void hydrateProviderAccount(id)
    providerAccountPendingShow = null
    if (!providerAccountWindow.isVisible()) providerAccountWindow.show()
    providerAccountWindow.focus()
    return
  }

  if (providerAccountWindow && !providerAccountWindow.isDestroyed()) {
    providerAccountPendingShow = { parent, anchor }
    placeProviderAccountPopup(providerAccountWindow, parent, anchor)
    return
  }

  providerAccountWindow = createProviderAccountWindow(parent)
  providerAccountParentId = parent.id
  providerAccountReady = false

  if (!app.isPackaged) {
    providerAccountWindow.webContents.on('console-message', (event) => {
      console.log(`[provider-account:${event.level}] ${event.message}`)
    })
  }

  providerAccountPendingShow = { parent, anchor }
  providerAccountWindow.webContents.once('did-finish-load', () => {
    onProviderAccountShellReady()
  })

  loadRenderer(providerAccountWindow, { view: 'provider-account', conversationId: id })
}

function onProviderAccountShellReady(): void {
  if (!providerAccountWindow || providerAccountWindow.isDestroyed()) return
  providerAccountReady = true
  const pending = providerAccountPendingShow
  providerAccountPendingShow = null
  if (!pending) return
  const target = providerAccountConversationId
  if (target && target !== '_') void hydrateProviderAccount(target)
  if (pending.parent && !pending.parent.isDestroyed()) {
    placeProviderAccountPopup(providerAccountWindow, pending.parent, pending.anchor)
  }
  try {
    providerAccountWindow.setBackgroundColor(windowBackground())
  } catch {
    // ignore
  }
  providerAccountWindow.show()
  providerAccountWindow.focus()
}

function warmProviderAccountWindow(): void {
  if (providerAccountWindow && !providerAccountWindow.isDestroyed()) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  providerAccountWindow = createProviderAccountWindow(mainWindow)
  providerAccountParentId = mainWindow.id
  providerAccountReady = false
  providerAccountWindow.webContents.once('did-finish-load', () => {
    providerAccountReady = true
    if (providerAccountPendingShow) onProviderAccountShellReady()
  })
  loadRenderer(providerAccountWindow, { view: 'provider-account', conversationId: '_' })
}

type SwarmHistoryAnchor = { x: number; y: number; width: number; height: number }

let swarmHistoryConversationId: string | null = null

function pruneBlankSwarmHistory(conversationId: string): void {
  for (const record of swarmHistoryStore.forConversation(conversationId)) {
    if (record.name?.trim()) continue
    const sessionId = nativeSessionId(record.cursor)
    if (
      sessionId &&
      hostSessionHasConversation(record.agentId, sessionId, record.workingDirectory || '~')
    ) {
      continue
    }
    if (!isBlankSwarmSessionTitle(record.title)) continue
    swarmHistoryStore.remove(record.key)
  }
}

function currentSwarmHistoryPayload(
  conversationId = swarmHistoryConversationId
): SwarmHistoryViewPayload | null {
  const id = conversationId?.trim()
  if (!id || id === '_') return null
  try {
    pruneBlankSwarmHistory(id)
    const settings = settingsStore.get()
    const agentName = (agentId: string): string => {
      const fromSettings = settings.cliAgents?.find((a) => a.id === agentId)
      if (fromSettings?.name) return fromSettings.name
      return agentId
    }
    const live = ptyManager.listCliAgentSessions().map((session) => ({
      conversationId: session.conversationId,
      tabId: session.id,
      agentId: session.agentId || '',
      title: session.title,
      createdAt: session.createdAt
    }))
    return buildSwarmHistoryView({
      conversationId: id,
      conversations: conversationStore.all(),
      history: swarmHistoryStore,
      live,
      agentName,
      dirLabel: trayDirLabel,
      untitled: t('agents.sessionUntitled'),
      theme: settings.theme,
      locale: currentLocale(),
      hasConversation: (agentId, sessionId, cwd) =>
        isStructuredCliHost(agentId) && hostSessionHasConversation(agentId, sessionId, cwd)
    })
  } catch (err) {
    console.error('[swarm-history] payload failed', err)
    return null
  }
}

function findSwarmHistoryItem(
  itemId: string,
  conversationId = swarmHistoryConversationId
): SwarmHistoryViewPayload['groups'][number]['items'][number] | null {
  const payload = currentSwarmHistoryPayload(conversationId)
  if (!payload) return null
  for (const group of payload.groups) {
    const hit = group.items.find((item) => item.id === itemId)
    if (hit) return hit
  }
  return null
}

function popupSwarmHistoryMenuAtAnchor(
  parent: BrowserWindow,
  template: Electron.MenuItemConstructorOptions[],
  anchor?: SwarmHistoryAnchor
): void {
  const opts: Electron.PopupOptions = { window: parent }
  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
    opts.x = Math.round(anchor.x)
    opts.y = Math.round(anchor.y + Math.max(0, anchor.height))
  }
  // Same defer as popupNativeMenu — a menu opened on mouseup is dismissed immediately.
  setTimeout(() => {
    if (parent.isDestroyed()) return
    try {
      Menu.buildFromTemplate(template).popup(opts)
    } catch (err) {
      console.error('[swarm-history] popup failed', err)
    }
  }, 0)
}

function swarmHistoryMenuTemplate(
  conversationId: string,
  sender: Electron.WebContents
): Electron.MenuItemConstructorOptions[] {
  const payload = currentSwarmHistoryPayload(conversationId)
  const groups = payload?.groups ?? []
  const count = groups.reduce((n, group) => n + group.items.length, 0)
  const entries = buildSwarmHistoryMenuEntries({
    header: t('agents.sessionHistoryCount', { count }),
    emptyLabel: t('agents.sessionHistoryEmptyTitle'),
    groups: groups.map((group) => ({
      dirLabel: group.dirLabel,
      items: group.items.map((item) => ({
        id: item.id,
        label: item.label
      }))
    }))
  })
  return entries.map((entry) => {
    if (entry.kind === 'separator') return { type: 'separator' as const }
    if (entry.kind === 'header' || entry.kind === 'dir' || entry.kind === 'empty') {
      return { label: entry.label, enabled: false }
    }
    return {
      label: entry.label,
      submenu: [
        {
          label: t('agents.sessionHistoryTakeBack'),
          click: () => selectSwarmHistoryItem(entry.id, sender, conversationId)
        },
        {
          label: t('agents.sessionHistoryRemove'),
          click: () => {
            void confirmDeleteSwarmHistoryItem(entry.id, sender, conversationId)
          }
        }
      ]
    }
  })
}

function popupSwarmHistoryMenu(
  sender: Electron.WebContents,
  conversationId: string,
  anchor?: SwarmHistoryAnchor
): void {
  const id = conversationId.trim()
  if (!id) return
  const parent = BrowserWindow.fromWebContents(sender) ?? mainWindow
  if (!parent || parent.isDestroyed()) return
  swarmHistoryConversationId = id
  hideTokenUsageWindow()
  hideProviderAccountWindow()
  popupSwarmHistoryMenuAtAnchor(parent, swarmHistoryMenuTemplate(id, sender), anchor)
}

function selectSwarmHistoryItem(
  itemId: string,
  sender: Electron.WebContents,
  conversationId = swarmHistoryConversationId
): void {
  const item = findSwarmHistoryItem(itemId, conversationId)
  if (!item) return
  if (item.live && item.tabId) {
    focusRunningSession({
      conversationId: item.conversationId,
      surface: 'cli',
      tabId: item.tabId,
      agentId: item.agentId
    })
    return
  }
  if (!item.cursor || !item.agentId) return
  const parent = BrowserWindow.fromWebContents(sender) ?? mainWindow
  if (!parent || parent.isDestroyed()) return
  const targetId = conversationId && conversationId !== '_' ? conversationId : item.conversationId
  const payload: SwarmHistoryResumeEvent = {
    conversationId: targetId,
    agentId: item.agentId,
    cursor: item.cursor,
    title: item.title
  }
  safeSend(parent.webContents, IPC.swarmHistoryResume, payload)
}

async function confirmDeleteSwarmHistoryItem(
  itemId: string,
  sender: Electron.WebContents,
  conversationId: string
): Promise<void> {
  const item = findSwarmHistoryItem(itemId, conversationId)
  if (!item) return
  const parent = BrowserWindow.fromWebContents(sender) ?? mainWindow
  const first = {
    type: 'warning' as const,
    title: t('agents.sessionHistoryDeleteTitle'),
    message: t('agents.sessionHistoryDeleteTitle'),
    detail: t('agents.sessionHistoryDeleteBody', { name: item.label }),
    buttons: [t('common.delete'), t('common.cancel')],
    defaultId: 1,
    cancelId: 1
  }
  const firstResult =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, first)
      : await dialog.showMessageBox(first)
  if (firstResult.response !== 0) return

  const second = {
    type: 'warning' as const,
    title: t('agents.sessionHistoryDeleteAgainTitle'),
    message: t('agents.sessionHistoryDeleteAgainTitle'),
    detail: t('agents.sessionHistoryDeleteAgainBody'),
    buttons: [t('common.delete'), t('common.cancel')],
    defaultId: 1,
    cancelId: 1
  }
  const secondResult =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, second)
      : await dialog.showMessageBox(second)
  if (secondResult.response !== 0) return

  deleteSwarmHistoryRecord(itemId, conversationId)
}

function deleteSwarmHistoryRecord(itemId: string, conversationId: string): void {
  const parsed = parseSwarmHistoryId(itemId)
  if (!parsed || parsed.kind !== 'session') return
  const key = swarmSessionKey(parsed.agentId, parsed.sessionId)
  swarmHistoryStore.remove(key)

  const liveTabs = new Set(
    ptyManager
      .listCliAgentSessions()
      .filter((session) => session.conversationId === conversationId)
      .map((session) => session.id)
  )
  const bindings = conversationStore.getCliPaneBindings(conversationId)
  for (const [tabId, binding] of Object.entries(bindings)) {
    if (liveTabs.has(tabId)) continue
    if (binding.agentId !== parsed.agentId) continue
    if (nativeSessionId(binding.cursor) !== parsed.sessionId) continue
    conversationStore.deleteCliPaneBinding(conversationId, tabId)
  }
  publishConversations()
  refreshTraySessions()
}

/** Debounce: menu accelerator + globalShortcut can both fire when vav is focused. */
let lastDetachedSessionAt = 0

/** ⌘⇧↵ from anywhere: a brand new conversation, straight into its own window. */
function newDetachedSession(): void {
  const now = Date.now()
  if (now - lastDetachedSessionAt < 450) return
  lastDetachedSessionAt = now
  sessionOpenT0 = now
  sessionOpenMark('hotkey:start')
  const settings = settingsStore.get()
  const defaultHost = resolveDefaultChatHost(settings.defaultAgentId)
  const conversation = conversationStore.create(
    resolveNewWorkdir(),
    modelForNewConversation(defaultHost),
    {
      approvalMode: settings.defaultApprovalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(settings.defaultThinkingLevel),
      cliHost: defaultHost
    }
  )
  ephemeralConversations.add(conversation.id)
  sessionOpenMark('hotkey:created', conversation.id)
  // ⌘⇧↵: tools panel starts collapsed (main-chat.rpml).
  // raiseDetachedWindow handles focus — do not app.focus alone (fullscreen steal).
  // Defer sidebar broadcast so main-window re-render does not fight the raise.
  void openDetachedWindow(conversation.id, { collapseTools: true, requestedAt: now }).then(
    () => sessionOpenMark('hotkey:open-settled', conversation.id)
  )
  setImmediate(() => publishConversations())
  sessionOpenMark('hotkey:open-dispatched', conversation.id)
}

/**
 * At most one renderer-driven popup at a time.
 * Without this, ⌘⇧O / chip menus stack when the user switches sessions or
 * re-opens before the previous AppKit menu closes — leaving a sticky menu.
 */
let activeNativePopup: {
  menu: Electron.Menu
  window: BrowserWindow
  finish: () => void
  seq: number
} | null = null
let nativePopupSeq = 0

function closeActiveNativePopup(): void {
  const active = activeNativePopup
  if (!active) return
  activeNativePopup = null
  // Invalidate any deferred popup() that has not shown yet.
  nativePopupSeq += 1
  try {
    if (!active.window.isDestroyed()) active.menu.closePopup(active.window)
    else active.menu.closePopup()
  } catch {
    // Menu may already be gone
  }
  active.finish()
}

/**
 * Native popup menu driven by the renderer.
 *
 * Resolves to the chosen row's id — `click` fires before popup's `callback`,
 * so the id is already settled by the time the menu reports that it closed.
 */
function popupNativeMenu(
  window: BrowserWindow,
  items: NativeMenuItem[],
  position?: { x: number; y: number }
): Promise<string | null> {
  // Dismiss any previous popup first (session switch / double ⌘⇧O).
  closeActiveNativePopup()
  const seq = ++nativePopupSeq

  return new Promise((resolve) => {
    let chosen: string | null = null
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      if (activeNativePopup?.seq === seq) activeNativePopup = null
      // setImmediate so click handlers that themselves open menus still run first.
      setImmediate(() => resolve(chosen))
    }

    // Use `radio` (not `checkbox`) for exclusive picks like model / approval mode.
    // Checkbox groups on AppKit often fail to fire click for non-checked rows.
    const toTemplate = (rows: NativeMenuItem[]): Electron.MenuItemConstructorOptions[] =>
      rows.map((item) => {
        if (item.separator) return { type: 'separator' }
        if (item.role) return { role: item.role, label: item.label }
        if (item.submenu && item.submenu.length > 0) {
          return {
            type: 'submenu',
            label: item.label ?? '',
            enabled: item.enabled !== false,
            submenu: toTemplate(item.submenu)
          }
        }
        const hasCheck = item.checked !== undefined
        return {
          label: item.label ?? '',
          enabled: item.enabled !== false,
          type: hasCheck ? 'radio' : 'normal',
          checked: hasCheck ? !!item.checked : undefined,
          click: () => {
            chosen = item.id ?? null
          }
        }
      })
    const template: Electron.MenuItemConstructorOptions[] = toTemplate(items)

    const opts: Electron.PopupOptions = {
      window,
      callback: finish
    }
    // Only pass coordinates when valid — undefined x/y crashes Menu.popup on some Electron builds.
    // Renderer sends content-view (client) coords; with `window` set, Electron treats x/y as
    // relative to that window's content area.
    if (
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y)
    ) {
      opts.x = Math.round(position.x)
      opts.y = Math.round(position.y)
    }

    // Dev: every native menu gets Inspect Element (custom menus otherwise block it).
    // Use isDevRuntime — branded vav.app often reports isPackaged=true.
    if (isDevRuntime()) {
      const x = opts.x ?? 0
      const y = opts.y ?? 0
      if (template.length) template.push({ type: 'separator' })
      template.push({
        label: 'Inspect Element',
        click: () => {
          const wc = window.webContents
          wc.inspectElement(x, y)
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' })
        }
      })
    }

    // Defer past the originating mouseup. Opening a native menu synchronously inside a
    // button click often dismisses it immediately (menu never appears).
    setTimeout(() => {
      if (window.isDestroyed() || seq !== nativePopupSeq) {
        finish()
        return
      }
      try {
        const menu = Menu.buildFromTemplate(template)
        activeNativePopup = { menu, window, finish, seq }
        menu.popup(opts)
      } catch {
        finish()
      }
    }, 0)
  })
}

type SnapshotPlanStep = {
  file: string
  js?: string
  /** Runs in the child window after open (e.g. expand agent panel). */
  childJs?: string
  delayMs?: number
  /** Capture the newest non-main BrowserWindow instead of the main window. */
  child?: boolean
  /** Override capture size. Companion / ⌘⇧↵ shots must stay a tall column. */
  width?: number
  height?: number
}

type SnapshotPlan = {
  dir: string
  settleMs?: number
  steps: SnapshotPlanStep[]
}

/**
 * Development-only screenshot hook.
 *
 * Single shot:
 *   `VAV_SNAPSHOT=<file> [VAV_SNAPSHOT_JS=<expr>]`
 *
 * Multi shot (marketing gallery):
 *   `VAV_SNAPSHOT_PLAN=<plan.json>` where plan is
 *   `{ "dir": "...", "steps": [{ "file": "a.png", "js": "..." }, ...] }`
 */
function installSnapshotHook(window: BrowserWindow): void {
  const planPath = process.env.VAV_SNAPSHOT_PLAN
  const target = process.env.VAV_SNAPSHOT
  if (!planPath && !target) return

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  const runJs = async (source: string | undefined): Promise<void> => {
    if (!source) return
    try {
      const result = await window.webContents.executeJavaScript(source, true)
      console.log('[snapshot] script result:', result)
    } catch (err) {
      console.error('[snapshot] script failed', err)
    }
  }

  const captureWindow = async (
    win: BrowserWindow,
    outPath: string,
    size?: { width?: number; height?: number }
  ): Promise<void> => {
    if (win.isMinimized()) win.restore()
    const width = size?.width ?? (win === window ? 1440 : 1280)
    const height = size?.height ?? (win === window ? 900 : 820)
    // CSS pixels of the live window — not a 2× frame. A 1520-tall request
    // gets clamped on a laptop work area and the companion looks squat.
    try {
      const area = screen.getDisplayMatching(win.getBounds()).workArea
      const left = area.x + Math.max(16, Math.round((area.width - width) / 2))
      const top = area.y + Math.max(16, Math.round((area.height - height) / 2))
      win.setBounds({ x: left, y: top, width, height })
    } catch {
      win.setSize(width, height)
    }
    win.setContentSize(width, height)
    await sleep(win === window ? 400 : 450)
    const image = await win.webContents.capturePage()
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, image.toPNG())
    const px = image.getSize()
    console.log(`[snapshot] wrote ${outPath} ${px.width}×${px.height}`)
  }

  const capture = async (): Promise<void> => {
    // Bootstrap + directory listing need a beat after first paint.
    await sleep(3200)

    if (planPath) {
      const plan = JSON.parse(readFileSync(planPath, 'utf8')) as SnapshotPlan
      await sleep(plan.settleMs ?? 0)
      for (const step of plan.steps) {
        await runJs(step.js)
        await sleep(step.delayMs ?? 700)
        const outPath = join(plan.dir, step.file)
        if (step.child) {
          // Prefer the newest visible companion (detached / token popup). Skip the
          // warmed-but-hidden token-usage window so ⌘⇧↵ captures stay correct.
          const child = BrowserWindow.getAllWindows()
            .filter(
              (w) =>
                w !== window &&
                !w.isDestroyed() &&
                w.isVisible() &&
                w !== tokenUsageWindow &&
                w !== providerAccountWindow
            )
            .sort((a, b) => b.id - a.id)[0]
          if (!child) {
            console.error(`[snapshot] missing child window for ${step.file}`)
            continue
          }
          if (step.childJs) {
            try {
              const result = await child.webContents.executeJavaScript(step.childJs, true)
              console.log('[snapshot] child script result:', result)
            } catch (err) {
              console.error('[snapshot] child script failed', err)
            }
            await sleep(500)
          }
          await captureWindow(child, outPath, { width: step.width, height: step.height })
          child.destroy()
        } else {
          await captureWindow(window, outPath, { width: step.width, height: step.height })
        }
      }
      quitting = true
      app.exit(0)
      return
    }

    await runJs(process.env.VAV_SNAPSHOT_JS)
    await sleep(600)
    await captureWindow(window, target!)
    quitting = true
    app.exit(0)
  }

  window.webContents.once('did-finish-load', () => {
    void capture()
  })
}

async function showMainWindow(): Promise<void> {
  // Hidden-Dock sessions still need a visible window when the user (or a second
  // launch) asks for the app — briefly surface the Dock so Mission Control /
  // Cmd-Tab can find us too.
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    app.dock.show()
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    if (!win.webContents.isLoading()) return
    await new Promise<void>((resolve) => {
      const done = (): void => resolve()
      win.webContents.once('did-finish-load', done)
      setTimeout(done, 2000)
    })
    return
  }
  await revealBrowserWindow(mainWindow)
}

/**
 * Dock click / bare second-instance: raise the window the user was last in.
 * Do not force the main shell forward when a companion is already open.
 */
function pickActivateWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  if (!windows.length) return null

  const last =
    lastFocusedWindow && !lastFocusedWindow.isDestroyed() ? lastFocusedWindow : null
  // Hidden warm Settings / token shells stay in getAllWindows — only raise them
  // when they were last focused and are still visible (or minimized).
  if (
    last &&
    (last.isVisible() || last.isMinimized() || !isAuxiliaryWindow(last))
  ) {
    return last
  }

  const visibleContent = windows.find(
    (w) => (w.isVisible() || w.isMinimized()) && !isAuxiliaryWindow(w)
  )
  if (visibleContent) return visibleContent

  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  return windows.find((w) => !isAuxiliaryWindow(w)) ?? null
}

function activateApp(): void {
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    app.dock.show()
  }
  const target = pickActivateWindow()
  if (!target) {
    mainWindow = createWindow()
    return
  }
  void (async () => {
    if (target.isDestroyed()) return
    // Main + Settings use the paint-safe reveal; companions use the Space hop.
    if (
      (mainWindow && !mainWindow.isDestroyed() && target.id === mainWindow.id) ||
      (settingsWindow && !settingsWindow.isDestroyed() && target.id === settingsWindow.id)
    ) {
      await revealBrowserWindow(target)
    } else {
      await raiseDetachedWindow(target)
    }
    if (target.isDestroyed()) return
    // focus() may raise `target` above Settings / other Quick Chats — re-pin.
    try {
      target.focus()
    } catch {
      // ignore
    }
    enforceAppZOrder(target)
  })()
}

/**
 * Mint a conversation at `workdir` (or the default Temporary), optionally seed
 * composer attachments, then focus the main window on it.
 *
 * Shared by CLI (`vav <path>`), Dock drag-and-drop, and second-instance handoff.
 */
function openWorkspaceSession(options: {
  workdirArg: string | null
  attachments?: string[]
}): void {
  showMainWindow()
  let toast: string | null = null
  const requested = options.workdirArg
  const workdir = resolveExistingDirectory(requested)
  if (requested && !workdir) {
    toast = t('toast.pathMissing')
  }
  const resolved = workdir ?? resolveNewWorkdir()
  if (workdir) {
    settingsStore.rememberWorkspaceDirectory(workdir, tmpdir())
    broadcast(IPC.settingsChanged, currentSettings())
  }
  const sessionSettings = settingsStore.get()
  const defaultHost = resolveDefaultChatHost(sessionSettings.defaultAgentId)
  const conversation = conversationStore.create(
    resolved,
    modelForNewConversation(defaultHost),
    {
      approvalMode: sessionSettings.defaultApprovalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(sessionSettings.defaultThinkingLevel),
      cliHost: defaultHost
    }
  )
  if (defaultHost) promoteEphemeralConversation(conversation.id)
  publishConversations()
  const payload = {
    conversationId: conversation.id,
    toast,
    attachments: options.attachments?.length ? options.attachments : undefined
  }
  const send = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    safeSend(mainWindow.webContents, IPC.cliOpen, payload)
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => setTimeout(send, 50))
  } else {
    setTimeout(send, 50)
  }
}

/** `vav /path` (or `vav .`) — directory-only open (settings-cli.rpml annotation 6). */
function openFromCli(workdirArg: string | null): void {
  openWorkspaceSession({ workdirArg })
}

/**
 * Dock / Finder "Open With" (file-preview.rpml):
 * - Each file → its own File Preview window (never replace an open preview)
 * - Folder(s) only → session with that workdir
 * - Mix of folders + files → session with attachments (folder wins as workdir)
 */
function openFromDroppedPaths(paths: string[]): void {
  const dirs: string[] = []
  const files: string[] = []
  for (const p of paths) {
    if (!p) continue
    try {
      if (!existsSync(p)) continue
      const full = realpathSync(p)
      if (statSync(full).isDirectory()) dirs.push(full)
      else files.push(full)
    } catch {
      // skip
    }
  }
  // Prefer opening every file as its own preview when the drop is files-only.
  if (files.length > 0 && dirs.length === 0) {
    for (const file of files) {
      openFilePreviewWindow(file, { origin: 'dock' })
    }
    return
  }
  const resolved = classifyOpenPaths(paths)
  if (resolved.kind === 'preview') {
    openFilePreviewWindow(resolved.file, { origin: 'dock' })
    return
  }
  openWorkspaceSession({
    workdirArg: resolved.workdir,
    attachments: resolved.attachments
  })
}

/** A launch argument that will become a preview window rather than a session. */
function isPreviewableColdOpenPath(path: string): boolean {
  if (!path) return false
  try {
    return existsSync(path) && !statSync(realpathSync(path)).isDirectory()
  } catch {
    return false
  }
}

/** Coalesce bursty macOS `open-file` events from a single Dock drop. */
const pendingOpenPaths: string[] = []
let pendingOpenTimer: ReturnType<typeof setTimeout> | null = null
let appReadyForOpens = false

function enqueueOpenPath(path: string): void {
  pendingOpenPaths.push(path)
  if (!appReadyForOpens) return
  if (pendingOpenTimer) clearTimeout(pendingOpenTimer)
  pendingOpenTimer = setTimeout(() => {
    pendingOpenTimer = null
    const batch = [...new Set(pendingOpenPaths.splice(0, pendingOpenPaths.length))]
    if (batch.length) openFromDroppedPaths(batch)
  }, 40)
}

function flushPendingOpens(extra: string[] = []): void {
  appReadyForOpens = true
  if (pendingOpenTimer) {
    clearTimeout(pendingOpenTimer)
    pendingOpenTimer = null
  }
  const batch = [...new Set([...pendingOpenPaths.splice(0, pendingOpenPaths.length), ...extra])]
  if (batch.length) openFromDroppedPaths(batch)
}

function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    hideLeavingFullscreen(mainWindow)
    return
  }
  showMainWindow()
}

/**
 * Always-on global shortcuts (work even when another app has focus).
 * Menu accelerators alone only fire while vav is the active app — that is why
 * ⌘⇧↵ felt "broken" for summoning a new chat from anywhere.
 */
function registerGlobalHotkey(accelerator: string): boolean {
  globalShortcut.unregisterAll()
  let toggleOk = true
  // 1) Configurable show/hide main window
  if (accelerator) {
    try {
      toggleOk = globalShortcut.register(accelerator, () => {
        console.log(`[hotkey] toggle fired: ${accelerator}`)
        toggleMainWindow()
      })
      if (!toggleOk) {
        console.warn(`[hotkey] failed to register toggle hotkey: ${accelerator}`)
      } else {
        console.log(`[hotkey] registered toggle: ${accelerator}`)
      }
    } catch (err) {
      console.warn('[hotkey] toggle register threw', err)
      toggleOk = false
    }
  } else {
    console.log('[hotkey] toggle hotkey cleared (empty)')
  }
  // 2) New detached session from any app (default ⌘⇧↵ / Ctrl+Shift+Enter)
  const newSessionAccel = currentKeyBindings().newSessionWindow
  try {
    const ok = globalShortcut.register(newSessionAccel, () => {
      console.log(`[hotkey] new-session fired: ${newSessionAccel}`)
      newDetachedSession()
    })
    if (!ok) {
      console.warn(
        `[hotkey] failed to register global new-session: ${newSessionAccel} (taken by another app?)`
      )
    } else {
      console.log(`[hotkey] registered global new-session: ${newSessionAccel}`)
    }
  } catch (err) {
    console.warn('[hotkey] new-session register threw', err)
  }
  return toggleOk
}

function applyTheme(theme: AppSettings['theme']): void {
  nativeTheme.themeSource = theme
}

/** Fallback when the OS cannot report an accent (Linux, old macOS, errors). */
const FALLBACK_SYSTEM_ACCENT = '#007aff'

/** Last hex we broadcast — avoid spam on focus re-samples. */
let lastBroadcastAccent: string | null = null

/**
 * Normalize any Electron accent string to `#rrggbb`.
 * `systemPreferences.getAccentColor` returns `rrggbbaa` (no hash).
 * `getColor` / event payloads may be `#rrggbbaa` or `#rrggbb`.
 */
function normalizeAccentHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(cleaned)) return null
  return `#${cleaned.slice(0, 6)}`
}

/** Read the current OS accent colour (macOS 10.14+ / Windows). */
function readSystemAccentColor(): string {
  try {
    const fromPrefs = normalizeAccentHex(systemPreferences.getAccentColor())
    if (fromPrefs) return fromPrefs
  } catch {
    // Unavailable on some platforms / older OS builds.
  }
  if (process.platform === 'win32') {
    try {
      // Highlight is the closest Windows system colour to "accent".
      const highlight = normalizeAccentHex(systemPreferences.getColor('highlight'))
      if (highlight) return highlight
    } catch {
      // ignore
    }
  }
  return FALLBACK_SYSTEM_ACCENT
}

/** Push accent to all windows when it actually changed. */
function publishSystemAccentColor(force = false): string {
  const hex = readSystemAccentColor()
  if (!force && hex === lastBroadcastAccent) return hex
  lastBroadcastAccent = hex
  broadcast(IPC.accentColorChanged, hex)
  return hex
}

/** Wire OS accent listeners (Windows/Linux event + focus re-sample for macOS). */
function watchSystemAccentColor(): void {
  lastBroadcastAccent = readSystemAccentColor()
  try {
    // Documented for win32/linux; safe no-op if the event never fires elsewhere.
    systemPreferences.on('accent-color-changed', (_event, newColor) => {
      const hex = normalizeAccentHex(newColor) ?? readSystemAccentColor()
      if (hex === lastBroadcastAccent) return
      lastBroadcastAccent = hex
      broadcast(IPC.accentColorChanged, hex)
    })
  } catch {
    // ignore
  }
  // macOS has no accent-color-changed event — re-sample when a window focuses.
  app.on('browser-window-focus', (_event, window) => {
    if (window && !window.isDestroyed()) lastFocusedWindow = window
    publishSystemAccentColor(false)
    notifications.acknowledgeFocusedWindow(window)
  })
  app.on('browser-window-created', (_event, window) => {
    window.on('closed', () => notifications.forgetWindow(window.id))
  })
}

// ---------------------------------------------------------------------------
// Working directories
// ---------------------------------------------------------------------------

/** Always mint a Temporary Workspace folder (switcher “A new temp folder”). */
function mintTempWorkdir(): string {
  const dir = join(tmpdir(), 'vav', randomUUID().slice(0, 8), 'Workspace')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return tmpdir()
  }
  return dir
}

/** Empty default workdir mints a Temporary Workspace folder (README §2.5). */
function resolveNewWorkdir(): string {
  const configured = settingsStore.get().defaultWorkingDirectory.trim()
  if (configured) return configured
  return mintTempWorkdir()
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function currentSettings(): AppSettings {
  const settings = settingsStore.get()
  const dest = surfacePatternFilePath(app.getPath('userData'))
  const hasFile = existsSync(dest)
  let customSurfacePatternUrl = ''
  if (hasFile) {
    let rev = 0
    try {
      rev = Math.round(statSync(dest).mtimeMs)
    } catch {
      // ignore
    }
    customSurfacePatternUrl = `${localFileStreamUrl(dest)}&rev=${rev}`
  }
  return {
    ...settings,
    apiKeyPresent: secretStore.has('api'),
    braveSearchKeyPresent: secretStore.has('braveSearch'),
    cloudflareApiTokenPresent: secretStore.has('cloudflare'),
    supabaseAccessTokenPresent: secretStore.has('supabase'),
    customSurfacePatternUrl,
    surfacePattern: settings.surfacePattern === 'custom' && !hasFile ? 'none' : settings.surfacePattern
  }
}

/** CFBundleVersion stand-in: YYYY.MMDD.patch from package version + calendar day. */
function appBuildNumber(): string {
  const version = app.getVersion()
  const now = new Date()
  const y = now.getFullYear()
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const patch = version.split('.').pop() ?? '0'
  return `${y}.${md}.${patch}`
}

function registerIpc(): void {
  ipcMain.handle(IPC.secretsStatus, () => secretStore.status())
  ipcMain.handle(IPC.secretsUnlock, () => {
    const result = secretStore.unlock()
    if (result.ok) {
      invalidateAnalysisCache()
      void serveAnalysisSnapshot({ refresh: false }).catch((err) => {
        console.error('[analysis] post-unlock warm failed', err)
      })
    }
    return result
  })

  ipcMain.handle(IPC.bootstrap, (): Bootstrap => {
    // Bootstrap must not force Keychain before onboarding unlock on macOS.
    const settings = currentSettings()
    setLocalePreference(settings.locale)
    const conversations = conversationStore.listMeta()
    const activeConversationId =
      conversations.find((c) => !c.archived)?.id ?? conversations[0]?.id ?? ''
    return {
      settings,
      resolvedLocale: currentLocale(),
      systemAccentColor: readSystemAccentColor(),
      conversations,
      activeConversationId,
      apiKeyHint: secretStore.maskedHint(),
      platform: PLATFORM,
      home: app.getPath('home'),
      tmp: tmpdir(),
      about: {
        version: app.getVersion(),
        buildNumber: appBuildNumber(),
        electron: process.versions.electron,
        userDataPath: app.getPath('userData'),
        conversationsPath: conversationStore.path
      }
    }
  })

  // --- settings ---
  ipcMain.handle(IPC.settingsGet, () => currentSettings())

  ipcMain.handle(IPC.settingsUpdate, (_event, patch: Partial<AppSettings>) => {
    const previous = settingsStore.get()
    const next = settingsStore.update(patch)
    if (patch.theme && patch.theme !== previous.theme) applyTheme(next.theme)
    if (patch.shell && patch.shell !== previous.shell) agent.applyShellSetting()
    if (patch.globalHotkey !== undefined && patch.globalHotkey !== previous.globalHotkey) {
      registerGlobalHotkey(next.globalHotkey)
    }
    if (patch.locale !== undefined && patch.locale !== previous.locale) {
      setLocalePreference(next.locale)
      rebuildAppChrome()
    }
    if (patch.keyBindings !== undefined) {
      rebuildAppChrome()
      // Rebind global ⌘⇧↵ (or user override) alongside the toggle hotkey.
      registerGlobalHotkey(next.globalHotkey)
    }
    if (
      patch.trayEnabled !== undefined ||
      patch.hideDockIcon !== undefined ||
      patch.notificationsEnabled !== undefined
    ) {
      notifications.applySettings()
    }
    if (patch.keepAwakeWhileAgentRunning !== undefined) {
      syncSleepBlocker()
    }
    if (patch.windowVibrancyEnabled !== undefined) {
      syncVibrancyShellWindows()
    }
    if (
      patch.displayCurrency !== undefined &&
      patch.displayCurrency !== previous.displayCurrency &&
      tokenUsageConversationId &&
      tokenUsageConversationId !== '_'
    ) {
      sendTokenUsagePayload(tokenUsageConversationId)
    }
    const settings = currentSettings()
    broadcast(IPC.settingsChanged, settings)
    return settings
  })

  ipcMain.handle(IPC.settingsReset, () => {
    secretStore.clear('api')
    secretStore.clear('braveSearch')
    secretStore.clear('cloudflare')
    secretStore.clear('supabase')
    const next = settingsStore.reset()
    setLocalePreference(next.locale)
    applyTheme(next.theme)
    registerGlobalHotkey(next.globalHotkey)
    rebuildAppChrome()
    syncVibrancyShellWindows()
    syncSleepBlocker()
    const settings = currentSettings()
    broadcast(IPC.settingsChanged, settings)
    return settings
  })

  ipcMain.handle(IPC.settingsSetKey, (_event, key: string) => {
    secretStore.set(key, 'api')
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint('api') }
  })

  ipcMain.handle(IPC.settingsRevealKey, () => secretStore.get('api'))
  ipcMain.handle(IPC.settingsKeyHint, () => secretStore.maskedHint('api'))

  ipcMain.handle(IPC.settingsSetBraveSearchKey, (_event, key: string) => {
    secretStore.set(key, 'braveSearch')
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint('braveSearch') }
  })
  ipcMain.handle(IPC.settingsBraveSearchKeyHint, () => secretStore.maskedHint('braveSearch'))

  ipcMain.handle(IPC.settingsSetCloudflareToken, (_event, token: string) => {
    secretStore.set(token, 'cloudflare')
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint('cloudflare') }
  })
  ipcMain.handle(IPC.settingsCloudflareTokenHint, () => secretStore.maskedHint('cloudflare'))

  ipcMain.handle(IPC.settingsSetSupabaseToken, (_event, token: string) => {
    secretStore.set(token, 'supabase')
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint('supabase') }
  })
  ipcMain.handle(IPC.settingsSupabaseTokenHint, () => secretStore.maskedHint('supabase'))

  ipcMain.handle(IPC.settingsValidateKey, async (_event, key: string) => {
    const settings = settingsStore.get()
    const effective = key?.trim() || secretStore.get('api')
    if (!effective) return { ok: false, message: t('error.noApiKeyShort') }
    return validateApiKey(settings.apiEndpoint, effective, settings.defaultModel)
  })

  // Candidates only; the renderer filters these down to fonts actually
  // installed on this machine (settings-appearance.rpml).
  ipcMain.handle(IPC.settingsFonts, () => codeFonts(PLATFORM))

  ipcMain.handle(IPC.settingsSetHotkey, (_event, accelerator: string) => {
    const ok = registerGlobalHotkey(accelerator)
    // A rejected accelerator is not persisted, so the previous one survives.
    if (ok) settingsStore.update({ globalHotkey: accelerator })
    else registerGlobalHotkey(settingsStore.get().globalHotkey)
    const settings = currentSettings()
    if (ok) broadcast(IPC.settingsChanged, settings)
    return { ok, settings }
  })

  ipcMain.handle(IPC.settingsPickDirectory, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.settingsPickSurfacePattern, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? settingsWindow
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'PNG', extensions: ['png'] }]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    const file = result.canceled ? null : (result.filePaths[0] ?? null)
    if (!file) return null
    try {
      const dest = surfacePatternFilePath(app.getPath('userData'))
      const imported = await importSurfacePattern(file, dest)
      if (!imported.ok) return { ok: false as const, reason: imported.reason }
      settingsStore.update({
        surfacePattern: 'custom',
        customSurfacePatternSize: imported.size,
        customSurfacePatternUrl: ''
      })
      const settings = currentSettings()
      broadcast(IPC.settingsChanged, settings)
      return { ok: true as const, url: settings.customSurfacePatternUrl, size: imported.size }
    } catch {
      return { ok: false as const, reason: 'invalid' as const }
    }
  })

  ipcMain.handle(IPC.settingsPickColor, (_event, defaultHex?: string) => {
    // `choose color` returns 16-bit RGB {r,g,b} (0–65535).
    // Must be async — the dialog is modal and blocks until the user closes it.
    const rgb16 = parseHexToRgb16(defaultHex) ?? [0, 0, 0]
    // AppleScript `&` with a numeric left operand builds a LIST (prints as
    // "65535, ,, 0"), which fails the 3-part parse below — join via text item
    // delimiters so OK returns plain "r,g,b". Cancel throws -128 → err → null.
    const script = `set c to choose color default color {${rgb16[0]}, ${rgb16[1]}, ${rgb16[2]}}
set AppleScript's text item delimiters to ","
return c as text`
    return new Promise<string | null>((resolve) => {
      execFile('/usr/bin/osascript', ['-e', script], { timeout: 120_000, encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null)
        const out = stdout.trim()
        if (!out || out === 'false') return resolve(null) // cancelled
        const parts = out.split(',')
        if (parts.length !== 3) return resolve(null)
        const r = Math.round(Number(parts[0]) / 65535 * 255)
        const g = Math.round(Number(parts[1]) / 65535 * 255)
        const b = Math.round(Number(parts[2]) / 65535 * 255)
        if ([r, g, b].some((v) => Number.isNaN(v))) return resolve(null)
        resolve(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`)
      })
    })
  })

  ipcMain.handle(IPC.settingsCliStatus, () => getCliStatus()) // async — login PATH probe
  ipcMain.handle(IPC.settingsCliSetLocation, (_event, location: CliInstallLocation) =>
    setCliPreferredLocation(location)
  )
  ipcMain.handle(IPC.settingsCliInstall, () => installCli())
  ipcMain.handle(IPC.settingsCliUninstall, () => uninstallCli())
  ipcMain.handle(IPC.settingsFileAssociations, () => fileAssociationService.listStatus())
  ipcMain.handle(IPC.settingsFileAssociationForPath, async (_event, path: string) => {
    const id = formatIdForPath(path)
    if (!id) return null
    return fileAssociationService.statusFor(
      fileAssociationService.formats().find((f) => f.id === id)!
    )
  })
  ipcMain.handle(IPC.settingsSetFileAssociation, (_event, formatId: string) =>
    fileAssociationService.setDefault(formatId)
  )
  ipcMain.handle(IPC.settingsUnsetFileAssociation, (_event, formatId: string) =>
    fileAssociationService.unsetDefault(formatId)
  )
  ipcMain.handle(IPC.settingsRegisterAllFileAssociations, () =>
    fileAssociationService.registerAll()
  )
  const analysisHasApiKey = (): boolean => {
    if (secretStore.has('api')) return true
    if (secretStore.status().hasKeyFile) {
      secretStore.unlock()
      return secretStore.has('api')
    }
    return false
  }
  const lookupVavApiBalance = async (force: boolean) => {
    const endpoint = settingsStore.get().apiEndpoint
    const supported = Boolean(deepseekBalanceUrl(endpoint))
    if (!supported) return { supported: false, balance: null }
    analysisHasApiKey()
    const balance = await fetchDeepSeekApiBalance({
      apiKey: secretStore.get('api'),
      endpoint,
      force
    })
    return { supported: true, balance }
  }
  configureAnalysisCache({
    conversations: () => conversationStore.all(),
    apiKeyPresent: analysisHasApiKey,
    readBalance: lookupVavApiBalance,
    onUpdated: (snapshot) => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        safeSend(settingsWindow.webContents, IPC.settingsAnalysisUpdated, snapshot)
      }
    },
    build: async (force) => {
      const settings = settingsStore.get()
      const catalogue = DEFAULT_CLI_AGENTS
      const configured = settings.cliAgents ?? []
      let presentIds: string[] | undefined
      try {
        const seen = new Set<string>()
        const specs: Array<{ id: string; candidates: string[] }> = []
        for (const agent of [...catalogue, ...configured]) {
          if (!agent.id || seen.has(agent.id)) continue
          seen.add(agent.id)
          specs.push({ id: agent.id, candidates: agentBinaryCandidates(agent, catalogue) })
        }
        const found = probeAgentExecutables(specs, { force })
        presentIds = Object.entries(found)
          .filter(([, path]) => Boolean(path))
          .map(([id]) => id)
      } catch (err) {
        console.error('[analysis] binary probe failed', err)
      }
      return await buildAnalysisSnapshot({
        conversations: conversationStore.all(),
        cliAgents: configured,
        catalogue,
        presentIds,
        apiKeyPresent: analysisHasApiKey(),
        forceRefresh: force,
        refreshQuotas: (forceRefresh) => quotaService.refreshAllHosts(forceRefresh),
        quotaWindows: (host) => quotaService.get(host),
        readAccount: (host) => readHostAccountInfo(host),
        readApiBalance: () => lookupVavApiBalance(force)
      })
    }
  })
  if (secretStore.has('api')) {
    void serveAnalysisSnapshot({ refresh: false }).catch((err) => {
      console.error('[analysis] prefetch failed', err)
    })
  }
  ipcMain.handle(IPC.settingsAnalysis, async (_event, options?: { refresh?: boolean }) => {
    try {
      return await serveAnalysisSnapshot(options)
    } catch (err) {
      console.error('[analysis] snapshot failed', err)
      throw err
    }
  })

  // --- conversations ---
  ipcMain.handle(IPC.convList, () => conversationStore.listMeta())
  ipcMain.handle(IPC.convGet, (_event, id: string) => conversationStore.get(id) ?? null)

  ipcMain.handle(
    IPC.convCreate,
    (
      _event,
      options?: { workingDirectory?: string | null; model?: string }
    ): ConversationMeta => {
      const workdir =
        options && 'workingDirectory' in options
          ? (options.workingDirectory ?? null)
          : resolveNewWorkdir()
      const settings = settingsStore.get()
      const model = options?.model?.trim() || settings.defaultModel
      if (workdir) {
        settingsStore.rememberWorkspaceDirectory(workdir, tmpdir())
        broadcast(IPC.settingsChanged, currentSettings())
      }
      const defaultHost = resolveDefaultChatHost(settings.defaultAgentId)
      const conversation = conversationStore.create(
        workdir,
        modelForNewConversation(defaultHost, model),
        {
          approvalMode: settings.defaultApprovalMode ?? 'auto',
          thinkingLevel: parseThinkingLevel(settings.defaultThinkingLevel),
          cliHost: defaultHost
        }
      )
      if (defaultHost) promoteEphemeralConversation(conversation.id)
      const { messages: _messages, ...meta } = conversation
      void _messages
      publishConversations()
      return meta
    }
  )

  ipcMain.handle(IPC.convRename, (_event, id: string, title: string) => {
    const next = title.trim() || t('common.untitledSession')
    conversationStore.updateMeta(id, { title: next })
    const detached = detachedWindows.get(id)
    if (detached && !detached.isDestroyed()) detached.setTitle(next)
    publishConversations()
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convSetLeaf, (_event, id: string, leafId: string) => {
    conversationStore.setActiveLeaf(id, leafId)
  })

  ipcMain.handle(IPC.convSetPinned, (_event, id: string, pinned: boolean) => {
    conversationStore.setPinned(id, pinned)
    publishConversations()
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convSetArchived, (_event, id: string, archived: boolean) => {
    if (archived) {
      void agent.cancel(id)
      clearUnseenForConversation(id)
      persistResultUnseen(id, false)
    }
    conversationStore.setArchived(id, archived)
    publishConversations()
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convSetApprovalMode, (_event, id: string, mode: string) => {
    if (mode === 'auto' || mode === 'bypass' || mode === 'edit') {
      conversationStore.setApprovalMode(id, mode)
      publishConversations()
    }
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convSetThinkingLevel, (_event, id: string, level: string) => {
    conversationStore.setThinkingLevel(id, parseThinkingLevel(level))
    publishConversations()
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convContinueNew, (_event, id: string, messageId: string) => {
    const conversation = conversationStore.branchToNewConversation(id, messageId)
    if (!conversation) return null
    const { messages: _messages, ...meta } = conversation
    void _messages
    publishConversations()
    return meta
  })

  ipcMain.handle(IPC.convDuplicate, (_event, id: string) => {
    const conversation = conversationStore.duplicate(id)
    if (!conversation) return null
    const { messages: _messages, ...meta } = conversation
    void _messages
    publishConversations()
    return meta
  })

  ipcMain.handle(IPC.convExportPack, async (event, ids: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return vavPackService.exportConversations(Array.isArray(ids) ? ids : [], win)
  })

  ipcMain.handle(IPC.convImportPack, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await vavPackService.importPackage(win)
    if (result.ok) publishConversations()
    return result
  })

  ipcMain.handle(IPC.convSetModel, (_event, id: string, model: string) => {
    const host = (conversationStore.get(id)?.cliHost ?? null) as CliHostKind | null
    conversationStore.updateMeta(id, {
      model,
      tokenLimit: contextWindowForModel(host, model)
    })
    if (cliHost.owns(id)) cliHost.applyModel(id, model)
    publishConversations()
    pushTokenUsageIfOpen(id)
    return conversationStore.listMeta()
  })

  ipcMain.handle(
    IPC.convSetAgentBinary,
    (_event, id: string, agentBinaryName: string | null) => {
      conversationStore.updateMeta(id, { agentBinaryName })
      // Selecting a CLI agent (or returning to vav after one) is durable intent —
      // never auto-delete this ⌘⇧↵ session when the companion window closes.
      if (agentBinaryName) promoteEphemeralConversation(id)
      publishConversations()
      return conversationStore.listMeta()
    }
  )

  ipcMain.handle(
    IPC.convSetCliHost,
    (_event, id: string, host: string | null) => {
      const prev = conversationStore.get(id)
      const prevHost = prev?.cliHost ?? null
      const nextHost = isStructuredCliHost(host) ? host : null
      const hostChanged = prevHost !== nextHost
      if (hostChanged && (prev?.messages.length ?? 0) > 0) {
        return {
          conversations: conversationStore.listMeta(),
          hostChanged: false,
          transcript: null
        }
      }
      if (hostChanged) {
        // Park previous host's transcript, restore the next host's bucket.
        // Runtimes are per-host; tear down so the wrong process cannot resume.
        agent.disposeConversation(id)
        cliHost.dispose(id)
        changeSetStore.clearConversation(id)
        conversationStore.switchHostTranscript(id, nextHost)
        swarmSession.syncHostCursor(id, nextHost)
        // Empty buckets keep the previous host's model string — coerce so the
        // picker / context-window panel do not show a foreign VAV preset.
        coerceConversationModel(id)
      } else {
        conversationStore.updateMeta(id, {
          cliHost: nextHost,
          agentBinaryName: nextHost
        })
      }
      if (nextHost) promoteEphemeralConversation(id)
      publishConversations()
      const conversation = conversationStore.get(id)
      return {
        conversations: conversationStore.listMeta(),
        hostChanged,
        transcript: conversation
          ? {
              messages: conversation.messages,
              activeLeafId: conversation.activeLeafId,
              compactions: conversation.compactions ?? [],
              tokenHistory: conversation.tokenHistory ?? [],
              tokensUsed: conversation.tokensUsed,
              cacheCreatedAt: conversation.cacheCreatedAt,
              cacheExpiresAt: conversation.cacheExpiresAt,
              cliResumeCursor: conversation.cliResumeCursor ?? null,
              cliHost: conversation.cliHost ?? null,
              model: conversation.model,
              quotaWindows: conversation.quotaWindows ?? []
            }
          : null
      }
    }
  )

  ipcMain.handle(
    IPC.convSetFocusedFile,
    (_event, id: string, path: string | null) => {
      const existing = conversationStore.get(id)
      // View-state only: must not reorder the sidebar. Do not publish a full
      // list refresh — callers patch focusedFilePath locally.
      if (existing && (existing.focusedFilePath ?? null) === path) {
        return conversationStore.listMeta()
      }
      conversationStore.updateMeta(id, { focusedFilePath: path })
      // No publishConversations() — selecting / previewing a file is not activity.
      return conversationStore.listMeta()
    }
  )

  ipcMain.handle(IPC.convAccountQuota, async (_event, id: string, hostOverride?: unknown) => {
    const conversation = conversationStore.get(id)
    if (!conversation) return null
    const host =
      hostOverride === null
        ? null
        : typeof hostOverride === 'string' && isStructuredCliHost(hostOverride)
          ? hostOverride
          : (conversation.cliHost ?? null)
    const account = await readHostAccountInfo(host)
    await quotaService.refreshForPanel(host)
    return {
      host,
      hostName: host ? displayNameForCliHost(host) : 'VAV',
      signedIn: account.signedIn,
      accountId: account.accountId,
      plan: account.plan,
      authKind: account.authKind,
      windows: host
        ? mergeQuotaWindowsPreferNewer(quotaService.get(host), conversation.quotaWindows ?? [])
        : []
    }
  })

  const applyWorkingDirectory = (id: string, path: string): ConversationMeta[] => {
    const prev = conversationStore.get(id)?.workingDirectory ?? null
    conversationStore.updateMeta(id, { workingDirectory: path })
    agent.setWorkingDirectory(id, path)
    // Live CLI drivers + resume cursors are bound to the old root.
    if (prev !== path) {
      cliHost.setWorkingDirectory(id, path)
      swarmSession.clearForConversation(id)
    }
    fileService.watchRoot(id, path)
    settingsStore.rememberWorkspaceDirectory(path, tmpdir())
    broadcast(IPC.settingsChanged, currentSettings())
    publishConversations()
    return conversationStore.listMeta()
  }

  ipcMain.handle(IPC.convSetWorkdir, (_event, id: string, path: string) =>
    applyWorkingDirectory(id, path)
  )

  ipcMain.handle(IPC.convPickWorkdir, async (_event, id: string) => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    return applyWorkingDirectory(id, result.filePaths[0])
  })

  ipcMain.handle(IPC.convUseTempWorkdir, (_event, id: string) =>
    applyWorkingDirectory(id, mintTempWorkdir())
  )

  ipcMain.handle(
    IPC.convLocateWorkspace,
    async (_event, id: string, destinationDir: string, name: string) => {
      const conversation = conversationStore.get(id)
      if (!conversation?.workingDirectory) {
        return { ok: false as const, error: t('error.locateNoTemp') }
      }
      const source = conversation.workingDirectory
      const safeName = name.trim().replace(/[\\/]/g, '-') || 'workspace'
      const target = join(destinationDir, safeName)
      try {
        if (existsSync(target)) {
          return { ok: false as const, error: t('error.locateExists', { target }) }
        }
        mkdirSync(destinationDir, { recursive: true })
        renameSync(source, target)
        // Best-effort cleanup of empty parent temp folders.
        try {
          rmdirSync(dirname(source))
          rmdirSync(dirname(dirname(source)))
        } catch {
          // leave leftover empty dirs
        }
        return { ok: true as const, conversations: applyWorkingDirectory(id, target) }
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : t('error.locateFailed')
        }
      }
    }
  )

  ipcMain.handle(IPC.convRemove, (_event, ids: string[]) => {
    const removed = conversationStore.remove(ids)
    for (const id of removed) {
      clearUnseenForConversation(id)
      // Deleting a conversation is the one path that tears down its processes.
      agent.disposeConversation(id)
      cliHost.dispose(id)
      swarmSession.clearForConversation(id)
      ptyManager.killForConversation(id)
      fileService.unwatch(id)
      notifications.acknowledgeConversation(id)
    }
    if (removed.length) conversationStore.flush()
    publishConversations()
    return { removed, conversations: conversationStore.listMeta() }
  })

  ipcMain.handle(IPC.convReveal, (_event, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.convCopy, (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle(IPC.convCopyImage, (_event, base64Png: string) => {
    try {
      const raw = typeof base64Png === 'string' ? base64Png.trim() : ''
      if (!raw) return { ok: false as const, error: 'empty image' }
      // Accept accidental data-URL prefix from callers.
      const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
      const image = nativeImage.createFromBuffer(Buffer.from(b64, 'base64'))
      if (image.isEmpty()) return { ok: false as const, error: 'invalid png' }
      clipboard.writeImage(image)
      return { ok: true as const }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle(IPC.convSelectBranch, (_event, id: string, messageId: string) =>
    conversationStore.selectBranch(id, messageId)
  )

  // --- agent (built-in pi loop OR structured CLI host) ---
  ipcMain.handle(
    IPC.agentSend,
    (
      _event,
      id: string,
      text: string,
      attachments: string[],
      quote?: import('@shared/types').QuoteDraft | null,
      contextBlocks?: import('@shared/types').PreviewRef[] | null,
      contextFile?: string | null
    ) => {
      // Not awaited: the turn streams for as long as it needs, and the renderer
      // is driven entirely by turn events.
      if (conversationStore.get(id)?.archived) return
      if (agentFor(id) === 'cli') {
        void cliHost.run(
          id,
          text,
          attachments ?? [],
          quote ?? null,
          contextBlocks ?? null,
          contextFile ?? null
        )
        return
      }
      void agent.run(
        id,
        text,
        attachments ?? [],
        quote ?? null,
        contextBlocks ?? null,
        contextFile ?? null
      )
    }
  )
  ipcMain.handle(IPC.agentAppendNotice, (_event, id: string, text: string) => {
    agent.appendNotice(id, text)
  })
  ipcMain.handle(IPC.agentCancel, (_event, id: string) => {
    if (agentFor(id) === 'cli') cliHost.cancel(id)
    else agent.cancel(id)
  })
  ipcMain.handle(IPC.agentAnswer, (_event, id: string, toolCallId: string, answer: string) => {
    if (cliHost.answer(id, toolCallId, answer)) return true
    return agent.answer(id, toolCallId, answer)
  })
  ipcMain.handle(IPC.agentStatus, (_event, id: string) =>
    agentFor(id) === 'cli' ? cliHost.status(id) : agent.status(id)
  )
  ipcMain.handle(IPC.agentRegenerate, (_event, id: string, messageId: string) => {
    if (conversationStore.get(id)?.archived) return
    if (agentFor(id) === 'cli') void cliHost.regenerate(id, messageId)
    else void agent.regenerate(id, messageId)
  })
  ipcMain.handle(IPC.agentEditUser, (_event, id: string, messageId: string, text: string) => {
    if (conversationStore.get(id)?.archived) return
    if (agentFor(id) === 'cli') void cliHost.editUserMessage(id, messageId, text)
    else void agent.editUserMessage(id, messageId, text)
  })
  ipcMain.handle(IPC.agentFork, (_event, id: string, messageId: string) => {
    if (conversationStore.get(id)?.archived) return null
    return agent.fork(id, messageId)
  })
  ipcMain.handle(
    IPC.agentCompact,
    async (_event, id: string, options?: { keepAfterMessageId?: string | null }) => {
      const conversation = conversationStore.get(id)
      if (conversation?.archived) {
        return { ok: false as const, error: t('session.archivedReadonly') }
      }
      if (conversation?.cliHost) {
        return { ok: false as const, error: t('compact.error.cliHost') }
      }
      const result = await agent.compact(id, options)
      if (result.ok) {
        const next = conversationStore.get(id)
        broadcast(IPC.compactionsChanged, {
          conversationId: id,
          compactions: next?.compactions ?? []
        })
        pushTokenUsageIfOpen(id)
      }
      return result
    }
  )
  ipcMain.handle(IPC.agentClearCompaction, (_event, id: string, leafId: string) => {
    const conversation = conversationStore.get(id)
    if (conversation?.cliHost) {
      return { ok: false as const, error: t('compact.error.cliHost') }
    }
    const result = agent.clearCompaction(id, leafId)
    if (result.ok) {
      const next = conversationStore.get(id)
      broadcast(IPC.compactionsChanged, {
        conversationId: id,
        compactions: next?.compactions ?? []
      })
      pushTokenUsageIfOpen(id)
    }
    return result
  })

  // --- files ---
  ipcMain.handle(
    IPC.filesList,
    (_event, path: string, sort: FileSortKey, ascending: boolean) =>
      fileService.listDirectory(path, sort, ascending)
  )
  ipcMain.handle(IPC.filesRead, (_event, path: string) => fileService.readTextFile(path))
  ipcMain.handle(
    IPC.filesReadTextWindow,
    (
      _event,
      path: string,
      opts?: { startByte?: number; maxBytes?: number; force?: boolean }
    ) => fileService.readTextWindow(path, opts)
  )
  ipcMain.handle(IPC.filesReadBinary, (_event, path: string) => fileService.readBinary(path))
  ipcMain.handle(
    IPC.filesReadBinaryWindow,
    (_event, path: string, opts?: { startByte?: number; maxBytes?: number }) =>
      fileService.readBinaryWindow(path, opts)
  )
  ipcMain.handle(IPC.filesWriteBinary, (_event, path: string, base64: string) =>
    fileService.writeBinary(path, base64)
  )
  ipcMain.handle(
    IPC.filesWriteClip,
    (
      _event,
      input: { filename: string; base64?: string; text?: string }
    ) => writeClip(input)
  )
  ipcMain.handle(IPC.filesWrite, (_event, path: string, content: string) =>
    fileService.writeTextFile(path, content)
  )
  ipcMain.handle(
    IPC.filesWorkingCopyEnsure,
    async (_event, path: string, opts?: { fileId?: string | null }) => {
      try {
        const st = await workingCopyService.ensure(String(path || ''), {
          fileId: opts?.fileId
        })
        return { ok: true as const, ...st }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle(IPC.filesWorkingCopyPromote, async (_event, path: string) =>
    workingCopyService.promote(String(path || ''))
  )
  ipcMain.handle(IPC.filesWorkingCopyDiscard, async (_event, path: string) => {
    const result = await workingCopyService.discard(String(path || ''), { reseed: true })
    if (!result.ok) return result
    const st = workingCopyService.status(String(path || ''))
    return { ok: true as const, dirty: st?.dirty ?? false }
  })
  ipcMain.handle(IPC.filesWorkingCopyStatus, (_event, path: string) =>
    workingCopyService.status(String(path || ''))
  )
  ipcMain.handle(IPC.filesQuickLook, (_event, path: string) => fileService.preview(path))
  ipcMain.handle(IPC.filesOpenWithDefault, (_event, path: string) => fileService.openWithDefault(path))
  ipcMain.handle(IPC.gitStatus, (_event, cwd: string) => getGitSnapshot(cwd))
  ipcMain.handle(
    IPC.gitDiff,
    (_event, cwd: string, path: string, opts?: { staged?: boolean }) => getGitDiff(cwd, path, opts)
  )
  ipcMain.handle(
    IPC.gitShowBase64,
    (_event, cwd: string, path: string, ref?: string) =>
      getGitShowBase64(cwd, path, ref || 'HEAD')
  )
  ipcMain.handle(IPC.gitInit, (_event, cwd: string) => initGitRepo(cwd))
  ipcMain.handle(
    IPC.gitCreateBranch,
    (_event, cwd: string, name: string, opts?: { checkout?: boolean }) =>
      createGitBranch(cwd, name, opts)
  )
  ipcMain.handle(IPC.gitCheckoutBranch, (_event, cwd: string, name: string) =>
    checkoutGitBranch(cwd, name)
  )
  ipcMain.handle(
    IPC.gitCreateWorktree,
    (
      _event,
      cwd: string,
      options: { path: string; newBranch?: string; branch?: string }
    ) => createGitWorktree(cwd, options)
  )
  ipcMain.handle(
    IPC.githubListPulls,
    (_event, cwd: string, state?: import('@shared/github').GithubPullStateFilter) =>
      listGithubPulls(cwd, state)
  )
  ipcMain.handle(IPC.githubGetPull, (_event, cwd: string, number: number) =>
    getGithubPull(cwd, number)
  )
  ipcMain.handle(
    IPC.cloudflareStatus,
    (_event, cwd: string, query?: import('@shared/cloudflare').CloudflareStatusQuery) =>
      getCloudflareStatus(
        String(cwd || ''),
        {
          token: secretStore.get('cloudflare'),
          accountId: settingsStore.get().cloudflareAccountId || null
        },
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
  )
  ipcMain.handle(
    IPC.supabaseStatus,
    (_event, cwd: string, query?: import('@shared/supabase').SupabaseStatusQuery) =>
      getSupabaseStatus(
        String(cwd || ''),
        {
          token: secretStore.get('supabase'),
          projectRef: settingsStore.get().supabaseProjectRef || null
        },
        query && typeof query === 'object' ? { remote: query.remote !== false } : undefined
      )
  )
  ipcMain.handle(
    IPC.githubListActions,
    (_event, cwd: string, scope?: import('@shared/github').GithubActionsScope) =>
      listGithubActions(cwd, scope)
  )
  ipcMain.handle(IPC.githubGetActionRun, (_event, cwd: string, runId: number) =>
    getGithubActionRun(cwd, runId)
  )
  ipcMain.handle(IPC.githubGetSite, (_event, cwd: string) => getGithubSite(cwd))
  ipcMain.handle(IPC.githubListReleases, (_event, cwd: string) => listGithubReleases(cwd))
  ipcMain.handle(IPC.filesWatch, (_event, id: string, root: string | null) =>
    fileService.watchRoot(id, root)
  )
  ipcMain.handle(IPC.previewSetCloseGuard, (event, enabled: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (enabled) previewCloseGuards.add(win)
    else previewCloseGuards.delete(win)
  })
  ipcMain.handle(IPC.previewForceClose, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    previewCloseGuards.delete(win)
    afterLeavingFullscreen(win, () => {
      if (win.isDestroyed()) return
      parkWarmPreviewShell(win)
    })
  })
  ipcMain.on(IPC.previewShellReady, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    if (isAppClipBrowserWindow(win)) {
      overlayWarmReady.add(win)
      return
    }
    warmPreviewReady.add(win)
    previewOpenMark('warm-shell-ready')
  })
  ipcMain.on(IPC.sessionShellReady, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    warmSessionReady.add(win)
    sessionOpenMark('warm-shell-ready')
    // Refresh recovery: bound companion reloaded as warm=1 (or lost claim) —
    // push the conversation back into the renderer.
    const boundId = detachedWindowIds.get(win)
    if (boundId) pushDetachedSessionClaim(win, boundId)
  })
  ipcMain.handle(
    IPC.filesInspectStructured,
    (
      _event,
      path: string,
      opts?: { maxBlocks?: number; maxRows?: number }
    ) => fileService.inspectStructured(String(path || ''), opts)
  )
  ipcMain.handle(
    IPC.filesSaveAs,
    async (
      event,
      defaultName: string,
      content: string
    ): Promise<{ ok: true; path: string } | { ok: false; cancelled?: boolean; error?: string }> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.SaveDialogOptions = {
        defaultPath: defaultName,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
      const written = await fileService.writeTextFile(result.filePath, content)
      if (!written.ok) return { ok: false, error: written.error }
      return { ok: true, path: result.filePath }
    }
  )
  ipcMain.handle(IPC.filesRename, (_event, path: string, newName: string) =>
    fileService.rename(path, newName)
  )
  ipcMain.handle(IPC.filesTrash, (_event, paths: string[]) => fileService.trash(paths))
  ipcMain.handle(
    IPC.filesInspect,
    (_event, path: string) => takePreloadedInspect(path) ?? fileService.inspect(path)
  )
  ipcMain.handle(
    IPC.filesDbQuery,
    (_event, path: string, table: string, offset?: number, limit?: number) =>
      fileService.dbQuery(path, table, offset, limit)
  )
  ipcMain.handle(IPC.filesParseBlocks, async (_event, path: string, text: string) => {
    if (!isTsJsPath(path)) return null
    try {
      // typescript compiler is heavy — load only when a TS/JS preview needs AST blocks.
      const { parseTsCodeBlocks } = await import('./preview/parseTsCodeBlocks')
      return parseTsCodeBlocks(path, text)
    } catch {
      return null
    }
  })

  // --- FileSessionStore (File Preview multi-session, hidden from sidebar) ---
  const toFileSessionsState = (
    fileId: string,
    activeSessionId: string,
    sessions: { id: string; title: string; createdAt: number; updatedAt: number }[]
  ) => ({ fileId, activeSessionId, sessions })

  ipcMain.handle(IPC.fileSessionsOpen, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const settings = settingsStore.get()
    const opened = await fileSessionStore.open(
      path,
      settings.defaultModel,
      settings.defaultApprovalMode ?? 'auto',
      parseThinkingLevel(settings.defaultThinkingLevel)
    )
    // Don't broadcast file sessions into the main sidebar list (already filtered).
    return toFileSessionsState(opened.fileId, opened.activeSessionId, opened.sessions)
  })

  ipcMain.handle(IPC.fileSessionsCreate, async (_event, path: string) => {
    if (!isFileSessionEligible(path)) return null
    const settings = settingsStore.get()
    const created = await fileSessionStore.createSession(
      path,
      settings.defaultModel,
      settings.defaultApprovalMode ?? 'auto',
      parseThinkingLevel(settings.defaultThinkingLevel)
    )
    return toFileSessionsState(created.fileId, created.activeSessionId, created.sessions)
  })

  ipcMain.handle(
    IPC.fileSessionsSetActive,
    (_event, fileId: string, sessionId: string) => {
      const sessions = fileSessionStore.setActive(fileId, sessionId)
      if (!sessions) return null
      return toFileSessionsState(fileId, sessionId, sessions)
    }
  )

  ipcMain.handle(IPC.fileSessionsList, (_event, fileId: string) => {
    const listed = fileSessionStore.list(fileId)
    if (!listed) return null
    return toFileSessionsState(fileId, listed.activeSessionId, listed.sessions)
  })
  ipcMain.handle(IPC.fileSessionsListAll, () => fileSessionStore.listAll())
  ipcMain.handle(IPC.fileSessionsResolve, (_event, fileId: string) =>
    fileSessionStore.resolve(fileId)
  )
  ipcMain.handle(
    IPC.fileSessionsForceDelete,
    (_event, fileId: string, sessionIds: string[]) =>
      fileSessionStore.forceDelete(fileId, sessionIds)
  )

  ipcMain.handle(IPC.fileSessionsSetReadOnly, (_event, sessionId: string, readOnly: boolean) => {
    conversationStore.updateMeta(sessionId, { fileReadOnly: readOnly })
    broadcast(IPC.fileSessionReadOnlyChanged, { sessionId, readOnly })
  })

  ipcMain.handle(
    IPC.fileSessionsRename,
    (_event, fileId: string, sessionId: string, title: string) => {
      const sessions = fileSessionStore.rename(fileId, sessionId, title)
      if (!sessions) return null
      const listed = fileSessionStore.list(fileId)
      if (!listed) return null
      return toFileSessionsState(fileId, listed.activeSessionId, sessions)
    }
  )

  ipcMain.handle(
    IPC.fileSessionsDelete,
    (_event, fileId: string, sessionIds: string[]) => {
      const result = fileSessionStore.deleteSessions(fileId, sessionIds)
      if (!result) return null
      for (const id of result.removed) {
        agent.disposeConversation(id)
        cliHost.dispose(id)
        swarmSession.clearForConversation(id)
        ptyManager.killForConversation(id)
        fileService.unwatch(id)
      }
      return {
        ok: result.ok,
        error: result.error,
        removed: result.removed,
        fileId,
        activeSessionId: result.activeSessionId,
        sessions: result.sessions
      }
    }
  )

  // --- agents (CLI binary probe) ---
  ipcMain.handle(
    IPC.agentsResolveBinary,
    (_event, candidates: string[], force?: boolean) => {
      const list = Array.isArray(candidates)
        ? candidates.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : []
      // Cached by default so agent switches are instant; force only on explicit recheck.
      return resolveAgentExecutable(list, { force: force === true })
    }
  )

  ipcMain.handle(
    IPC.agentsProbeBinaries,
    (_event, items: unknown, force?: boolean) => {
      const list = Array.isArray(items) ? items : []
      const specs: Array<{ id: string; candidates: string[] }> = []
      for (const row of list) {
        if (!row || typeof row !== 'object') continue
        const rec = row as { id?: unknown; candidates?: unknown }
        const id = typeof rec.id === 'string' ? rec.id.trim() : ''
        if (!id) continue
        const candidates = Array.isArray(rec.candidates)
          ? rec.candidates.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          : []
        specs.push({ id, candidates })
      }
      return probeAgentExecutables(specs, { force: force === true })
    }
  )

  ipcMain.handle(
    IPC.agentsListModels,
    (_event, host: string | null, force?: boolean) =>
      listHostModels(host, settingsStore, {
        force: force === true,
        apiKey: secretStore.get()
      })
  )

  ipcMain.handle(IPC.agentsGetModelCatalog, () => {
    const snap = getModelCatalogSnapshot()
    if (Object.keys(snap).length > 0) return snap
    return seedModelCatalog(settingsStore)
  })

  ipcMain.handle(IPC.agentsPreloadModels, async (_event, force?: boolean) => {
    const catalog = await preloadHostModels(settingsStore, {
      force: force === true,
      prefer: preferredModelHosts(),
      onProgress: publishModelCatalog,
      apiKey: secretStore.get()
    })
    publishModelCatalog(catalog)
    return catalog
  })

  ipcMain.handle(
    IPC.agentsInstallStart,
    (_event, payload: { agentId?: string; name?: string; command?: string }) =>
      startAgentInstall({
        agentId: typeof payload?.agentId === 'string' ? payload.agentId : '',
        name: typeof payload?.name === 'string' ? payload.name : '',
        command: typeof payload?.command === 'string' ? payload.command : ''
      })
  )
  ipcMain.handle(IPC.agentsInstallCancel, (_event, agentId: string) => {
    cancelAgentInstall(String(agentId || ''))
  })
  ipcMain.handle(IPC.agentsInstallClear, (_event, agentId: string) => {
    clearAgentInstall(String(agentId || ''))
  })
  ipcMain.handle(IPC.agentsListInstallRuns, () => listAgentInstallRuns())
  onAgentInstallRunsChanged((runs) => broadcast(IPC.agentsInstallRunsChanged, runs))

  // --- pty ---
  ipcMain.handle(
    IPC.ptyCreate,
    async (
      _event,
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      options?: import('@shared/ipc').PtyCreateOptions | string
    ) => {
      // Spawning a shell or CLI agent host is enough to keep a ⌘⇧↵ session.
      promoteEphemeralConversation(conversationId)
      const base: import('@shared/ipc').PtyCreateOptions =
        typeof options === 'string' ? { preferredId: options } : { ...(options ?? {}) }
      const agentId = typeof base.agentId === 'string' ? base.agentId : null
      const tabId = base.preferredId || randomUUID()
      let launch = { ...base, preferredId: tabId }
      const attaching = ptyManager.willAttachCreate(conversationId, launch)
      if (!attaching && agentId && isStructuredCliHost(agentId)) {
        const planned = await swarmSession.prepareLaunch(
          conversationId,
          tabId,
          agentId,
          launch.args ?? [],
          launch.resumeCursor
            ? { cursor: launch.resumeCursor, title: launch.sessionTitle ?? null }
            : undefined
        )
        launch = { ...launch, args: planned.args }
      }
      const id = ptyManager.create(
        conversationId,
        settingsStore.get().shell,
        cwd,
        cols,
        rows,
        launch
      )
      if (!attaching && agentId && isStructuredCliHost(agentId)) {
        swarmSession.afterSpawn(conversationId, id, agentId)
      }
      return id
    }
  )
  // Fire-and-forget: high-frequency input (keys, mouse wheel in TUI mouse mode)
  // and resize storms must not pay an invoke round-trip per event.
  ipcMain.on(IPC.ptyWrite, (_event, tabId: unknown, data: unknown) => {
    if (typeof tabId !== 'string' || typeof data !== 'string') return
    ptyManager.write(tabId, data)
  })
  ipcMain.on(
    IPC.ptyResize,
    (event, tabId: unknown, cols: unknown, rows: unknown, force?: unknown) => {
      if (typeof tabId !== 'string' || typeof cols !== 'number' || typeof rows !== 'number') return
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
      // Focused viewer drives size; force=true re-delivers SIGWINCH after alt rebuild.
      ptyManager.resize(tabId, cols, rows, event.sender.id, force === true)
    }
  )
  ipcMain.handle(IPC.ptyKill, (_event, tabId: string) => {
    const conversationId = ptyManager.conversationIdFor(tabId)
    if (conversationId) swarmSession.forgetPane(conversationId, tabId)
    return ptyManager.kill(tabId)
  })
  ipcMain.handle(IPC.ptyIsBusy, (_event, tabId: string) => ptyManager.isBusy(tabId))
  ipcMain.handle(IPC.ptyList, (_event, conversationId: string) =>
    ptyManager.listForConversation(String(conversationId || ''))
  )
  ipcMain.handle(
    IPC.ptySetLayouts,
    (
      _event,
      conversationId: string,
      layouts: import('@shared/types').ConversationPtyLayouts
    ) => {
      ptyManager.setLayouts(String(conversationId || ''), layouts ?? { bash: null, agents: {} })
    }
  )
  ipcMain.handle(IPC.ptyReplay, (_event, tabId: string) =>
    ptyManager.replay(String(tabId || ''))
  )

  // --- window ---
  ipcMain.handle(IPC.windowSetTheme, (_event, theme: AppSettings['theme']) => applyTheme(theme))
  ipcMain.handle(IPC.windowGetAccentColor, () => readSystemAccentColor())
  ipcMain.handle(IPC.windowShellPath, (_event, kind: ShellKind) => shellPath(kind))

  ipcMain.handle(IPC.windowOpenSettings, (_event, view?: SettingsView, agentId?: string) =>
    openSettingsWindow(view, typeof agentId === 'string' ? agentId : undefined)
  )
  ipcMain.handle(IPC.windowCloseSettings, () => hideSettingsWindow())

  ipcMain.handle(IPC.windowOpenSession, async (_event, id: string) => {
    // Must not return BrowserWindow — structured clone can't send it over IPC.
    await openDetachedWindow(String(id || ''))
  })
  ipcMain.handle(IPC.windowRevealInList, async (event, id: string) => {
    await revealConversationInList(String(id || ''))
    // Companion (detached session or file-preview): close the window that asked
    // so focus lands cleanly on main (same as Reveal in List for SessionWindow).
    const senderWin = BrowserWindow.fromWebContents(event.sender)
    if (
      senderWin &&
      !senderWin.isDestroyed() &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      senderWin.id !== mainWindow.id
    ) {
      senderWin.close()
    }
  })
  ipcMain.handle(IPC.windowCloseDetached, (_event, id: string) => {
    const conversationId = String(id || '')
    if (!conversationId) return
    const win = detachedWindows.get(conversationId)
    if (win && !win.isDestroyed()) {
      // closed handler publishes detached list + lets main remount the PTY host.
      win.close()
    }
  })
  ipcMain.handle(IPC.windowNewDetached, () => newDetachedSession())
  ipcMain.handle(IPC.windowListDetached, () => listDetachedConversationIds())
  ipcMain.handle(
    IPC.windowOpenFilePreview,
    (
      _event,
      path: string,
      options?: { origin?: 'dock' | 'session'; conversationId?: string; surface?: 'file' | 'app' }
    ) => openFilePreviewWindow(path, options)
  )
  ipcMain.handle(IPC.windowOpenOverlay, (_event, payload: OverlayPayload) => {
    if (!payload || typeof payload !== 'object') return
    openAppClipWindow(payload)
  })
  ipcMain.handle(
    IPC.windowOpenTokenUsage,
    (
      event,
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ) => openTokenUsageWindow(event.sender, conversationId, anchor)
  )
  // Panel pulls on mount — avoids missing the push during React StrictMode remount.
  ipcMain.handle(IPC.tokenUsageGetView, () => {
    const payload = currentTokenUsagePayload()
    if (payload) requestAccountQuota(payload.conversationId)
    return payload
  })
  ipcMain.handle(
    IPC.windowOpenProviderAccount,
    (
      event,
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ) => openProviderAccountWindow(event.sender, conversationId, anchor)
  )
  ipcMain.handle(IPC.providerAccountGetView, () => currentProviderAccountPayload())
  ipcMain.handle(IPC.providerAccountFit, (_event, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    fitProviderAccountWindow(height)
  })
  ipcMain.handle(
    IPC.windowOpenSwarmHistory,
    (
      event,
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ) => popupSwarmHistoryMenu(event.sender, conversationId, anchor)
  )
  ipcMain.handle(IPC.windowRelaunch, () => {
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle(IPC.notificationsPermission, () => notifications.permissionStatus())
  ipcMain.on(IPC.notificationsSeen, (event, conversationId: unknown) => {
    const id = typeof conversationId === 'string' ? conversationId.trim() : ''
    if (!id) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return
    notifications.noteConversationView(window.id, id)
    markResultViewed(id)
  })

  ipcMain.handle(
    IPC.dialogAlert,
    async (
      event,
      options: { title: string; message: string; confirmLabel?: string }
    ): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const opts: Electron.MessageBoxOptions = {
        type: 'info',
        title: options.title,
        message: options.title,
        detail: options.message,
        buttons: [options.confirmLabel ?? t('common.ok')],
        defaultId: 0
      }
      if (window && !window.isDestroyed()) await dialog.showMessageBox(window, opts)
      else await dialog.showMessageBox(opts)
    }
  )

  ipcMain.handle(
    IPC.dialogConfirm,
    async (
      event,
      options: {
        title: string
        message: string
        confirmLabel?: string
        cancelLabel?: string
        destructive?: boolean
      }
    ): Promise<boolean> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const confirmLabel = options.confirmLabel ?? t('common.confirm')
      const cancelLabel = options.cancelLabel ?? t('common.cancel')
      // macOS draws buttons[0] on the right (primary). Prefer cancel as default
      // for destructive actions so Enter does not wipe data by accident.
      const opts: Electron.MessageBoxOptions = {
        type: options.destructive ? 'warning' : 'question',
        title: options.title,
        message: options.title,
        detail: options.message,
        buttons: [confirmLabel, cancelLabel],
        defaultId: options.destructive ? 1 : 0,
        cancelId: 1
      }
      const result =
        window && !window.isDestroyed()
          ? await dialog.showMessageBox(window, opts)
          : await dialog.showMessageBox(opts)
      return result.response === 0
    }
  )

  ipcMain.handle(
    IPC.dialogMessageBox,
    async (
      event,
      options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title: string
        message: string
        detail?: string
        buttons: string[]
        defaultId?: number
        cancelId?: number
      }
    ): Promise<number> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const buttons =
        options.buttons?.length > 0 ? options.buttons : [t('common.ok')]
      const opts: Electron.MessageBoxOptions = {
        type: options.type ?? 'question',
        title: options.title,
        message: options.message || options.title,
        detail: options.detail,
        buttons,
        defaultId: options.defaultId ?? 0,
        cancelId: options.cancelId ?? buttons.length - 1
      }
      const result =
        window && !window.isDestroyed()
          ? await dialog.showMessageBox(window, opts)
          : await dialog.showMessageBox(opts)
      return result.response
    }
  )

  ipcMain.handle(
    IPC.windowPopupMenu,
    (event, items: NativeMenuItem[], position?: { x: number; y: number }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      return window ? popupNativeMenu(window, items, position) : null
    }
  )
  ipcMain.handle(IPC.windowClosePopupMenu, () => {
    closeActiveNativePopup()
  })

  ipcMain.handle(IPC.changeSetGet, (_e, id: string) => changeSetStore.get(id))
  ipcMain.handle(IPC.changeSetActive, (_e, conversationId: string) =>
    changeSetStore.activeFor(conversationId)
  )
  ipcMain.handle(IPC.changeSetAccept, (_e, setId: string, filePaths: string[]) =>
    changeSetStore.accept(setId, filePaths)
  )
  ipcMain.handle(IPC.changeSetReject, (_e, setId: string, filePaths: string[]) =>
    changeSetStore.reject(setId, filePaths)
  )
  ipcMain.handle(IPC.changeSetAcceptAll, (_e, setId: string) => changeSetStore.acceptAll(setId))
  ipcMain.handle(IPC.changeSetRejectAll, (_e, setId: string) => changeSetStore.rejectAll(setId))
  ipcMain.handle(IPC.changeSetUndo, (_e, setId: string, filePath: string) =>
    changeSetStore.undo(setId, filePath)
  )
  ipcMain.handle(IPC.changeSetApplyEdit, (_e, setId: string, filePath: string, content: string) =>
    changeSetStore.applyEdit(setId, filePath, content)
  )

  ipcMain.handle(IPC.updatesGet, () => updateService.getState())
  ipcMain.handle(IPC.updatesCheck, () => updateService.check())
  ipcMain.handle(IPC.updatesOpenDownload, () => updateService.openDownload())
  ipcMain.handle(IPC.updatesInstall, () => {
    updateService.install()
  })
  updateService.setWillInstallHandler(() => {
    // Hide-on-close + tray/Dock keep-alive otherwise swallow Squirrel.Mac /
    // NSIS quitAndInstall (windows preventDefault close; app never exits).
    quitting = true
    app.removeAllListeners('window-all-closed')
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.removeAllListeners('close')
    }
    if (IS_MAC) {
      // Squirrel.Mac emits this on electron's autoUpdater (not app). Run the
      // same teardown as before-quit, then exit so the process cannot linger
      // with a Tray/Dock-only lifetime after windows close.
      electronAutoUpdater.once('before-quit-for-update', () => {
        agent.disposeAll()
        cliHost.disposeAll()
        ptyManager.killAll()
        fileService.disposeAll()
        conversationStore.flush()
        app.exit(0)
      })
    }
  })
  updateService.onChange((state) => broadcast(IPC.updatesChanged, state))

}

/** Dev/smoke: create a 2-file ChangeSet and open Change Review in the UI. */
async function seedSmokeChangeReview(): Promise<void> {
  // Wait for renderer bootstrap / conversation list.
  await new Promise((r) => setTimeout(r, 2200))
  let meta = conversationStore.listMeta().find((c) => !c.archived)
  if (!meta) {
    console.log('[smoke] minting conversation for seed')
    const s = settingsStore.get()
    const created = conversationStore.create(resolveNewWorkdir(), s.defaultModel, {
      approvalMode: s.defaultApprovalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(s.defaultThinkingLevel)
    })
    meta = conversationStore.listMeta().find((c) => c.id === created.id)
    broadcast(IPC.convChanged, conversationStore.listMeta())
    await new Promise((r) => setTimeout(r, 400))
  }
  if (!meta) {
    console.error('[smoke] still no conversation')
    return
  }
  const workdir = meta.workingDirectory || app.getPath('temp')
  const dir = join(workdir, '.vav-smoke')
  mkdirSync(dir, { recursive: true })
  const modified = join(dir, 'existing.ts')
  const added = join(dir, 'added.ts')
  writeFileSync(modified, 'const a = 1\n', 'utf8')
  changeSetStore.beginTurn(meta.id, workdir)
  changeSetStore.recordWrite(meta.id, workdir, modified, 'const a = 1\n', 'const a = 2\n')
  changeSetStore.recordWrite(meta.id, workdir, added, null, 'export const x = 1\n')
  writeFileSync(modified, 'const a = 2\n', 'utf8')
  writeFileSync(added, 'export const x = 1\n', 'utf8')
  const set = await changeSetStore.finalizeTurn(meta.id, 'smoke change review', meta.model || 'test')
  if (!set) {
    console.error('[smoke] finalize failed')
    return
  }
  // Emit twice spaced so a late-joining renderer still opens the panel.
  handleAgentEvent({
    type: 'change-review',
    conversationId: meta.id,
    changeSetId: set.id,
    pendingCount: set.files.length,
    changeSet: set
  })
  await new Promise((r) => setTimeout(r, 300))
  handleAgentEvent({
    type: 'change-review',
    conversationId: meta.id,
    changeSetId: set.id,
    pendingCount: set.files.length,
    changeSet: set
  })
  console.log('[smoke] seeded change review', set.id, 'conv', meta.id)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  // Straight out, with no listeners attached. A second instance exists only to
  // hand focus to the first one; it has loaded nothing and so has nothing to
  // save, and the teardown below would write its empty stores over the real
  // ones on the way out.
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (argvRequestsCliOpen(argv)) {
      openFromCli(parseCliWorkdir(argv))
      return
    }
    const dropped = parseOpenPathsFromArgv(argv)
    if (dropped.length) {
      openFromDroppedPaths(dropped)
      return
    }
    activateApp()
  })

  // Must register before ready — macOS delivers Dock / Finder opens here.
  // will-finish-launching is the earliest reliable hook for cold-start drops.
  app.on('will-finish-launching', () => {
    app.on('open-file', (event, filePath) => {
      event.preventDefault()
      enqueueOpenPath(filePath)
    })
  })

  // Closing the last window must not quit while Dock (macOS) or tray (Windows)
  // can bring the app back — background turns and PTYs keep running.
  app.on('window-all-closed', () => {
    if (IS_MAC || notifications.hasTray()) return
    app.quit()
  })

  app.on('before-quit', () => {
    quitting = true
    sleepBlocker.release()
    agent.disposeAll()
    cliHost.disposeAll()
    stopAllAgentInstalls()
    ptyManager.killAll()
    fileService.disposeAll()
    quotaService.stop()
    conversationStore.flush()
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.whenReady().then(async () => {
    applyBranding()
    // Login PATH via zsh -ilc is ~2s; start it now so model probes don't pay it sync.
    void ensureLoginPath()
    protocol.handle('vav-local', async (request) => {
      try {
        const requested = decodeURIComponent(new URL(request.url).searchParams.get('path') ?? '')
        if (!requested) {
          return new Response('Not found', { status: 404 })
        }
        // Document sandbox: preview must read the working copy when one exists.
        const mapped = workingCopyService.ioPath(requested)
        const filePath = existsSync(mapped) ? mapped : requested
        if (!existsSync(filePath)) {
          return new Response('Not found', { status: 404 })
        }
        // Forward Range headers so pdf.js can stream large files efficiently.
        const headers: Record<string, string> = {}
        const range = request.headers.get('Range')
        if (range) headers.Range = range
        const response = await net.fetch(pathToFileURL(filePath).href, {
          headers,
          method: request.method
        })
        const ext = extname(filePath).toLowerCase()
        // Ensure MIME for PDF streaming and HTML sibling assets (css/img/fonts).
        const mimeByExt: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.mjs': 'text/javascript; charset=utf-8',
          '.html': 'text/html; charset=utf-8',
          '.htm': 'text/html; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.avif': 'image/avif',
          '.bmp': 'image/bmp',
          '.ico': 'image/x-icon',
          '.heic': 'image/heic',
          '.heif': 'image/heif',
          '.tif': 'image/tiff',
          '.tiff': 'image/tiff',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.m4a': 'audio/mp4',
          '.aac': 'audio/aac',
          '.ogg': 'audio/ogg',
          '.flac': 'audio/flac',
          '.mp4': 'video/mp4',
          '.mov': 'video/quicktime',
          '.webm': 'video/webm',
          '.mkv': 'video/x-matroska',
          '.m4v': 'video/x-m4v',
          '.docx':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.pptx':
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          '.zip': 'application/zip',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf': 'font/ttf',
          '.otf': 'font/otf',
          '.json': 'application/json',
          '.map': 'application/json'
        }
        const forcedMime = mimeByExt[ext]
        if (forcedMime) {
          const out = new Headers(response.headers)
          out.set('Content-Type', forcedMime)
          // Range enables seeking for PDF/media/large office.
          out.set('Accept-Ranges', 'bytes')
          out.set('Cache-Control', 'no-store')
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: out
          })
        }
        return response
      } catch {
        return new Response('Bad request', { status: 400 })
      }
    })
    const settings = settingsStore.load()
    setLocalePreference(settings.locale ?? DEFAULT_SETTINGS.locale)
    conversationStore.load({ model: settings.defaultModel, mintWorkdir: resolveNewWorkdir })
    swarmHistoryStore.load()
    swarmSession.adoptRecordedBindings()
    swarmSession.refreshTitles()
    if (!process.env.VAV_SNAPSHOT) {
      ptyManager.restorePersisted({
        persistPath: join(app.getPath('userData'), 'pty-sessions.json'),
        shell: settings.shell,
        conversationExists: (id) => Boolean(conversationStore.get(id)),
        restoreMarker: t('tools.bashRestored')
      })
    }
    fileSessionStore.bind(conversationStore)
    applyTheme(settings.theme ?? DEFAULT_SETTINGS.theme)
    nativeTheme.on('updated', repaintChrome)
    watchSystemAccentColor()
    registerGlobalHotkey(settings.globalHotkey)
    registerIpc()
    notifications.applySettings()
    rebuildAppChrome()
    if (!process.env.VAV_SNAPSHOT) quotaService.start()

    if (process.env.VAV_SNAPSHOT) {
      // Marketing captures should use default layout (tools open, files segment).
      await session.defaultSession.clearStorageData({ storages: ['localstorage'] })
    }

    const snapshotting = Boolean(process.env.VAV_SNAPSHOT)
    const cliOpen = argvRequestsCliOpen(process.argv)
    const argvOpens = snapshotting || cliOpen ? [] : parseOpenPathsFromArgv(process.argv)
    // Finder "Open With" / Dock drop cold start: the file the user asked for
    // goes up first. Booting the much heavier main shell ahead of it costs a
    // second of contended CPU and raises a window nobody asked for.
    let previewColdOpen =
      !snapshotting &&
      !cliOpen &&
      [...pendingOpenPaths, ...argvOpens].some(isPreviewableColdOpenPath)
    if (previewColdOpen) {
      flushPendingOpens(argvOpens)
      // Nothing actually opened (vanished path, or it resolved to a workdir) —
      // fall back to the normal "show the main shell" boot.
      if (previewWindows.size === 0) previewColdOpen = false
    }

    mainWindow ??= createWindow()
    // Belt-and-suspenders: ready-to-show can race with Dock hide / focus steals
    // from the IDE. Force the main window up once the renderer finishes loading.
    mainWindow.webContents.once('did-finish-load', () => {
      if (!previewColdOpen) showMainWindow()
      if (process.env.VAV_SMOKE_SEED === '1') {
        void seedSmokeChangeReview()
      }
      // Companion warm order: session first (global ⌘⇧↵ is latency-critical),
      // then token / preview / settings. A short delay lets the main shell paint
      // once so the hidden session boot does not contend on first frame.
      setTimeout(() => {
        try {
          warmSessionShellPool()
        } catch {
          // non-fatal
        }
      }, 400)
      setTimeout(() => {
        try {
          warmTokenUsageWindow()
        } catch {
          // non-fatal
        }
      }, 1600)
      setTimeout(() => {
        try {
          warmProviderAccountWindow()
        } catch {
          // non-fatal
        }
      }, 1800)
      setTimeout(() => {
        try {
          warmOverlayShellPool()
        } catch {
          // non-fatal
        }
      }, 1200)
      setTimeout(() => {
        try {
          warmPreviewShellPool()
        } catch {
          // non-fatal
        }
      }, 2000)
      setTimeout(() => {
        try {
          warmSettingsWindow()
        } catch {
          // non-fatal
        }
      }, 2400)
      // Seed static catalogues immediately, then live-probe in the background.
      try {
        publishModelCatalog(seedModelCatalog(settingsStore))
      } catch {
        // non-fatal
      }
      setTimeout(() => {
        void preloadHostModels(settingsStore, {
          prefer: preferredModelHosts(),
          onProgress: publishModelCatalog,
          apiKey: secretStore.get()
        })
          .then(publishModelCatalog)
          .catch((err) => console.warn('[agents] model preload failed', err))
      }, 900)
    })
    // Dock tiles cache aggressively for the rebranded Electron.dev bundle —
    // re-assert the PNG after the first window exists so the tile updates.
    applyDockIcon()
    // Silent check so the bottom-left update chip can appear when a newer release exists.
    if (currentSettings().autoCheckUpdates) {
      void updateService.check()
    }

    // Finder → Services → “Open Directory in VAV” (folders only).
    // Defer so first paint is not blocked by osacompile.
    if (IS_MAC) {
      setTimeout(() => {
        try {
          ensureMacOpenDirectoryService()
        } catch {
          // non-fatal
        }
      }, 2800)
    }

    if (snapshotting) {
      // Marketing captures seed their own conversations; ignore argv path opens.
      appReadyForOpens = true
    } else if (cliOpen) {
      // Bare `vav` with the flag but empty value still goes through openFromCli.
      appReadyForOpens = true
      openFromCli(parseCliWorkdir(process.argv))
    } else if (!previewColdOpen) {
      // Dock cold-start / Finder "Open With": queued open-file + argv paths.
      flushPendingOpens(argvOpens)
    }

    // Dock click: raise last-focused open window (not always main).
    app.on('activate', activateApp)
  })
}

/** Convert `#rrggbb` → 16-bit RGB triplets for AppleScript `choose color`. */
function parseHexToRgb16(hex?: string): [number, number, number] | null {
  if (!hex) return null
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [
    Math.round(((n >> 16) & 0xff) / 255 * 65535),
    Math.round(((n >> 8) & 0xff) / 255 * 65535),
    Math.round((n & 0xff) / 255 * 65535)
  ]
}
