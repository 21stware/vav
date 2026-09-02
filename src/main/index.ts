import {
  app,
  autoUpdater as electronAutoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
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
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { randomUUID } from 'node:crypto'
import { APP_NAME, applyBranding, applyDockIcon, loadAppIcon, pinUserDataPath } from './brand'
import { isE2eRuntime } from './e2eRuntime'
import { installProcessErrorGuards } from './process/stdioGuard'
import { isRendererUrl } from './window/rendererUrl'
import { safeSend } from './window/safeSend'
import {
  e2eChoosePopupMenu,
  e2eDismissPopupMenu,
  e2ePeekPopupMenu,
  e2ePopupMenu
} from './e2ePopupMenu'
import { registerHapticsIpc } from './haptics'
import {
  IPC,
  type Bootstrap,
  type FileInspectResult,
  type HostDiscoveryPeer,
  type MenuCommand,
  type NativeMenuItem,
  type SettingsView,
  resolveSettingsView,
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
  type ChatMessage,
  type Conversation,
  type ConversationMeta,
  type FileSortKey,
  type ShellKind,
  type TurnEvent
} from '@shared/types'
import { agentBinaryCandidates } from '@shared/agentBinary'
import { localFileStreamUrl } from '@shared/localFileUrl'
import { compactionForLeaf } from '@shared/compaction'
import {
  hasActiveAgentWork,
  shouldBlockIdleSleep,
  shouldBlockLidSleep,
  type KeepAwakeStatus
} from '@shared/sleepBlocker'
import { createSwarmFinishAlert } from './sound/swarmFinishAlert'
import { RemoteControlService } from './remote/RemoteControlService'
import { DaemonAttachService } from './daemon/DaemonAttachService'
import { openTailcatDial } from './daemon/tailcatDial'
import { hostJoin, isLocalMachine, LOCAL_MACHINE_ID, normalizeMachineId, conversationOnMachine, parseWorkspaceRefList, recentsForMachine, type WorkspaceHostInfo } from '@shared/workspaceHost'
import type {
  RemoteConfigure,
  RemoteControlsEvent,
  RemoteDirsEvent,
  RemoteHostEvent,
  RemoteSession,
  RemoteThreadEvent
} from '@shared/remoteControl'
import { REMOTE_PHONE_CAPABILITIES } from '@shared/remoteControl'
import {
  projectRemoteMessages,
  projectRemotePlan,
  projectRemoteToolBlock
} from '@shared/remoteThread'
import {
  remoteBrowseRoots,
  remoteIsTemporary,
  remoteParentPath,
  remotePathAllowed
} from '@shared/remoteWorkspace'
import {
  agentLabel,
  buildRemoteControls,
  parseAgentId,
  parseApprovalMode
} from '@shared/remoteSessionControls'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import { threadPath } from '@shared/thread'
import { sanitizeSwarmLayout } from '@shared/swarmLayout'
import { SettingsStore } from './store/SettingsStore'
import { SleepBlocker } from './power/SleepBlocker'
import { MacLidSleepGuard } from './power/MacLidSleep'
import { SecretStore } from './store/SecretStore'
import { AccountStore } from './store/AccountStore'
import {
  accountHasKey,
  accountSecret,
  buildAccountsPage,
  cliCatalogOf,
  resolveVavCredentials,
  resolveWorkspaceContext,
  syncOAuthProfiles
} from './accounts/service'
import { activateAccount, captureAccountCredentials, captureLiveHost } from './accounts/activateAccount'
import { accessTokenFromSnapshot } from './accounts/credentials/parseKeychainSnapshot'
import {
  createKindForAgent,
  defaultKeyEndpoint,
  displayAccountLabel,
  isHttpUrl,
  isOAuthSyncAgent,
  nameConflict,
  nextDraftName,
  normalizeAccountName,
  providerForAgent,
  agentIdOf,
  isVavProfile,
  DEFAULT_WORKSPACE_KEY,
  resolveSessionAccountId,
  sessionShowsHostQuota,
  sessionUsageRowsOf,
  workspaceKeyOf
} from '@shared/accounts'
import { ANALYSIS_API_HOST } from '@shared/analysis'
import {
  agentModelHostKey,
  defaultModelForChatHost,
  filterEnabledModels,
  labelForChatModel,
  modelsForChatHost,
  resolveModelForChatHost
} from '@shared/agentModels'
import { collapseCursorListModels, normalizeCursorConversationModel } from '@shared/cursorModel'
import { groupAccountsByVendor, isLlmVendorId, vendorById, vendorIdFromEndpoint } from '@shared/llmVendors'
import { ConversationStore } from './store/ConversationStore'
import { VavPackService } from './store/VavPackService'
import { FileSessionStore } from './store/FileSessionStore'
import { SwarmHistoryStore } from './store/SwarmHistoryStore'
import { FileService } from './fs/FileService'
import { installTrustedIpcGuard } from './ipc/ipcTrust'
import { registerVcsIpc } from './ipc/registerVcsIpc'
import {
  applyWindowVibrancy as applyVibrancyPaint,
  chromeOptions,
  clearWindowVibrancy as clearVibrancyPaint,
  overlayColors as overlayColorsForTheme,
  primeRendererShell as primeShellPaint,
  TOOLBAR_HEIGHT,
  trafficLightOrigin,
  windowBackgroundColor,
  windowThemeNameFromDark
} from './window/shellPaint'
import { wireExternalLinks as wireShellExternalLinks } from './window/externalLinks'
import {
  hostWindowTitle as formatHostWindowTitle,
  mainWindowSize,
  rendererPrefs as buildRendererPrefs
} from './window/rendererPrefs'
import {
  PREVIEW_DEFAULT_WIDTH,
  PREVIEW_IDLE_MS,
  PREVIEW_MAX_OPEN,
  PREVIEW_POOL_REFILL_MS,
  PREVIEW_WARM_POOL,
  clampPreviewWidth,
  nextUnfocusedPreviewPath
} from './window/previewPool'
import { appBuildNumber as formatAppBuildNumber } from './appBuild'
import { trayDirLabel as formatTrayDirLabel, trayAgentLabel as formatTrayAgentLabel } from './tray/trayLabels'
import { HostRegistry } from './host'
import { openSpawn, previewSpawn, revealSpawn } from './host/hostShell'
import { clipRoot, isClipPath, writeClip, writeClipBytes } from './fs/clipStore'
import { writePngToClipboard } from './clipboardImage'
import { mapRemoteSessions } from './remote/sessionList'
import { listRemoteChildEntries, listRemoteRootEntries } from './remote/dirBrowse'
import { RemoteSendQueue } from './remote/sendQueue'
import { createScreenshotController } from './screenshot/ScreenshotSession'
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
import { setGitHostFor } from './git/GitService'
import { UpdateService } from './updates'
import { PtyManager, type PtySessionMeta } from './terminal/PtyManager'
import { ensureLoginPath, probeAgentExecutables, resolveAgentExecutable } from './terminal/loginPath'
import { warmAgentLaunchCache } from './terminal/agentLaunchWarm'
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
  seedModelCatalog,
  type PreloadHostModelsOptions
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
import { clearHostAuthIdentityCache, readHostAccountInfo } from './agent/hostAuth'
import { candidatesForHost } from './agent/drivers'
import {
  cancelHostOAuthLogin,
  currentOAuthLogin,
  finishHostOAuth,
  loginArgv,
  runHostLogout,
  runningOAuthAgents,
  startHostOAuthLogin
} from './accounts/hostLogin'
import type { HostAuthKind } from '@shared/cliAccountParse'
import {
  displayNameForCliHost,
  isStructuredCliHost,
  resolveDefaultChatHost,
  type CliHostKind
} from '@shared/cliHost'
import {
  providerLabel as vavProviderLabel
} from '@shared/tokenUsage'
import { contextWindowFor } from './agent/modelMeta'
import { validateVavApiKey } from './agent/vavModelProbe'
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
import { fetchClaudeAccountQuota } from './quota/claudeUsage'
import { fetchCodexAccountQuota } from './quota/codexUsage'
import { fetchCursorAccountQuota } from './quota/cursorUsage'
import { fetchGrokAccountQuota } from './quota/grokUsage'
import { fetchOpencodeAccountQuota } from './quota/opencodeUsage'
import { apiBalanceUrl, hostCanShowApiBalance } from '@shared/apiBalance'
import {
  cachedApiBalance,
  clearApiBalance,
  fetchApiBalance,
  refreshApiBalance
} from './quota/apiBalanceCache'
import { buildAnalysisSnapshot } from './analysis/buildAnalysisSnapshot'
import {
  configureAnalysisCache,
  invalidateAnalysisCache,
  serveAnalysisSnapshot
} from './analysis/analysisSnapshotCache'
import { raceSettle } from '@shared/asyncTimeout'
import {
  ACCOUNT_QUOTA_HOSTS,
  hostMayHaveAccountQuota,
  latestQuotaWindowsByHost,
  mergeNamespacedQuotaWindows
} from '@shared/quotaWindows'
import { nativeSessionId } from '@shared/cliPaneBinding'
import {
  buildSwarmHistoryMenuEntries,
  isBlankSwarmSessionTitle,
  parseSwarmHistoryId,
  swarmSessionKey
} from '@shared/cliSessionHistory'
import {
  AGENT_TRAY_QUIET_MS,
  collapseTrayActivity,
  collapseTrayPanesByConversation,
  isAgentTrayRunning,
  mergeLiveAndUnseenTrayPanes,
  shouldInferAgentTrayFinish,
  shouldRecordPtyCompletion,
  trayItemLabel,
  trayPaneKey,
  traySessionLabel,
  type TrayPane
} from '@shared/traySessions'

const PLATFORM = process.platform as Platform
const IS_MAC = PLATFORM === 'darwin'
const IS_WIN = PLATFORM === 'win32'

installProcessErrorGuards()

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
/** Extra main shells, one per paired daemon (`?machine=<id>`). */
const hostWindows = new Map<string, BrowserWindow>()
let settingsWindow: BrowserWindow | null = null
let connectWindow: BrowserWindow | null = null
let tokenUsageWindow: BrowserWindow | null = null
let providerAccountWindow: BrowserWindow | null = null
/** Last BrowserWindow that held focus — Dock activate raises this, not always main. */
let lastFocusedWindow: BrowserWindow | null = null
let screenshotController: ReturnType<typeof createScreenshotController> | null = null
/** Conversation currently shown in the token-usage panel (for live hydrate). */
let tokenUsageConversationId: string | null = null
/** Last conversation the user actually viewed — Accounts workspace follows this. */
let lastSeenConversationId: string | null = null
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
const accountStore = new AccountStore(app.getPath('userData'))
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
const hostRegistry = new HostRegistry()
const fileService = new FileService(
  (conversationId, dirs) => {
    sendToWorkspaceWindows(IPC.filesDirty, { conversationId, dirs }, conversationId)
  },
  hostRegistry.local().fs,
  (conversationId) => hostRegistry.hostFor(conversationStore.get(conversationId)?.machineId).fs
)
fileService.workingCopies = workingCopyService
fileService.grantRoot(clipRoot())
fileService.grantRoot(join(tmpdir(), 'vav-office-convert'))
fileService.grantRoot(join(tmpdir(), 'vav-heic-preview'))
fileService.grantRoot(workingCopyService.storageRoot)
setGitHostFor((cwd, conversationId) => {
  const id = conversationId || conversationIdForGitCwd(cwd)
  const machineId = id ? conversationStore.get(id)?.machineId : undefined
  const host = hostRegistry.hostFor(machineId)
  return {
    kind: host.info.kind,
    process: host.process,
    fs: host.fs
  }
})
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
  (tabId, data) => {
    sendToWorkspaceWindows(IPC.ptyData, { tabId, data }, ptyManager.conversationIdFor(tabId))
    noteCliAgentOutputForTray(tabId)
  },
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
  },
  (conversationId) => hostRegistry.hostFor(conversationStore.get(conversationId)?.machineId).pty,
  (conversationId) => isLocalMachine(conversationStore.get(conversationId)?.machineId),
  (conversationId, candidates) => {
    const machineId = conversationStore.get(conversationId)?.machineId
    if (isLocalMachine(machineId)) return null
    return daemonAttach.whichCached(normalizeMachineId(machineId), candidates)
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
/** CLI agent tabIds that already completed a turn — ignore leftover process-alive. */
const agentTurnFinished = new Set<string>()
/** Re-evaluate tray after stdout goes quiet while the host process stays up. */
const trayQuietTimers = new Map<string, ReturnType<typeof setTimeout>>()
const sleepBlocker = new SleepBlocker()
const macLidSleep = process.platform === 'darwin' ? new MacLidSleepGuard() : null

function currentAgentWork(): boolean {
  return hasActiveAgentWork({
    turns: activeTurns.values(),
    cliAgentStatuses: ptyManager.listCliAgentSessions().map((session) => session.status)
  })
}

function syncSleepBlocker(): void {
  void syncSleepBlockerAsync()
}

async function syncSleepBlockerAsync(): Promise<void> {
  const settings = settingsStore.get()
  const enabled = settings.keepAwakeWhileAgentRunning === true
  const hasWork = currentAgentWork()
  const safety = macLidSleep
    ? await macLidSleep.safetyHold(settings.keepAwakeBatteryFloorPercent)
    : null
  const granted = macLidSleep ? await macLidSleep.granted() : false
  sleepBlocker.setActive(shouldBlockIdleSleep(enabled, hasWork, safety))
  macLidSleep?.setDesired(shouldBlockLidSleep(enabled, hasWork, granted, safety))
  await publishKeepAwakeStatus()
}

async function currentKeepAwakeStatus(): Promise<KeepAwakeStatus> {
  const settings = settingsStore.get()
  const enabled = settings.keepAwakeWhileAgentRunning === true
  const hasWork = currentAgentWork()
  if (!macLidSleep) {
    return {
      lidSupported: false,
      granted: false,
      idleBlocked: shouldBlockIdleSleep(enabled, hasWork),
      lidSleepBlocked: false,
      onBattery: false,
      batteryPercent: 100,
      lowPowerMode: false,
      safetyHold: null,
      hasWork
    }
  }
  const [safety, info] = await Promise.all([
    macLidSleep.safetyHold(settings.keepAwakeBatteryFloorPercent),
    macLidSleep.powerInfo()
  ])
  return {
    lidSupported: true,
    granted: info.granted,
    idleBlocked: shouldBlockIdleSleep(enabled, hasWork, safety),
    lidSleepBlocked: info.lidSleepBlocked,
    onBattery: info.onBattery,
    batteryPercent: info.batteryPercent,
    lowPowerMode: info.lowPowerMode,
    safetyHold: safety,
    hasWork
  }
}

let lastKeepAwakeStatusJson = ''

async function publishKeepAwakeStatus(): Promise<void> {
  const status = await currentKeepAwakeStatus()
  const json = JSON.stringify(status)
  if (json === lastKeepAwakeStatusJson) return
  lastKeepAwakeStatusJson = json
  broadcast(IPC.keepAwakeStatus, status)
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

  const machineId = conversationStore.get(conversationId)?.machineId
  const wasMissing = !hostWindowOf(machineId)
  void showHostWindow(machineId).then(() => {
    const win = hostWindowOf(machineId)
    const send = (): void => {
      if (!win || win.isDestroyed()) return
      safeSend(win.webContents, IPC.cliOpen, payload)
    }
    if (wasMissing || (win && !win.isDestroyed() && win.webContents.isLoading())) {
      win?.webContents.once('did-finish-load', () => setTimeout(send, 50))
    } else {
      setTimeout(send, 50)
    }
  })
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
  const machineId = conversationStore.get(conversationId)?.machineId
  await showHostWindow(machineId)

  if (conversationId && conversationStore.get(conversationId)) {
    const payload = {
      conversationId,
      toast: null as string | null,
      surface: 'vav' as const
    }
    const win = hostWindowOf(machineId)
    if (win && !win.isDestroyed()) {
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', () => {
          if (!win.isDestroyed()) safeSend(win.webContents, IPC.cliOpen, payload)
        })
      } else {
        safeSend(win.webContents, IPC.cliOpen, payload)
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
  () => openSettingsWindow('appearance'),
  showMainWindow,
  () => mainWindow
)
notifications.setHostServices({
  list: () =>
    hostRegistry.list().map((host) => ({
      id: host.id,
      name: host.name
    })),
  defaultId: () => settingsStore.get().defaultMachineId || LOCAL_MACHINE_ID,
  show: (id) => {
    void showHostWindow(id)
  },
  setDefault: (id) => applyDefaultMachine(id)
})
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
  return formatTrayDirLabel(workingDirectory, homedir())
}

function trayAgentLabel(agentId: string): string {
  return formatTrayAgentLabel(agentId, settingsStore.get().cliAgents)
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
  broadcast(IPC.convChanged, conversationStore.listMeta())
}

function applyUnseenResult(pane: TrayPane): void {
  if (ephemeralConversations.has(pane.conversationId)) return
  if (notifications.isConversationForeground(pane.conversationId)) {
    for (const [key, existing] of unseenResults) {
      if (existing.conversationId === pane.conversationId) unseenResults.delete(key)
    }
    persistResultUnseen(pane.conversationId, false)
    return
  }
  unseenResults.set(trayPaneKey(pane), pane)
  persistResultUnseen(pane.conversationId, true)
  notifications.noteUnseenComplete(pane.conversationId)
}

function markResultUnseen(pane: TrayPane): void {
  applyUnseenResult(pane)
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

function clearTrayQuietTimer(tabId: string): void {
  const timer = trayQuietTimers.get(tabId)
  if (!timer) return
  clearTimeout(timer)
  trayQuietTimers.delete(tabId)
}

function scheduleAgentTrayQuietCheck(tabId: string): void {
  const watch = ptyManager.cliAgentWatchTarget(tabId)
  if (!watch) return
  clearTrayQuietTimer(tabId)
  const delay = Math.max(80, watch.lastDataAt + AGENT_TRAY_QUIET_MS - Date.now())
  const timer = setTimeout(() => {
    trayQuietTimers.delete(tabId)
    refreshTraySessions()
  }, delay)
  timer.unref?.()
  trayQuietTimers.set(tabId, timer)
}

function noteCliAgentOutputForTray(tabId: string): void {
  if (!ptyManager.cliAgentWatchTarget(tabId)) return
  if (agentTurnFinished.has(tabId) && !ptyRunningSince.has(tabId)) {
    ptyRunningSince.set(tabId, Date.now())
  }
  scheduleAgentTrayQuietCheck(tabId)
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
    if (agent) scheduleAgentTrayQuietCheck(tabId)
    refreshTraySessions()
    return
  }

  clearTrayQuietTimer(tabId)
  const runningSince = ptyRunningSince.get(tabId) ?? null
  ptyRunningSince.delete(tabId)
  const pane = ptyTrayPanes.get(tabId)
  const record = shouldRecordPtyCompletion({
    primed: ptyPrimed.has(tabId),
    runningSince,
    now: Date.now()
  })
  ptyPrimed.add(tabId)
  // Terminal has Running only — never a Done row after the command ends.
  if (record && pane && pane.kind !== 'bash') {
    agentTurnFinished.add(tabId)
    markResultUnseen(pane)
  } else refreshTraySessions()
  if (status === 'exited') {
    ptyPrimed.delete(tabId)
    ptyTrayPanes.delete(tabId)
    agentTurnFinished.delete(tabId)
  }
}

function refreshTraySessions(): void {
  try {
    const live: TrayPane[] = []

    for (const id of activeTurns.keys()) {
      if (ephemeralConversations.has(id)) continue
      const pane = trayPaneFromConversation(id, 'chat')
      if (pane) live.push({ ...pane, status: 'running' })
    }

    for (const s of ptyManager.listCliAgentSessions()) {
      const pane = trayPaneFromAgentSession(s)
      if (!pane) continue
      ptyTrayPanes.set(s.id, pane)
      const watch = ptyManager.cliAgentWatchTarget(s.id)
      const now = Date.now()
      const lastDataAt = watch?.lastDataAt ?? 0
      const createdAt = watch?.createdAt ?? s.createdAt
      if (
        shouldInferAgentTrayFinish({
          finishedTurn: agentTurnFinished.has(s.id),
          lastDataAt,
          runningSince: ptyRunningSince.get(s.id) ?? null,
          createdAt,
          now
        })
      ) {
        agentTurnFinished.add(s.id)
        ptyRunningSince.delete(s.id)
        applyUnseenResult(pane)
      }
      const working = isAgentTrayRunning({
        finishedTurn: agentTurnFinished.has(s.id),
        ptyStatus: s.status,
        lastDataAt,
        runningSince: ptyRunningSince.get(s.id) ?? null,
        createdAt,
        now
      })
      if (working) {
        if (agentTurnFinished.has(s.id)) agentTurnFinished.delete(s.id)
        live.push({ ...pane, status: 'running' })
        scheduleAgentTrayQuietCheck(s.id)
      } else if (s.status === 'running' && !agentTurnFinished.has(s.id)) {
        scheduleAgentTrayQuietCheck(s.id)
      }
    }
    for (const s of ptyManager.listBashSessions()) {
      const pane = trayPaneFromBashSession(s)
      if (!pane) continue
      ptyTrayPanes.set(s.id, pane)
      if (s.status === 'running') live.push({ ...pane, status: 'running' })
    }

    // Restart / persist: a conversation flagged unseen with no in-memory pane.
    for (const conversation of conversationStore.all()) {
      if (!conversation.resultUnseen || conversation.archived) continue
      if (ephemeralConversations.has(conversation.id)) continue
      const already = [...unseenResults.values()].some((p) => p.conversationId === conversation.id)
      if (already) continue
      const pane = trayPaneFromConversation(conversation.id, 'chat')
      if (pane) {
        unseenResults.set(trayPaneKey(pane), { ...pane, status: 'done' })
        notifications.noteUnseenComplete(conversation.id)
      }
    }

    const panes = collapseTrayPanesByConversation(
      mergeLiveAndUnseenTrayPanes(
        live,
        [...unseenResults.values()].filter((pane) => {
          const conversation = conversationStore.get(pane.conversationId)
          return conversation && !conversation.archived && pane.kind !== 'bash'
        })
      )
    )
    const runningCount = panes.filter((pane) => pane.status === 'running').length
    const doneCount = panes.filter((pane) => pane.status === 'done').length
    notifications.updateRunningSessions(
      panes.map((pane) => ({
        conversationId: pane.conversationId,
        title: pane.kind === 'bash' ? trayItemLabel(pane) : traySessionLabel(pane),
        surface:
          pane.kind === 'agent' ? ('cli' as const) : pane.kind === 'bash' ? ('bash' as const) : 'vav',
        tabId: pane.tabId || undefined,
        agentId: pane.agentId,
        kind: pane.kind,
        status: pane.status ?? 'running',
        dirKey: pane.dirKey,
        dirLabel: pane.dirLabel,
        createdAt: pane.createdAt,
        machineId: conversationStore.get(pane.conversationId)?.machineId ?? LOCAL_MACHINE_ID
      })),
      runningCount,
      doneCount
    )
    broadcast(IPC.activityChanged, collapseTrayActivity(panes))
    remoteSessionStatus.clear()
    for (const pane of panes) {
      const status = pane.status === 'done' ? 'done' : 'running'
      // A conversation with any running pane counts as running.
      if (remoteSessionStatus.get(pane.conversationId) === 'running') continue
      remoteSessionStatus.set(pane.conversationId, status)
    }
    remoteControl.schedulePushSessions()
    flushRemoteSends()
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
    () => openSettingsWindow('appearance'),
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
  fanRemoteTurn(event)
  sendToWorkspaceWindows(IPC.agentEvent, event, event.conversationId)
  const conversation = conversationStore.get(event.conversationId)
  const title = conversation?.title ?? t('window.sessionFallback')

  if (event.type === 'user') {
    // appendMessage already auto-titles from the prompt; push it now so the
    // sidebar / companion title do not wait for the turn to finish.
    const detached = detachedWindows.get(event.conversationId)
    if (detached && !detached.isDestroyed() && conversation) {
      detached.setTitle(conversation.title)
    }
    publishConversations()
    return
  }
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
    } else if (
      event.phase === 'working' ||
      event.phase === 'thinking' ||
      event.phase === 'outputting' ||
      event.phase === 'retrying'
    ) {
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
    const latest = conversation?.tokenHistory?.at(-1)
    if (event.newSnapshot && latest?.accountId) {
      accountStore.recordUsage(latest.accountId, {
        inputTokens: latest.newInputTokens,
        outputTokens: latest.outputTokens,
        cacheReadTokens: latest.cacheReadTokens,
        cacheWriteTokens: latest.cacheWriteTokens,
        estimatedCostUsd: latest.estimatedCost
      }, latest.timestamp)
      if (conversation?.model) {
        accountStore.update(latest.accountId, { lastModel: conversation.model })
      }
      pushAccountsIfSettingsOpen()
    }
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

function fanRemoteTurn(event: TurnEvent): void {
  const locale = currentLocale()
  switch (event.type) {
    case 'start':
      remoteControl.beginLive(event.conversationId)
      return
    case 'delta':
      if (event.kind === 'text' || event.kind === 'reasoning') {
        remoteControl.appendLive(event.conversationId, event.index, event.kind, event.text)
      }
      return
    case 'tool':
      remoteControl.setLiveBlock(
        event.conversationId,
        event.index,
        projectRemoteToolBlock(event.block, locale)
      )
      return
    case 'plan':
      remoteControl.setLiveBlock(event.conversationId, event.index, projectRemotePlan(event.block))
      return
    case 'awaiting': {
      const block = projectRemoteToolBlock(event.block, locale)
      remoteControl.setLiveBlock(event.conversationId, event.index, block)
      return
    }
    case 'end':
      remoteControl.finishTurn(
        event.conversationId,
        event.cancelled ? 'cancelled' : event.error ? 'error' : 'done',
        event.error
      )
      return
    default:
      return
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
    pushAccountsIfSettingsOpen()
  },
  fetchers: {
    claude: fetchClaudeAccountQuota,
    codex: fetchCodexAccountQuota,
    cursor: fetchCursorAccountQuota,
    grok: fetchGrokAccountQuota,
    opencode: fetchOpencodeAccountQuota
  },
  identityOf: async (host) => {
    const info = await readHostAccountInfo(host)
    return info.signedIn ? info.accountId : null
  },
  identitiesOf: async (host) => {
    const rows: { identity: string; token?: string }[] = []
    for (const account of accountStore.listAll()) {
      if (account.kind !== 'oauth') continue
      if ((account.oauthHost ?? agentIdOf(account)) !== host) continue
      if (!account.hasCredentialSnapshot) continue
      const identity = account.name?.trim()
      if (!identity) continue
      const token = accessTokenFromSnapshot(host, secretStore.getOAuthSnapshot(account.id))
      if (!token) continue
      rows.push({ identity, token })
    }
    return rows
  }
})

const agent = new AgentRuntime({
  conversations: conversationStore,
  settings: settingsStore,
  secrets: secretStore,
  resolveVavCredentials: (conversation) =>
    resolveVavCredentials(
      { conversation, settingsEndpoint: settingsStore.get().apiEndpoint },
      accountStore,
      secretStore
    ),
  files: fileService,
  hosts: hostRegistry,
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
  files: fileService,
  hosts: hostRegistry,
  emit: handleAgentEvent,
  publish: () => publishConversations(),
  logicalPath: (path) => workingCopyService.logicalPath(path),
  quota: {
    get: (host) => quotaService.get(host),
    identity: (host) => liveOAuthIdentity(host),
    forceRefresh: (host) => quotaService.forceRefresh(host)
  }
})

setInterval(() => cliHost.reapIdle(), 5 * 60_000)

function agentFor(conversationId: string): 'builtin' | 'cli' {
  return cliHost.owns(conversationId) ? 'cli' : 'builtin'
}

// --- remote control (tailcat tunnel — foreground-realtime phone companion) ---

/** Tray-derived per-conversation activity, reused for the remote session list. */
const remoteSessionStatus = new Map<string, 'running' | 'done'>()

function listRemoteSessions(): RemoteSession[] {
  return mapRemoteSessions(conversationStore.all(), {
    fallbackTitle: t('window.sessionFallback'),
    tmpdir: tmpdir(),
    dirLabel: trayDirLabel,
    statusOf: (id, resultUnseen) => remoteSessionStatus.get(id) ?? (resultUnseen ? 'done' : 'idle'),
    surfaceOf: (id) => (agentFor(id) === 'cli' ? 'cli' : 'vav')
  })
}

/** Phone `create` — same defaults as desktop New Session. */
function createRemoteSession(): RemoteSession {
  const workdir = resolveNewWorkdir()
  const settings = settingsStore.get()
  if (workdir) {
    settingsStore.rememberWorkspaceDirectory(workdir, tmpRootFor(undefined))
    broadcast(IPC.settingsChanged, currentSettings())
  }
  const defaultHost = resolveDefaultChatHost(settings.defaultAgentId)
  const conversation = conversationStore.create(
    workdir,
    modelForNewConversation(defaultHost),
    {
      approvalMode: settings.defaultApprovalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(settings.defaultThinkingLevel),
      cliHost: defaultHost,
      accountId: accountIdForSession(workdir, defaultHost),
      machineId: LOCAL_MACHINE_ID
    }
  )
  if (defaultHost) promoteEphemeralConversation(conversation.id)
  lastSeenConversationId = conversation.id
  publishConversations()
  return (
    listRemoteSessions().find((session) => session.id === conversation.id) ?? {
      id: conversation.id,
      title: (conversation.title && conversation.title.trim()) || t('window.sessionFallback'),
      dirLabel: trayDirLabel(conversation.workingDirectory),
      status: 'idle',
      surface: defaultHost ? 'cli' : 'vav',
      updatedAt: conversation.updatedAt
    }
  )
}

function listRemoteThread(conversationId: string): RemoteThreadEvent | null {
  const conversation = conversationStore.get(conversationId)
  if (!conversation || conversation.archived) return null
  return {
    type: 'thread',
    conversationId,
    messages: projectRemoteMessages(
      threadPath(conversation.messages, conversation.activeLeafId),
      currentLocale()
    )
  }
}

function listRemoteHost(): RemoteHostEvent {
  const settings = settingsStore.get()
  const defaultHost = resolveDefaultChatHost(settings.defaultAgentId)
  const approval =
    settings.defaultApprovalMode === 'bypass' || settings.defaultApprovalMode === 'edit'
      ? settings.defaultApprovalMode
      : 'auto'
  const seen = new Set<string>()
  const recentDirs: { path: string; label: string }[] = []
  const localRecents = recentsForMachine(
    parseWorkspaceRefList(settings.recentWorkspaceDirectories),
    LOCAL_MACHINE_ID
  ).map((ref) => ref.path)
  for (const path of [...(settings.pinnedWorkspaceDirectories ?? []), ...localRecents]) {
    if (!path || seen.has(path) || !existsSync(path)) continue
    seen.add(path)
    recentDirs.push({ path, label: trayDirLabel(path) })
    if (recentDirs.length >= 12) break
  }
  return {
    type: 'host',
    name: hostname(),
    home: homedir(),
    tmp: tmpdir(),
    platform: process.platform,
    capabilities: REMOTE_PHONE_CAPABILITIES,
    defaults: {
      agent: defaultHost ?? 'vav',
      model: settings.defaultModel ?? '',
      thinking: parseThinkingLevel(settings.defaultThinkingLevel),
      approval
    },
    recentDirs
  }
}

function remoteRootsFor(conversationId: string): string[] | null {
  const conversation = conversationStore.get(conversationId)
  if (!conversation || conversation.archived) return null
  const settings = settingsStore.get()
  return remoteBrowseRoots({
    home: homedir(),
    tmp: tmpdir(),
    current: conversation.workingDirectory,
    recent: [
      ...(settings.pinnedWorkspaceDirectories ?? []),
      ...recentsForMachine(
        parseWorkspaceRefList(settings.recentWorkspaceDirectories),
        LOCAL_MACHINE_ID
      ).map((ref) => ref.path)
    ]
  })
}

function browseRemoteDirs(conversationId: string, path?: string): RemoteDirsEvent | 'not-found' | 'forbidden' {
  const roots = remoteRootsFor(conversationId)
  if (!roots) return 'not-found'
  if (!path) {
    return {
      type: 'dirs',
      conversationId,
      path: '',
      parent: null,
      entries: listRemoteRootEntries(roots, { exists: existsSync, label: trayDirLabel })
    }
  }
  const entries = listRemoteChildEntries(path, roots, {
    readdir: (dir) => readdirSync(dir, { withFileTypes: true }),
    join
  })
  if (entries === 'forbidden') return 'forbidden'
  return {
    type: 'dirs',
    conversationId,
    path,
    parent: remoteParentPath(path, roots),
    entries
  }
}

function setRemoteWorkspace(
  conversationId: string,
  path: string | null
): 'ok' | 'not-found' | 'archived' | 'forbidden' {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return 'not-found'
  if (conversation.archived) return 'archived'
  if (!path) {
    applyWorkingDirectory(conversationId, mintTempWorkdir())
    return 'ok'
  }
  const roots = remoteRootsFor(conversationId)
  if (!roots || !remotePathAllowed(path, roots) || !existsSync(path)) return 'forbidden'
  applyWorkingDirectory(conversationId, path)
  return 'ok'
}

function cancelRemote(conversationId: string): 'ok' | 'not-found' | 'archived' {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return 'not-found'
  if (conversation.archived) return 'archived'
  // A follow-up queued on the phone must not start the moment this turn dies.
  pendingRemoteSends.clear(conversationId)
  // Hit both runtimes: agentFor can disagree with the live turn (host switch
  // mid-turn, or cancel arriving before the chosen host has registered it).
  agent.cancel(conversationId)
  cliHost.cancel(conversationId)
  return 'ok'
}

function replyRemote(conversationId: string, toolCallId: string, answer: string): boolean {
  if (cliHost.answer(conversationId, toolCallId, answer)) return true
  return agent.answer(conversationId, toolCallId, answer)
}

function renameRemote(conversationId: string, title: string): 'ok' | 'not-found' | 'archived' {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return 'not-found'
  if (conversation.archived) return 'archived'
  conversationStore.updateMeta(conversationId, { title: title.trim() || t('common.untitledSession') })
  publishConversations()
  return 'ok'
}

function archiveRemote(conversationId: string): 'ok' | 'not-found' {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return 'not-found'
  void agent.cancel(conversationId)
  cliHost.cancel(conversationId)
  conversationStore.setArchived(conversationId, true)
  publishConversations()
  return 'ok'
}

function remoteCatalogModels(host: CliHostKind | null, accountId?: string | null): { id: string; label: string }[] {
  const settings = settingsStore.get()
  const vendorId = host == null ? vendorIdFromEndpoint(settings.apiEndpoint) : null
  const key = agentModelHostKey(host, vendorId, accountId)
  const snap = getModelCatalogSnapshot()
  const raw =
    snap[key]?.models?.length ? snap[key]!.models : modelsForChatHost(host, settings.customModels, settings.defaultModel)
  const listed = host === 'cursor' ? collapseCursorListModels(raw) : raw
  return filterEnabledModels(host, listed, settings.disabledAgentModels, vendorId, accountId).map((model) => ({
    id: model.id,
    label: labelForChatModel(host, model.id, settings.customModels, listed)
  }))
}

function listRemoteControls(conversationId: string): RemoteControlsEvent | null {
  const conversation = conversationStore.get(conversationId)
  if (!conversation || conversation.archived) return null
  const host = conversation.cliHost ?? null
  const settings = settingsStore.get()
  const agents = enabledCliAgents(settings.cliAgents)
    .filter((agent) => isStructuredCliHost(agent.id))
    .map((agent) => ({
      id: agent.id,
      label: agent.name?.trim() || agentLabel(agent.id)
    }))
  const models = remoteCatalogModels(host, conversation.accountId)
  const catalogueDefault =
    host === 'cursor'
      ? (getModelCatalogSnapshot()[agentModelHostKey('cursor')]?.models ?? []).find(
          (model) => model.id === conversation.model
        )?.defaultThinkingLevel ?? null
      : null
  return buildRemoteControls({
    conversationId,
    cliHost: host,
    model: conversation.model,
    thinkingLevel: conversation.thinkingLevel,
    approvalMode: conversation.approvalMode,
    acpSession: conversation.acpSession,
    hasMessages: conversation.messages.length > 0,
    agents,
    models,
    catalogueDefaultThinking: catalogueDefault,
    workingDirectory: conversation.workingDirectory,
    dirLabel: trayDirLabel(conversation.workingDirectory),
    temporary: remoteIsTemporary(conversation.workingDirectory, tmpdir()),
    fast: conversation.fast === true
  })
}

function configureRemote(message: RemoteConfigure): 'ok' | 'not-found' | 'archived' | 'locked' {
  const conversation = conversationStore.get(message.conversationId)
  if (!conversation) return 'not-found'
  if (conversation.archived) return 'archived'
  const id = message.conversationId

  if (message.agent !== undefined) {
    const parsed = parseAgentId(message.agent)
    if (!parsed) return 'not-found'
    const nextHost = parsed === 'vav' ? null : parsed
    const prevHost = conversation.cliHost ?? null
    if (prevHost !== nextHost) {
      if (conversation.messages.length > 0) return 'locked'
      agent.disposeConversation(id)
      cliHost.dispose(id)
      changeSetStore.clearConversation(id)
      conversationStore.switchHostTranscript(id, nextHost)
      conversationStore.updateMeta(id, {
        accountId: accountIdForSession(conversation.workingDirectory ?? null, nextHost)
      })
      swarmSession.syncHostCursor(id, nextHost)
      coerceConversationModel(id)
      if (nextHost) promoteEphemeralConversation(id)
    }
  }

  if (message.model !== undefined) {
    const latest = conversationStore.get(id)
    const host = (latest?.cliHost ?? null) as CliHostKind | null
    const creds = resolveVavCredentials(
      { conversation: latest, settingsEndpoint: settingsStore.get().apiEndpoint },
      accountStore,
      secretStore
    )
    const vendorId = host == null ? vendorIdFromEndpoint(creds.endpoint) : null
    conversationStore.updateMeta(id, {
      model: message.model,
      tokenLimit: contextWindowForModel(host, message.model, undefined, vendorId, creds.accountId)
    })
    if (cliHost.owns(id)) cliHost.applyModel(id, message.model)
  }

  if (message.thinkingLevel !== undefined) {
    conversationStore.setThinkingLevel(id, parseThinkingLevel(message.thinkingLevel))
    if (cliHost.owns(id)) cliHost.applyThinkingLevel(id)
  }

  if (message.approvalMode !== undefined) {
    const mode = parseApprovalMode(message.approvalMode)
    if (mode) conversationStore.setApprovalMode(id, mode)
  }

  if (message.mode !== undefined && message.mode.trim()) {
    const latest = conversationStore.get(id)
    const config = latest?.acpSession?.configOptions?.find((option) => option.category === 'mode')
    if (config) cliHost.applySessionConfig(id, config.id, message.mode.trim())
    else cliHost.applySessionMode(id, message.mode.trim())
  }

  if (message.fast !== undefined) {
    conversationStore.setFast(id, message.fast === true)
    if (cliHost.owns(id)) cliHost.applyFast(id)
  }

  publishConversations()
  pushTokenUsageIfOpen(id)
  return 'ok'
}

function refreshRemoteControls(conversationId: string): void {
  const conversation = conversationStore.get(conversationId)
  if (!conversation || conversation.archived) return
  void listHostModels(conversation.cliHost ?? null, settingsStore, vavModelListOptions()).then(() => {
    const controls = listRemoteControls(conversationId)
    if (controls) remoteControl.pushControls(controls)
  })
}

const pendingRemoteSends = new RemoteSendQueue()

function remoteTurnBusy(conversationId: string): boolean {
  return agentFor(conversationId) === 'cli'
    ? cliHost.isRunning(conversationId)
    : agent.isRunning(conversationId)
}

function startRemoteTurn(conversationId: string, text: string, attachments: string[]): void {
  if (agentFor(conversationId) === 'cli') {
    void cliHost.run(conversationId, text, attachments, null, null, null)
  } else {
    void agent.run(conversationId, text, attachments, null, null, null)
  }
}

function flushRemoteSends(): void {
  for (const next of pendingRemoteSends.takeReady(remoteTurnBusy)) {
    startRemoteTurn(next.conversationId, next.text, next.attachments)
  }
}

/** Same entry path as the renderer's agentSend — remote text is a plain turn. */
function remoteSendMessage(
  conversationId: string,
  text: string,
  attachments: string[] = []
): 'ok' | 'not-found' | 'archived' {
  const conversation = conversationStore.get(conversationId)
  if (!conversation) return 'not-found'
  if (conversation.archived) return 'archived'
  if (remoteTurnBusy(conversationId)) {
    pendingRemoteSends.enqueue(conversationId, text, attachments)
    return 'ok'
  }
  startRemoteTurn(conversationId, text, attachments)
  return 'ok'
}

const remoteControl = new RemoteControlService({
  enabled: () => settingsStore.get().remoteControlEnabled === true,
  appVersion: app.getVersion(),
  listSessions: listRemoteSessions,
  listThread: listRemoteThread,
  listControls: (conversationId) => {
    const controls = listRemoteControls(conversationId)
    if (controls) refreshRemoteControls(conversationId)
    return controls
  },
  listHost: listRemoteHost,
  configure: configureRemote,
  sendMessage: remoteSendMessage,
  createSession: createRemoteSession,
  cancel: cancelRemote,
  reply: replyRemote,
  rename: renameRemote,
  archive: archiveRemote,
  browse: browseRemoteDirs,
  setWorkspace: setRemoteWorkspace,
  onStatusChange: (status) => {
    // Sidebar (main window) shows connected device names; settings + connect
    // windows render the full pairing UI.
    for (const win of [mainWindow, settingsWindow, connectWindow]) {
      if (win && !win.isDestroyed()) safeSend(win.webContents, IPC.remoteControlChanged, status)
    }
  },
  onDaemonSocket: (socket, leftover) => daemonAttach.adoptAuthedSocket(socket, leftover)
})

const daemonAttach = new DaemonAttachService({
  userData: app.getPath('userData'),
  registry: hostRegistry,
  secret: () => remoteControl.pairingSecret(),
  appVersion: app.getVersion(),
  enabled: () => settingsStore.get().remoteControlEnabled === true,
  tailcatToken: () => remoteControl.tunnelToken(),
  dialTunnel: (token) => openTailcatDial(token),
  catalog: {
    listSessions: () =>
      conversationStore
        .listMeta()
        .filter((c) => !c.fileId && !c.archived && conversationOnMachine(c, LOCAL_MACHINE_ID))
        .slice(0, 100),
    getSession: (id) => {
      const conversation = conversationStore.get(id)
      if (
        !conversation ||
        conversation.fileId ||
        conversation.archived ||
        !conversationOnMachine(conversation, LOCAL_MACHINE_ID)
      ) {
        return null
      }
      return conversation
    },
    listRecents: () => {
      const fromSettings = recentsForMachine(
        settingsStore.get().recentWorkspaceDirectories,
        LOCAL_MACHINE_ID
      ).map((ref) => ref.path)
      const fromSessions = conversationStore
        .listMeta()
        .filter(
          (c) =>
            !c.fileId &&
            !c.archived &&
            conversationOnMachine(c, LOCAL_MACHINE_ID) &&
            Boolean(c.workingDirectory)
        )
        .map((c) => c.workingDirectory as string)
      const seen = new Set<string>()
      const out: string[] = []
      for (const path of [...fromSettings, ...fromSessions]) {
        const trimmed = path.trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        out.push(trimmed)
      }
      return out.slice(0, 20)
    }
  },
  onHostAttached: (machineId) => pullRemoteWorkspace(machineId),
  onHostsChanged: (hosts) => {
    broadcast(IPC.hostsChanged, decorateHosts(hosts))
    syncHostWindows(hosts)
  },
  onDiscovered: (peers) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      safeSend(settingsWindow.webContents, IPC.hostsDiscoveredChanged, peers)
    }
    if (connectWindow && !connectWindow.isDestroyed()) {
      safeSend(connectWindow.webContents, IPC.hostsDiscoveredChanged, peers)
    }
  },
  confirmLanPair: async (from) => {
    const parent =
      (connectWindow && !connectWindow.isDestroyed() && connectWindow.isVisible()
        ? connectWindow
        : null) ??
      (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
    if (parent) {
      if (parent.isMinimized()) parent.restore()
      parent.show()
    }
    const opts: Electron.MessageBoxOptions = {
      type: 'question',
      title: t('machines.lanPairTitle'),
      message: t('machines.lanPairTitle'),
      detail: t('machines.lanPairBody', { name: from.name }),
      buttons: [t('common.allow'), t('common.deny')],
      defaultId: 1,
      cancelId: 1
    }
    const result = parent
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts)
    return result.response === 0
  }
})

/** Pull the other computer's sessions and folder recents before its window boots. */
async function pullRemoteWorkspace(machineId: string): Promise<void> {
  const id = String(machineId || '')
  if (!id || isLocalMachine(id)) return
  const catalog = await daemonAttach.pullHostCatalog(id)
  let sessionsChanged = false
  for (const raw of catalog.sessions) {
    const adopted = conversationStore.adoptHostConversation(raw as Conversation, id)
    if (adopted) sessionsChanged = true
  }
  for (const path of catalog.recents) {
    settingsStore.rememberWorkspaceDirectory(path, '', id)
  }
  if (sessionsChanged) broadcast(IPC.convChanged, conversationStore.listMeta())
  if (catalog.recents.length > 0) broadcast(IPC.settingsChanged, currentSettings())
}

hostRegistry.onChange((hosts) => {
  broadcast(IPC.hostsChanged, decorateHosts(hosts))
  syncHostWindows(hosts)
})

notifications.onAlert = (kind, conversationId, title, body) =>
  remoteControl.notifyRemote(kind, conversationId, title, body)

function isAuxiliaryWindow(window: BrowserWindow): boolean {
  // Settings and the warm token-usage panel never host PTYs / file trees /
  // streaming transcripts — skip them on the hot path.
  if (settingsWindow && !settingsWindow.isDestroyed() && window === settingsWindow) return true
  if (connectWindow && !connectWindow.isDestroyed() && window === connectWindow) return true
  if (tokenUsageWindow && !tokenUsageWindow.isDestroyed() && window === tokenUsageWindow) return true
  if (providerAccountWindow && !providerAccountWindow.isDestroyed() && window === providerAccountWindow) {
    return true
  }
  if (screenshotController?.isOverlay(window)) return true
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

  eachMainShell(deliver)

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
  if (target === connectWindow) {
    // Same deal as Settings: light renderer, ⌘W hides the popup.
    if (command === 'close-context') hideConnectWindow()
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
      openSettingsWindow('appearance')
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

function e2eMainWindow(): BrowserWindow | null {
  return (
    BrowserWindow.getAllWindows().find((window) => {
      if (window.isDestroyed() || !window.isVisible()) return false
      const url = window.webContents.getURL()
      return (
        !url.includes('view=settings') &&
        !url.includes('view=token') &&
        !url.includes('view=app-window')
      )
    }) ?? null
  )
}

/** E2E: same matcher + dispatch as `before-input-event`, without Chromium key delivery. */
function e2eDispatchAccelerator(input: {
  type: string
  key: string
  code: string
  control: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}): MenuCommand | 'new-session-window' | null {
  const main = e2eMainWindow()
  main?.focus()
  const bindings = currentKeyBindings()
  const electronInput = input as Electron.Input
  if (matchesNewSessionWindow(electronInput, bindings)) {
    newDetachedSession()
    return 'new-session-window'
  }
  const command = menuCommandFromInput(electronInput, bindings)
  if (!command) return null
  if (command === 'open-settings') {
    openSettingsWindow('appearance')
    return command
  }
  sendMenuCommand(command)
  return command
}

if (isE2eRuntime()) {
  ;(
    globalThis as { __e2eDispatchAccelerator?: typeof e2eDispatchAccelerator }
  ).__e2eDispatchAccelerator = e2eDispatchAccelerator
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
function windowBackground(alpha: string = ''): string {
  return windowBackgroundColor(nativeTheme.shouldUseDarkColors, alpha)
}

/** `dark` | `light` for renderer bootstrap (query + early HTML paint). */
function windowThemeName(): 'dark' | 'light' {
  return windowThemeNameFromDark(nativeTheme.shouldUseDarkColors)
}

/**
 * Paint html/body/#root before React/CSS arrive so dark-mode cold opens
 * (session / Settings / main) never flash system white.
 * Main window with vibrancy must stay transparent or it masks the system glass.
 */
function primeRendererShell(win: BrowserWindow, options?: { clear?: boolean }): void {
  primeShellPaint(win, { clear: options?.clear, dark: nativeTheme.shouldUseDarkColors })
}

/**
 * macOS system glass (not CSS backdrop-filter).
 * `under-window` blurs the desktop through transparent regions — `sidebar`
 * alone is nearly invisible on recent macOS when the web layer was opaque.
 * Used by the main shell and the Settings nav column.
 */
function applyWindowVibrancy(win: BrowserWindow): void {
  applyVibrancyPaint(win, nativeTheme.shouldUseDarkColors)
}

function clearWindowVibrancy(win: BrowserWindow): void {
  clearVibrancyPaint(win, nativeTheme.shouldUseDarkColors)
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

const vibrancyRefreshTimers = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>()
/** Set on minimize/hide; Dock restore sometimes skips Electron `restore`. */
const vibrancyNeedsRefresh = new WeakSet<BrowserWindow>()

/**
 * After minimize/hide, NSVisualEffectView often stops compositing. Sidebar
 * CSS is intentionally clear so the glass shows through — without the native
 * layer the column is a hole. Tear the effect down and re-attach on-screen.
 */
function refreshWindowVibrancy(win: BrowserWindow): void {
  if (!IS_MAC || win.isDestroyed() || !isVibrancyShellWindow(win)) return
  if (!isVibrancyEnabled()) {
    clearWindowVibrancy(win)
    applyTrafficLights(win)
    return
  }
  if (!win.webContents.isDestroyed()) {
    void win.webContents
      .executeJavaScript(
        `try { document.documentElement.dataset.vibrancyRefresh = '1' } catch (e) {}`,
        true
      )
      .catch(() => undefined)
  }
  try {
    win.setVibrancy(null)
  } catch {
    // ignore
  }
  setTimeout(() => {
    if (win.isDestroyed() || win.isMinimized()) return
    applyWindowVibrancy(win)
    applyTrafficLights(win)
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    void win.webContents
      .executeJavaScript(
        `(function(){
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              try { delete document.documentElement.dataset.vibrancyRefresh } catch (e) {}
            });
          });
        })()`,
        true
      )
      .catch(() => undefined)
  }, 16)
}

function scheduleVibrancyRefresh(win: BrowserWindow): void {
  if (!IS_MAC || win.isDestroyed() || !isVibrancyShellWindow(win)) return
  const prev = vibrancyRefreshTimers.get(win)
  if (prev) clearTimeout(prev)
  // AppKit finishes restore compositing a tick after the `restore` event.
  vibrancyRefreshTimers.set(
    win,
    setTimeout(() => {
      vibrancyRefreshTimers.delete(win)
      if (win.isDestroyed() || win.isMinimized()) return
      refreshWindowVibrancy(win)
    }, 32)
  )
}

/** Dock restore / hide→show: NSVisualEffectView must be recreated, not just set. */
function wireVibrancyRefresh(win: BrowserWindow): void {
  if (!IS_MAC) return
  win.on('minimize', () => {
    vibrancyNeedsRefresh.add(win)
  })
  win.on('hide', () => {
    vibrancyNeedsRefresh.add(win)
  })
  win.on('restore', () => {
    if (win.isDestroyed()) return
    vibrancyNeedsRefresh.delete(win)
    scheduleVibrancyRefresh(win)
  })
  win.on('show', () => {
    if (win.isDestroyed() || win.isMinimized()) return
    if (!vibrancyNeedsRefresh.has(win)) return
    vibrancyNeedsRefresh.delete(win)
    scheduleVibrancyRefresh(win)
  })
}

/** Apply or clear glass on main + Settings (create, toggle, theme repaint). */
function syncVibrancyShellWindows(): void {
  if (!IS_MAC) return
  if (mainWindow && !mainWindow.isDestroyed()) syncWindowMaterial(mainWindow)
  if (settingsWindow && !settingsWindow.isDestroyed()) syncWindowMaterial(settingsWindow)
}


/** Main window + detached session column — narrowest useful shell. */
const MAIN_WINDOW_MIN_WIDTH = 400

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
  return overlayColorsForTheme(nativeTheme.shouldUseDarkColors, barHeight)
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
  return chromeOptions({
    isMac: IS_MAC,
    barHeight,
    vibrancyShell: options?.vibrancyShell,
    vibrancyEnabled: isVibrancyEnabled(),
    background: windowBackground(),
    backgroundVibrancy: windowBackground('01'),
    overlay: overlayColors(barHeight)
  }) as Electron.BrowserWindowConstructorOptions
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
  wireShellExternalLinks(contents, (url) => {
    void shell.openExternal(url)
  }, isRendererUrl)
}

/** Shared renderer prefs — keep timers/rAF alive while the window is hidden. */
function rendererPrefs(extra: Electron.WebPreferences = {}): Electron.WebPreferences {
  return buildRendererPrefs(join(__dirname, '../preload/index.js'), extra)
}

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
    const victimPath = nextUnfocusedPreviewPath(previewWindows, path)
    if (!victimPath) break
    const victim = previewWindows.get(victimPath)
    if (!victim) break
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
  const wasMinimized = win.isMinimized()
  try {
    if (!isVibrancyShellWindow(win)) win.setBackgroundColor(windowBackground())
    // Minimized: `restore` recreates NSVisualEffectView. Re-applying glass
    // while still miniaturized is what leaves the sidebar as a hole.
    else if (!wasMinimized && vibrancyNeedsRefresh.has(win)) {
      vibrancyNeedsRefresh.delete(win)
      scheduleVibrancyRefresh(win)
    } else if (!wasMinimized) {
      syncWindowMaterial(win)
    }
  } catch {
    // ignore
  }
  if (wasMinimized) win.restore()
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

function eachMainShell(fn: (window: BrowserWindow) => void): void {
  if (mainWindow && !mainWindow.isDestroyed()) fn(mainWindow)
  for (const window of hostWindows.values()) {
    if (!window.isDestroyed()) fn(window)
  }
}

function hostWindowOf(machineId: string | null | undefined): BrowserWindow | null {
  const id = normalizeMachineId(machineId)
  if (isLocalMachine(id)) {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  }
  const window = hostWindows.get(id)
  return window && !window.isDestroyed() ? window : null
}

function hostWindowTitle(machineId: string, name?: string): string {
  const label = name?.trim() || hostRegistry.get(machineId)?.info.name || machineId
  return formatHostWindowTitle(APP_NAME, isLocalMachine(machineId), label)
}

function syncHostWindows(hosts: WorkspaceHostInfo[]): void {
  const known = new Set(hosts.map((host) => host.id))
  for (const id of [...hostWindows.keys()]) {
    if (!known.has(id)) closeHostWindow(id)
  }
  for (const host of hosts) {
    const window = hostWindows.get(host.id)
    if (window && !window.isDestroyed()) window.setTitle(hostWindowTitle(host.id, host.name))
  }
  notifications.notifyHostsChanged()
}

function closeHostWindow(machineId: string): void {
  const window = hostWindows.get(machineId)
  hostWindows.delete(machineId)
  if (!window || window.isDestroyed()) return
  try {
    window.destroy()
  } catch {
    // ignore
  }
}

function createWindow(opts?: { machineId?: string }): BrowserWindow {
  const machineId = normalizeMachineId(opts?.machineId)
  const icon = loadAppIcon()
  const snapshotting = Boolean(process.env.VAV_SNAPSHOT)
  const e2e = isE2eRuntime()
  const { width, height } = mainWindowSize({ snapshotting, e2e })
  const window = new BrowserWindow({
    width,
    height,
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
  wireVibrancyRefresh(window)

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
  loadRenderer(window, isLocalMachine(machineId) ? {} : { machine: machineId })
  if (!isLocalMachine(machineId)) {
    window.setTitle(hostWindowTitle(machineId))
    const anchor = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    if (anchor) {
      const [x, y] = anchor.getPosition()
      window.setPosition(x + 36, y + 36)
    }
    hostWindows.set(machineId, window)
    window.on('closed', () => {
      if (hostWindows.get(machineId) === window) hostWindows.delete(machineId)
    })
  }

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

/** Dedicated lightweight page — no App / xterm / office graph. */
function loadScreenshotRenderer(window: BrowserWindow): void {
  const base = process.env.ELECTRON_RENDERER_URL?.replace(/\/$/, '')
  if (base) {
    window.loadURL(`${base}/screenshot.html`)
    return
  }
  window.loadFile(join(__dirname, '../renderer/screenshot.html'))
}

/** Category the next Settings paint should show. ⌘, parks on Appearance. */
let settingsDesiredView: { view: SettingsView; agentId?: string } = { view: 'appearance' }

function openSettingsWindow(view: SettingsView = 'appearance', agentId?: string): void {
  const resolved = resolveSettingsView(view ?? 'appearance', agentId)
  settingsDesiredView = resolved
  void serveAnalysisSnapshot({ refresh: false }).catch((err) => {
    console.error('[analysis] prefetch failed', err)
  })
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    safeSend(settingsWindow.webContents, IPC.settingsView, resolved)
    void revealBrowserWindow(settingsWindow)
    return
  }

  ensureSettingsWindow(resolved.view, true, resolved.agentId)
}

/**
 * Keep Settings warm like the token panel: hide on close, show instantly next time.
 */
function ensureSettingsWindow(
  view: SettingsView = 'appearance',
  showNow: boolean,
  agentId?: string
): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (showNow) openSettingsWindow(view, agentId)
    return
  }

  settingsWindow = new BrowserWindow({
    width: 780,
    height: 580,
    minWidth: 680,
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
  wireVibrancyRefresh(settingsWindow)

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
  settingsDesiredView = { view: 'appearance' }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    safeSend(settingsWindow.webContents, IPC.settingsView, settingsDesiredView)
    settingsWindow.hide()
  }
}

function warmSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) return
  ensureSettingsWindow('appearance', false)
}

/**
 * Small pairing popup from the sidebar Connect button: phone QR + vavd
 * machines, nothing else. Same hide-on-close warmth as Settings.
 */
const CONNECT_WINDOW_WIDTH = 440
const CONNECT_WINDOW_MIN_HEIGHT = 200

function fitConnectWindow(height: number): void {
  if (!connectWindow || connectWindow.isDestroyed()) return
  const display = screen.getDisplayMatching(connectWindow.getBounds())
  const maxH = Math.max(CONNECT_WINDOW_MIN_HEIGHT, display.workArea.height)
  const next = Math.round(Math.min(maxH, Math.max(CONNECT_WINDOW_MIN_HEIGHT, height)))
  const [currentW, currentH] = connectWindow.getContentSize()
  if (currentW !== CONNECT_WINDOW_WIDTH || currentH !== next) {
    connectWindow.setContentSize(CONNECT_WINDOW_WIDTH, next)
  }
}

function openConnectWindow(): void {
  if (connectWindow && !connectWindow.isDestroyed()) {
    connectWindow.setResizable(false)
    void revealBrowserWindow(connectWindow)
    return
  }

  connectWindow = new BrowserWindow({
    width: CONNECT_WINDOW_WIDTH,
    height: CONNECT_WINDOW_MIN_HEIGHT,
    useContentSize: true,
    resizable: false,
    show: false,
    paintWhenInitiallyHidden: true,
    title: t('app.connectWindowTitle'),
    icon: loadAppIcon(),
    ...chrome(TOOLBAR_HEIGHT),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: rendererPrefs()
  })
  applyMenuBar(connectWindow)
  applyTrafficLights(connectWindow)

  connectWindow.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    if (connectWindow && !connectWindow.isDestroyed()) connectWindow.hide()
  })
  connectWindow.on('closed', () => {
    connectWindow = null
  })

  wireExternalLinks(connectWindow.webContents)

  if (!app.isPackaged) {
    connectWindow.webContents.on('console-message', (event) => {
      console.log(`[connect:${event.level}] ${event.message}`)
    })
  }

  connectWindow.once('ready-to-show', () => {
    if (connectWindow && !connectWindow.isDestroyed()) {
      void revealBrowserWindow(connectWindow)
    }
  })
  loadRenderer(connectWindow, { view: 'connect' })
}

/** Hide (don't destroy) so the next open is instant. */
function hideConnectWindow(): void {
  if (connectWindow && !connectWindow.isDestroyed()) connectWindow.hide()
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
  const stored = settingsStore.get().detachedWindowSize
  const width = Math.min(stored?.width ?? MAIN_WINDOW_MIN_WIDTH, area.width - 40)
  const height = Math.min(stored?.height ?? 760, area.height - 60)
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
  window.removeAllListeners('resize')

  let resizeTimer: NodeJS.Timeout | null = null
  window.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (window.isDestroyed() || window.isFullScreen() || window.isMaximized()) return
      const { width, height } = window.getBounds()
      settingsStore.update({ detachedWindowSize: { width, height } })
    }, 500)
  })

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
    if (resizeTimer) {
      clearTimeout(resizeTimer)
      resizeTimer = null
    }
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
    const width = clampPreviewWidth(PREVIEW_DEFAULT_WIDTH, area.width)
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
  fileService.grantPath(path)
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
  const width = clampPreviewWidth(snapshotting ? 1280 : PREVIEW_DEFAULT_WIDTH, area.width)
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
  reported?: number,
  vendorId?: string | null,
  accountId?: string | null
): number {
  const listed = getModelCatalogSnapshot()[agentModelHostKey(host, vendorId, accountId)]?.models?.find(
    (m) => m.id === modelId
  )?.contextWindow
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
  const creds = resolveVavCredentials(
    { conversation, settingsEndpoint: settings.apiEndpoint },
    accountStore,
    secretStore
  )
  const vendorId = host == null ? vendorIdFromEndpoint(creds.endpoint) : null
  const key = agentModelHostKey(host, vendorId, creds.accountId)
  const catalogue = getModelCatalogSnapshot()[key]?.models
  const resolved = resolveModelForChatHost(host, conversation.model, {
    customModels: settings.customModels,
    vavDefaultModel: settings.defaultModel,
    hostDefaultModel: defaultModelForChatHost(host, settings),
    catalogue,
    vendorId
  })
  const patch: { model?: string; tokenLimit?: number; fast?: boolean } = {}
  if (host === 'cursor' && conversation.model) {
    const normalized = normalizeCursorConversationModel(conversation.model)
    if (normalized.migrated && normalized.fast === true && conversation.fast !== true) {
      patch.fast = true
    }
  }
  if (resolved !== conversation.model) {
    patch.model = resolved
    patch.tokenLimit = contextWindowForModel(host, resolved, undefined, vendorId, creds.accountId)
  }
  if (Object.keys(patch).length > 0) {
    conversationStore.updateMeta(conversationId, patch)
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
  const creds = currentWorkspaceVavCredentials()
  const vendorId = host == null ? vendorIdFromEndpoint(creds.endpoint) : null
  const key = agentModelHostKey(host, vendorId, creds.accountId)
  const catalogue = getModelCatalogSnapshot()[key]?.models
  const hostDefault = defaultModelForChatHost(host, settings)
  return resolveModelForChatHost(host, preferredModel ?? hostDefault, {
    customModels: settings.customModels,
    vavDefaultModel: settings.defaultModel,
    hostDefaultModel: hostDefault,
    catalogue,
    vendorId
  })
}

/** Lean snapshot for the panel — never ships message bodies. */
function buildTokenUsagePayload(conversationId: string): TokenUsageViewPayload | null {
  if (conversationStore.hydrateMissingHostUsage(conversationId)) {
    publishConversations()
  }
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
  const creds = resolveVavCredentials(
    { conversation, settingsEndpoint: settings.apiEndpoint },
    accountStore,
    secretStore
  )
  const vendorId = cliHost == null ? vendorIdFromEndpoint(creds.endpoint) : null
  const accountId = creds.accountId
  const catalogue = getModelCatalogSnapshot()[agentModelHostKey(cliHost, vendorId, accountId)]?.models
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
    tokenLimit: contextWindowForModel(cliHost, model, conversation.tokenLimit, vendorId, accountId),
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
    quotaWindows: conversationHostQuota(conversation),
    accountUsage: tokenUsageAccountRows(conversation)
  }
}

function tokenUsageAccountRows(
  conversation: Conversation
): import('@shared/ipc').TokenUsageAccountRow[] {
  const fallback = t('accounts.workspaceDefault')
  const dirLabel =
    workspaceKeyOf(conversation.workingDirectory) === '__default__'
      ? fallback
      : conversation.workingDirectory?.split(/[\\/]/).filter(Boolean).at(-1) || fallback
  const names = new Map<string, string>()
  for (const account of accountStore.listVisible(workspaceKeyOf(conversation.workingDirectory))) {
    names.set(account.id, displayAccountLabel(account, dirLabel))
  }
  return sessionUsageRowsOf(conversation.tokenHistory ?? [], names, t('accounts.untitled'))
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
    windows: conversationHostQuota(conversation),
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
  const peek = peekHostAccountQuota(conversation, host)
  const loading = buildProviderAccountPayload(conversationId, {
    loading: waitingQuota && (peek ? peek.windows.length > 0 : true),
    signedIn: peek?.signedIn ?? providerAccountAuth?.signedIn ?? false,
    accountId: peek?.accountId ?? providerAccountAuth?.accountId ?? null,
    plan: peek?.plan ?? providerAccountAuth?.plan ?? null,
    authKind: peek?.authKind ?? providerAccountAuth?.authKind
  })
  if (loading) sendProviderAccountPayload(loading)
  const account = await readHostAccountInfo(host)
  if (host) lastLiveOAuth.set(host, account.signedIn ? account.accountId : null)
  const auth = conversationQuotaAuth(conversation, account)
  providerAccountAuth = auth
  await quotaService.refreshForPanel(host)
  const next = buildProviderAccountPayload(conversationId, {
    loading: false,
    signedIn: auth.signedIn,
    accountId: auth.accountId,
    plan: auth.plan,
    authKind: auth.authKind
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
  const workdir = resolveNewWorkdir()
  const source = lastSeenConversationId ? conversationStore.get(lastSeenConversationId) : null
  const inheritModel = settings.swarmModeEnabled === true ? source?.model : undefined
  const conversation = conversationStore.create(
    workdir,
    modelForNewConversation(defaultHost, inheritModel),
    {
      approvalMode: settings.defaultApprovalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(settings.defaultThinkingLevel),
      cliHost: defaultHost,
      accountId: accountIdForSession(workdir, defaultHost)
    }
  )
  ephemeralConversations.add(conversation.id)
  lastSeenConversationId = conversation.id
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

    const iconFor = (item: NativeMenuItem): Electron.NativeImage | undefined => {
      if (!item.icon) return undefined
      // Renderer rasterizes 32px for the 16pt slot — declare the 2x scale or
      // AppKit would size the image at 32pt and blow up the row.
      const image = nativeImage.createEmpty()
      image.addRepresentation({ scaleFactor: 2, dataURL: item.icon })
      if (image.isEmpty()) return undefined
      // Template: macOS tints from the alpha channel — follows menu appearance
      // and highlight (white on accent) like a checkmark. No-op elsewhere.
      if (item.iconTemplate) image.setTemplateImage(true)
      return image
    }

    // Use `radio` (not `checkbox`) for exclusive picks like model / approval mode.
    // Checkbox groups on AppKit often fail to fire click for non-checked rows.
    const toTemplate = (rows: NativeMenuItem[]): Electron.MenuItemConstructorOptions[] =>
      rows.map((item) => {
        if (item.separator) return { type: 'separator' }
        if (item.header) {
          // macOS 14+ section header; older platforms fall back to a disabled title.
          return process.platform === 'darwin'
            ? { type: 'header', label: item.label ?? '' }
            : { label: item.label ?? '', enabled: false }
        }
        if (item.role) return { role: item.role, label: item.label }
        if (item.submenu && item.submenu.length > 0) {
          return {
            type: 'submenu',
            label: item.label ?? '',
            enabled: item.enabled !== false,
            icon: iconFor(item),
            submenu: toTemplate(item.submenu)
          }
        }
        const hasCheck = item.checked !== undefined
        return {
          label: item.label ?? '',
          enabled: item.enabled !== false,
          type: hasCheck ? 'radio' : 'normal',
          checked: hasCheck ? !!item.checked : undefined,
          icon: iconFor(item),
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

async function showHostWindow(machineId?: string | null): Promise<void> {
  const raw = normalizeMachineId(machineId)
  const id =
    !isLocalMachine(raw) && !hostRegistry.get(raw) ? LOCAL_MACHINE_ID : raw
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    app.dock.show()
  }
  let win = hostWindowOf(id)
  if (!win) {
    win = createWindow({ machineId: id })
    if (isLocalMachine(id)) mainWindow = win
  }
  if (!win || win.isDestroyed()) return
  if (win.webContents.isLoading()) {
    await new Promise<void>((resolve) => {
      const done = (): void => resolve()
      win.webContents.once('did-finish-load', done)
      setTimeout(done, 2000)
    })
  }
  if (win.isDestroyed()) return
  await revealBrowserWindow(win)
  enforceAppZOrder(win)
}

async function showMainWindow(): Promise<void> {
  // Hidden-Dock sessions still need a visible window when the user (or a second
  // launch) asks for the app — briefly surface the Dock so Mission Control /
  // Cmd-Tab can find us too.
  const preferred = settingsStore.get().defaultMachineId
  await showHostWindow(preferred)
}

function activateApp(): void {
  screenshotController?.cancel()
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    app.dock.show()
  }

  // Dock click: if there is an unseen completion (badge), jump to it first.
  const firstDone = notifications.firstUnseenComplete()
  if (firstDone) {
    focusRunningSession({ conversationId: firstDone, surface: 'vav' })
    return
  }

  const last =
    lastFocusedWindow &&
    !lastFocusedWindow.isDestroyed() &&
    !screenshotController?.isOverlay(lastFocusedWindow)
      ? lastFocusedWindow
      : null
  const lastIsCompanion =
    last &&
    ([...detachedWindows.values()].includes(last) || [...previewWindows.values()].includes(last))
  if (lastIsCompanion && last) {
    void raiseDetachedWindow(last)
    return
  }
  void showMainWindow()
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
    settingsStore.rememberWorkspaceDirectory(workdir, tmpRootFor(undefined))
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
      cliHost: defaultHost,
      accountId: accountIdForSession(resolved, defaultHost)
    }
  )
  if (defaultHost) promoteEphemeralConversation(conversation.id)
  lastSeenConversationId = conversation.id
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
      fileService.grantPath(full)
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
    // 3) Global screenshot (configurable, default ⌃⌘A or ⌃⌘S in Dev)
  const screenshotAccel = currentKeyBindings().screenshot
  try {
    const ok = globalShortcut.register(screenshotAccel, () => {
      console.log(`[hotkey] screenshot fired: ${screenshotAccel}`)
      if (screenshotController) {
        // Find the sender window. If we have a focused window, use it;
        // otherwise we might not have a requester but start() handles null.
        const win = BrowserWindow.getFocusedWindow() || mainWindow
        if (win) {
          void screenshotController.start({ sender: win.webContents } as any)
        }
      }
    })
    if (!ok) {
      console.warn(`[hotkey] failed to register global screenshot: ${screenshotAccel}`)
    } else {
      console.log(`[hotkey] registered global screenshot: ${screenshotAccel}`)
    }
  } catch (err) {
    console.warn('[hotkey] screenshot register threw', err)
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
    if (
      window &&
      !window.isDestroyed() &&
      !screenshotController?.isOverlay(window)
    ) {
      lastFocusedWindow = window
    }
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

function tmpRootFor(machineId: string | null | undefined): string {
  if (isLocalMachine(machineId)) return tmpdir()
  return daemonAttach.tmpOf(normalizeMachineId(machineId))
}

function joinHostPath(platform: string | undefined, ...parts: string[]): string {
  return hostJoin(platform, ...parts)
}

function decorateHosts(hosts: WorkspaceHostInfo[]): WorkspaceHostInfo[] {
  return hosts.map((host) => {
    if (isLocalMachine(host.id)) return host
    const providers = daemonAttach.providersOf(host.id)
    const home = daemonAttach.homeOf(host.id) || host.home
    const tmp = daemonAttach.tmpOf(host.id) || host.tmp
    const defaultPath = daemonAttach.defaultPathOf(host.id) ?? undefined
    return { ...host, home, tmp, defaultPath, providers }
  })
}

function machineIdFromContents(contents: Electron.WebContents): string {
  try {
    const url = contents.getURL()
    if (!url) return LOCAL_MACHINE_ID
    return normalizeMachineId(new URL(url).searchParams.get('machine'))
  } catch {
    return LOCAL_MACHINE_ID
  }
}

function homeTmpFor(machineId: string): { home: string; tmp: string } {
  if (isLocalMachine(machineId)) {
    return { home: app.getPath('home'), tmp: tmpdir() }
  }
  const host = hostRegistry.get(machineId)
  return {
    home: host?.info.home || daemonAttach.homeOf(machineId),
    tmp: host?.info.tmp || daemonAttach.tmpOf(machineId)
  }
}

function conversationIdForGitCwd(cwd: string): string | undefined {
  const watched = fileService.conversationIdForPath(cwd)
  if (watched) return watched
  if (!cwd) return undefined
  let best: { id: string; len: number } | undefined
  for (const meta of conversationStore.listMeta()) {
    const root = meta.workingDirectory
    if (!root) continue
    if (cwd === root || cwd.startsWith(`${root}/`) || cwd.startsWith(`${root}\\`)) {
      if (!best || root.length > best.len) best = { id: meta.id, len: root.length }
    }
  }
  return best?.id
}

function machineIdForShell(event: IpcMainInvokeEvent, path: string): string {
  const fromPath = conversationIdForGitCwd(path) || fileService.conversationIdForPath(path)
  if (fromPath) {
    const conversation = conversationStore.get(fromPath)
    if (conversation) return normalizeMachineId(conversation.machineId)
  }
  return machineIdFromContents(event.sender)
}

function spawnOnHost(
  machineId: string,
  file: string,
  args: string[]
): void {
  const host = hostRegistry.hostFor(machineId)
  if (!host.info.online) return
  try {
    const child = host.process.spawn(file, args, {
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: true,
      windowsHide: true
    })
    child.unref()
    child.on('error', (err) => console.error('[host-shell]', err))
  } catch (err) {
    console.error('[host-shell]', err)
  }
}

async function revealOnMachine(machineId: string, path: string): Promise<void> {
  if (!path) return
  if (isLocalMachine(machineId)) {
    shell.showItemInFolder(path)
    return
  }
  const host = hostRegistry.hostFor(machineId)
  if (!host.info.online) return
  let isDirectory = false
  try {
    isDirectory = (await host.fs.stat(path)).isDirectory()
  } catch {
    // still try to reveal
  }
  const cmd = revealSpawn(host.info.platform, path, isDirectory)
  spawnOnHost(machineId, cmd.file, cmd.args)
}

async function openOnMachine(machineId: string, path: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!path) return { ok: false, error: 'empty path' }
  if (isLocalMachine(machineId)) return fileService.openWithDefault(path)
  const host = hostRegistry.hostFor(machineId)
  if (!host.info.online) return { ok: false, error: `${host.info.name} is offline` }
  const cmd = openSpawn(host.info.platform, path)
  spawnOnHost(machineId, cmd.file, cmd.args)
  return { ok: true }
}

async function previewOnMachine(machineId: string, path: string): Promise<void> {
  if (!path) return
  if (isLocalMachine(machineId)) {
    fileService.preview(path)
    return
  }
  const host = hostRegistry.hostFor(machineId)
  if (!host.info.online) return
  const cmd = previewSpawn(host.info.platform, path)
  spawnOnHost(machineId, cmd.file, cmd.args)
}

function rememberWorkdir(path: string, machineId?: string | null): void {
  const id = machineId === undefined ? undefined : normalizeMachineId(machineId)
  settingsStore.rememberWorkspaceDirectory(path, tmpRootFor(id), id)
  if (id && !isLocalMachine(id) && path) {
    const tmp = tmpRootFor(id)
    const isTemp = Boolean(tmp) && (path.startsWith(tmp) || path.startsWith('/private' + tmp))
    if (!isTemp) daemonAttach.rememberDefaultPath(id, path)
  }
}

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

/** Mint on the conversation’s machine — remote daemons cannot see this Mac’s tmp. */
async function mintTempWorkdirOn(machineId: string | null | undefined): Promise<string> {
  if (isLocalMachine(machineId)) return mintTempWorkdir()
  const host = hostRegistry.hostFor(machineId)
  const root = daemonAttach.tmpOf(host.id)
  const dir = joinHostPath(host.info.platform, root, 'vav', randomUUID().slice(0, 8), 'Workspace')
  try {
    await host.fs.mkdir(dir, { recursive: true })
    return dir
  } catch {
    return root || daemonAttach.homeOf(host.id)
  }
}

async function resolveNewWorkdirOn(machineId: string | null | undefined): Promise<string> {
  if (isLocalMachine(machineId)) return resolveNewWorkdir()
  const id = normalizeMachineId(machineId)
  const last = daemonAttach.defaultPathOf(id)
  if (last) return last
  const home = daemonAttach.homeOf(id)
  if (home) return home
  return mintTempWorkdirOn(id)
}

function applyWorkingDirectory(
  id: string,
  path: string,
  machineId?: string | null
): ReturnType<typeof conversationStore.listMeta> {
  const prev = conversationStore.get(id)?.workingDirectory ?? null
  conversationStore.updateMeta(id, {
    workingDirectory: path,
    ...(machineId !== undefined && machineId !== null ? { machineId } : {})
  })
  agent.setWorkingDirectory(id, path)
  if (prev !== path) {
    cliHost.setWorkingDirectory(id, path, prev)
    swarmSession.clearForConversation(id)
  }
  fileService.watchRoot(id, path)
  rememberWorkdir(path, machineId)
  broadcast(IPC.settingsChanged, currentSettings())
  publishConversations()
  return conversationStore.listMeta()
}

/** Empty default workdir mints a Temporary Workspace folder (README §2.5). */
function resolveNewWorkdir(): string {
  const configured = settingsStore.get().defaultWorkingDirectory.trim()
  if (configured) return configured
  return mintTempWorkdir()
}

/** Which daemon window Dock / tray / hotkey raise. */
function applyDefaultMachine(machineId: string): void {
  const id = machineId.trim() || LOCAL_MACHINE_ID
  if (settingsStore.get().defaultMachineId === id) return
  settingsStore.update({ defaultMachineId: id })
  broadcast(IPC.settingsChanged, currentSettings())
  notifications.notifyHostsChanged()
}

function accountIdForSession(
  workdir: string | null,
  cliHost?: CliHostKind | null
): string | null {
  const workspaceKey = workspaceKeyOf(workdir)
  accountStore.seedIfNeeded({
    workspaceKey,
    endpoint: settingsStore.get().apiEndpoint || null,
    hasApiKey: secretStore.has('api')
  })
  if (cliHost) {
    return resolveSessionAccountId(accountStore.listVisible(workspaceKey), cliHost)
  }
  const vendorId = settingsStore.get().defaultAgentId
  if (isLlmVendorId(vendorId)) {
    const rows = accountStore
      .listVisible(workspaceKey)
      .filter((row) => row.provider === 'vav' || agentIdOf(row) === 'vav')
    const match =
      rows.find((row) => row.current && vendorIdFromEndpoint(row.endpoint) === vendorId) ??
      rows.find((row) => vendorIdFromEndpoint(row.endpoint) === vendorId)
    if (match) return match.id
  }
  return accountStore.currentVav(workspaceKey)?.id ?? null
}

function pushAccountsIfSettingsOpen(): void {
  if (!settingsWindow || settingsWindow.isDestroyed()) return
  safeSend(settingsWindow.webContents, IPC.accountsUpdated, accountsPage())
}

/** Last CLI identity per OAuth host (`null` = signed out). Quota attaches here only. */
const lastLiveOAuth = new Map<string, string | null>()

function rememberLiveOAuth(live: Map<string, string | null>): void {
  for (const [host, email] of live) lastLiveOAuth.set(host, email)
}

function liveOAuthIdentity(host: string): string | null {
  if (lastLiveOAuth.has(host)) return lastLiveOAuth.get(host) ?? null
  return quotaService.identity(host as CliHostKind)
}

function namespacedQuotaFor(
  host: CliHostKind,
  conversationWindows?: import('@shared/types').QuotaWindow[] | null
): import('@shared/types').QuotaWindow[] {
  const identity = liveOAuthIdentity(host)
  return mergeNamespacedQuotaWindows(host, identity, quotaService.get(host, identity), conversationWindows)
}

function conversationQuotaAuth(
  conversation: { accountId?: string | null },
  live: { signedIn: boolean; accountId?: string | null; plan?: string | null; authKind?: import('@shared/cliAccountParse').HostAuthKind }
): {
  signedIn: boolean
  accountId: string | null
  plan: string | null
  authKind: import('@shared/cliAccountParse').HostAuthKind
} {
  const profile = conversation.accountId ? accountStore.get(conversation.accountId) : undefined
  const show = sessionShowsHostQuota({
    liveSignedIn: live.signedIn,
    liveIdentity: live.accountId,
    profileKind: profile?.kind,
    profileName: profile?.name
  })
  if (show) {
    return {
      signedIn: live.signedIn,
      accountId: live.accountId ?? null,
      plan: live.plan ?? null,
      authKind: live.authKind ?? (live.signedIn ? 'oauth' : 'none')
    }
  }
  return {
    signedIn: false,
    accountId: profile?.kind === 'oauth' ? profile.name : null,
    plan: null,
    authKind: profile?.kind === 'oauth' ? 'none' : (live.authKind ?? 'none')
  }
}

function conversationHostQuota(conversation: {
  accountId?: string | null
  cliHost?: CliHostKind | null
  quotaWindows?: import('@shared/types').QuotaWindow[] | null
}): import('@shared/types').QuotaWindow[] {
  const host = conversation.cliHost ?? null
  if (!host) return []
  const identity = liveOAuthIdentity(host)
  const profile = conversation.accountId ? accountStore.get(conversation.accountId) : undefined
  if (
    !sessionShowsHostQuota({
      liveSignedIn: Boolean(identity),
      liveIdentity: identity,
      profileKind: profile?.kind,
      profileName: profile?.name
    })
  ) {
    return []
  }
  return namespacedQuotaFor(host, conversation.quotaWindows)
}

function peekHostAccountQuota(
  conversation: {
    accountId?: string | null
    cliHost?: CliHostKind | null
    quotaWindows?: import('@shared/types').QuotaWindow[] | null
  },
  host: CliHostKind | null
): import('@shared/ipc').HostAccountQuota | null {
  if (!host) return null
  const identity = liveOAuthIdentity(host)
  const signedOut = lastLiveOAuth.has(host) && !identity
  const auth = conversationQuotaAuth(conversation, {
    signedIn: Boolean(identity),
    accountId: identity,
    plan: null,
    authKind: identity ? 'oauth' : 'none'
  })
  const windows = auth.signedIn ? conversationHostQuota(conversation) : []
  if (windows.length === 0 && !signedOut) return null
  return {
    host,
    hostName: displayNameForCliHost(host),
    signedIn: auth.signedIn,
    accountId: auth.accountId,
    plan: auth.plan,
    authKind: auth.authKind,
    windows
  }
}

async function loadHostAccountQuota(
  conversation: {
    id: string
    accountId?: string | null
    cliHost?: CliHostKind | null
    quotaWindows?: import('@shared/types').QuotaWindow[] | null
  },
  host: CliHostKind | null
): Promise<import('@shared/ipc').HostAccountQuota> {
  const account = await readHostAccountInfo(host)
  if (host) lastLiveOAuth.set(host, account.signedIn ? account.accountId : null)
  await quotaService.refreshForPanel(host)
  const auth = conversationQuotaAuth(conversation, account)
  return {
    host,
    hostName: host ? displayNameForCliHost(host) : 'VAV',
    signedIn: auth.signedIn,
    accountId: auth.accountId,
    plan: auth.plan,
    authKind: auth.authKind,
    windows: auth.signedIn ? conversationHostQuota(conversation) : []
  }
}

function retargetEmptyConversations(
  account: import('@shared/accounts').ProviderAccount,
  workspaceKey: string
): void {
  if (account.kind !== 'oauth') return
  const host = agentIdOf(account)
  let changed = false
  for (const conversation of conversationStore.all()) {
    if (conversation.cliHost !== host) continue
    if ((conversation.messages?.length ?? 0) > 0) continue
    if (workspaceKeyOf(conversation.workingDirectory) !== workspaceKey) continue
    if (conversation.accountId === account.id) continue
    conversationStore.updateMeta(conversation.id, { accountId: account.id })
    changed = true
  }
  if (changed) publishConversations()
}

function accountsPage(workspaceKey?: string | null): import('@shared/ipc').AccountsPagePayload {
  const untitled = t('accounts.workspaceDefault')
  const settings = settingsStore.get()
  const ctx = workspaceKey?.trim()
    ? {
        key: workspaceKey.trim(),
        label: workspaceKey.trim() === '__default__'
          ? untitled
          : workspaceKey.trim().split(/[\\/]/).filter(Boolean).at(-1) || untitled
      }
    : resolveWorkspaceContext(
        conversationStore.listMeta(),
        settings,
        untitled,
        lastSeenConversationId
      )
  accountStore.seedIfNeeded({
    workspaceKey: ctx.key,
    endpoint: settings.apiEndpoint || null,
    hasApiKey: secretStore.has('api')
  })
  accountStore.coalesceOAuthIdentities()
  const liveByHost = latestQuotaWindowsByHost(conversationStore.all())
  const liveOAuth = new Map(lastLiveOAuth)
  for (const host of ACCOUNT_QUOTA_HOSTS) {
    if (!liveOAuth.has(host)) {
      const identity = quotaService.identity(host)
      if (identity) liveOAuth.set(host, identity)
    }
  }
  const quotaFor = (host: CliHostKind) => namespacedQuotaFor(host, liveByHost.get(host))
  return {
    ...buildAccountsPage({
      workspaceKey: ctx.key,
      workspaceLabel: ctx.label,
      accounts: accountStore,
      secrets: secretStore,
      cliAgents: cliCatalogOf(settings),
      liveOAuth,
      quotaWindows: quotaFor,
      quotaState: (host, identity) => {
        const id = identity?.trim() || liveOAuthIdentity(host)
        const state = quotaService.getState(host, id)
        return {
          ...state,
          windows: mergeNamespacedQuotaWindows(
            host,
            id,
            quotaService.get(host, id),
            liveByHost.get(host)
          )
        }
      },
      apiBalance: (accountId) => {
        const row = cachedApiBalance(accountId)
        if (!row) return null
        return {
          source: row.source,
          amount: row.total,
          currency: row.currency,
          available: row.available
        }
      }
    }),
    oauthLogin: currentOAuthLogin()
  }
}

const ACCOUNTS_REFRESH_MS = 12_000

async function refreshAccountsPage(
  workspaceKey?: string | null,
  force = false
): Promise<import('@shared/ipc').AccountsPagePayload> {
  const page = accountsPage(workspaceKey)
  const work = (async () => {
    rememberLiveOAuth(
      await syncOAuthProfiles(page.workspaceKey, accountStore, {
        skipAgents: runningOAuthAgents(),
        secrets: secretStore
      })
    )
    accountStore.coalesceOAuthIdentities()
    const hosts = accountStore
      .listVisible(page.workspaceKey)
      .filter(
        (account) =>
          account.kind === 'oauth' &&
          (account.keyStatus === 'ok' || account.hasCredentialSnapshot)
      )
      .map((account) => account.oauthHost)
      .filter((host): host is NonNullable<typeof host> => Boolean(host) && hostMayHaveAccountQuota(host))
    await quotaService.refreshHosts(hosts, force)
    const keys = accountStore
      .listVisible(page.workspaceKey)
      .filter((account) => account.kind === 'vav_key')
    await Promise.all(
      keys.map((account) =>
        refreshApiBalance({
          accountId: account.id,
          apiKey: accountSecret(account, secretStore),
          endpoint: account.endpoint?.trim() || settingsStore.get().apiEndpoint,
          force
        })
      )
    )
  })()
  const settled = await raceSettle(work, ACCOUNTS_REFRESH_MS)
  if (settled.timedOut) {
    void work.then(() => pushAccountsIfSettingsOpen()).catch((err) => {
      console.error('[accounts] refresh continued after timeout', err)
    })
  }
  return accountsPage(page.workspaceKey)
}

function activeVavCredentials(): { apiKey: string | null; endpoint: string } {
  const latest = conversationStore.listMeta().find((row) => !row.archived && !row.cliHost)
  const resolved = resolveVavCredentials(
    {
      conversation: latest ?? null,
      settingsEndpoint: settingsStore.get().apiEndpoint
    },
    accountStore,
    secretStore
  )
  return { apiKey: resolved.apiKey, endpoint: resolved.endpoint }
}

function currentWorkspaceVavCredentials(): {
  apiKey: string | null
  endpoint: string
  accountId: string | null
} {
  const untitled = t('accounts.workspaceDefault')
  const ctx = resolveWorkspaceContext(
    conversationStore.listMeta(),
    settingsStore.get(),
    untitled,
    lastSeenConversationId
  )
  const resolved = resolveVavCredentials(
    {
      workspaceKey: ctx.key,
      settingsEndpoint: settingsStore.get().apiEndpoint
    },
    accountStore,
    secretStore
  )
  return { apiKey: resolved.apiKey, endpoint: resolved.endpoint, accountId: resolved.accountId }
}

function vavModelListOptions(force?: boolean): PreloadHostModelsOptions {
  const creds = currentWorkspaceVavCredentials()
  const vavAccounts: Record<string, { apiKey: string | null; endpoint: string; accountId: string }> = {}
  const allAccounts = accountStore.listAll()
  for (const account of allAccounts) {
    if (account.provider === 'vav' || agentIdOf(account) === 'vav') {
      const vendorId = vendorIdFromEndpoint(account.endpoint || settingsStore.get().apiEndpoint)
      if (vendorId && vendorId !== 'custom') {
        const accountId = account.id
        vavAccounts[accountId] = {
          apiKey: accountSecret(account, secretStore),
          endpoint: account.endpoint?.trim() || settingsStore.get().apiEndpoint,
          accountId
        }
      }
    }
  }

  return {
    force: force === true,
    apiKey: creds.apiKey,
    endpoint: creds.endpoint,
    vavAccounts
  }
}

async function validateAccountKey(
  endpoint: string,
  apiKey: string
): Promise<{ ok: boolean; authFailed: boolean; message: string }> {
  const probe = await validateVavApiKey(endpoint, apiKey)
  if (probe.ok) {
    return { ok: true, authFailed: false, message: t('api.validateOk') }
  }
  const error = probe.error || ''
  return {
    ok: false,
    authFailed: probe.authFailed,
    message: probe.authFailed
      ? t('api.validateUnauthorized', { error })
      : t('api.validateFailed', { error })
  }
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
    apiKeyPresent: Boolean(secretStore.has('api') || activeVavCredentials().apiKey),
    braveSearchKeyPresent: secretStore.has('braveSearch'),
    cloudflareApiTokenPresent: secretStore.has('cloudflare'),
    supabaseAccessTokenPresent: secretStore.has('supabase'),
    customSurfacePatternUrl,
    surfacePattern: settings.surfacePattern === 'custom' && !hasFile ? 'none' : settings.surfacePattern
  }
}

/** CFBundleVersion stand-in: YYYY.MMDD.patch from package version + calendar day. */
function appBuildNumber(): string {
  return formatAppBuildNumber(app.getVersion())
}

async function confirmRevealSecret(event: IpcMainInvokeEvent): Promise<boolean> {
  if (isE2eRuntime()) return true
  const parent = BrowserWindow.fromWebContents(event.sender)
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: [t('common.cancel'), t('secrets.revealConfirm')],
    defaultId: 0,
    cancelId: 0,
    message: t('secrets.revealTitle'),
    detail: t('secrets.revealDetail')
  }
  const result =
    parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts)
  return result.response === 1
}

function registerIpc(): void {
  installTrustedIpcGuard(ipcMain, isRendererUrl)
  registerHapticsIpc()
  screenshotController ??= createScreenshotController({ loadScreenshotRenderer })
  ipcMain.handle(IPC.filesPickAttachments, async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections']
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled) return { ok: false as const, cancelled: true }
    for (const p of result.filePaths) fileService.grantPath(p)
    return { ok: true as const, paths: result.filePaths }
  })
  ipcMain.handle(IPC.filesCaptureScreenshot, (event) => screenshotController!.start(event))
  ipcMain.on(IPC.screenshotReady, (event) => screenshotController?.ready(event))
  ipcMain.on(IPC.screenshotPainted, (event) => screenshotController?.painted(event))
  ipcMain.on(IPC.screenshotDismiss, () => screenshotController?.dismiss())
  ipcMain.on(IPC.screenshotFinish, (_event, payload) => screenshotController?.finish(payload))
  ipcMain.on(IPC.screenshotSetKey, (event, on: boolean) => screenshotController?.setKey(event, on))
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

  ipcMain.handle(IPC.bootstrap, (event): Bootstrap => {
    // Bootstrap must not force Keychain before onboarding unlock on macOS.
    const settings = currentSettings()
    setLocalePreference(settings.locale)
    const conversations = conversationStore.listMeta()
    const machineId = machineIdFromContents(event.sender)
    const activeConversationId =
      conversations.find(
        (c) => !c.archived && conversationOnMachine(c, machineId)
      )?.id ?? ''
    const { home, tmp } = homeTmpFor(machineId)
    const local = isLocalMachine(machineId)
    return {
      settings,
      resolvedLocale: currentLocale(),
      systemAccentColor: readSystemAccentColor(),
      conversations,
      activeConversationId,
      apiKeyHint: secretStore.maskedHint(),
      platform: PLATFORM,
      home: home || (local ? app.getPath('home') : ''),
      tmp: tmp || (local ? tmpdir() : ''),
      hosts: decorateHosts(hostRegistry.list()),
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
    if (
      patch.keepAwakeWhileAgentRunning !== undefined ||
      patch.keepAwakeBatteryFloorPercent !== undefined
    ) {
      syncSleepBlocker()
    }
    if (patch.remoteControlEnabled !== undefined) {
      remoteControl.applySettings()
      daemonAttach.applySettings()
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

  ipcMain.handle(IPC.settingsKeepAwakeStatus, () => currentKeepAwakeStatus())
  ipcMain.handle(IPC.settingsKeepAwakeGrant, async () => {
    if (!macLidSleep) return { ok: false as const, error: 'unsupported' }
    const result = await macLidSleep.grant(userInfo().username)
    macLidSleep.refresh()
    await syncSleepBlockerAsync()
    return result
  })
  ipcMain.handle(IPC.settingsKeepAwakeRevoke, async () => {
    if (!macLidSleep) return { ok: false as const, error: 'unsupported' }
    const result = await macLidSleep.revoke()
    await syncSleepBlockerAsync()
    return result
  })

  ipcMain.handle(IPC.settingsSetKey, (_event, key: string) => {
    secretStore.set(key, 'api')
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint('api') }
  })

  ipcMain.handle(IPC.settingsRevealKey, async (event) => {
    if (!(await confirmRevealSecret(event))) return null
    return secretStore.get('api')
  })
  ipcMain.handle(IPC.settingsKeyHint, () => secretStore.maskedHint('api'))

  ipcMain.handle(IPC.settingsSetBraveSearchKey, (_event, key: string) => {
    secretStore.set(key, 'braveSearch')
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint('braveSearch') }
  })
  ipcMain.handle(IPC.settingsBraveSearchKeyHint, () => secretStore.maskedHint('braveSearch'))

  ipcMain.handle(IPC.settingsSetTinyfishSearchKey, (_event, key: string) => {
    secretStore.set(key, 'tinyfish')
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint('tinyfish') }
  })
  ipcMain.handle(IPC.settingsTinyfishSearchKeyHint, () => secretStore.maskedHint('tinyfish'))

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
    return validateAccountKey(settings.apiEndpoint, effective)
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
    const path = result.canceled ? null : (result.filePaths[0] ?? null)
    if (path) fileService.grantPath(path)
    return path
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
  const vavAccounts = () => accountStore.listAll().filter(isVavProfile)

  const accountForBalanceHost = (hostKey: string) => {
    const rows = vavAccounts()
    if (hostKey === ANALYSIS_API_HOST) {
      return rows.find((row) => row.current) ?? rows[0] ?? null
    }
    const group = groupAccountsByVendor(rows).find((row) => row.vendor.id === hostKey)
    return group?.accounts.find((row) => row.current) ?? group?.accounts[0] ?? null
  }

  const lookupVendorApiBalance = async (hostKey: string, force: boolean) => {
    const account = accountForBalanceHost(hostKey)
    const endpoint =
      account?.endpoint?.trim() ||
      vendorById(hostKey)?.endpoint ||
      (hostKey === ANALYSIS_API_HOST ? settingsStore.get().apiEndpoint : '')
    const keyPresent = account
      ? accountHasKey(account, secretStore)
      : hostKey === ANALYSIS_API_HOST && analysisHasApiKey()
    const supported = hostCanShowApiBalance(hostKey) && Boolean(apiBalanceUrl(endpoint))
    if (!supported) return { supported: false, balance: null, keyPresent }
    if (!keyPresent) return { supported: true, balance: null, keyPresent: false }
    const apiKey = account ? accountSecret(account, secretStore) : secretStore.get('api')
    const balance = account
      ? await refreshApiBalance({
          accountId: account.id,
          apiKey,
          endpoint,
          force
        })
      : await fetchApiBalance({ apiKey, endpoint, force })
    return { supported: true, balance, keyPresent: true }
  }
  const analysisVendors = (): { id: string; name: string }[] =>
    groupAccountsByVendor(accountStore.listAll().filter(isVavProfile)).map((row) => ({
      id: row.vendor.id,
      name: row.vendor.name
    }))

  const analysisUsageOptions = (): {
    remapHost: (hostKey: string, accountId?: string | null) => string
    order: string[]
  } => {
    const vendors = analysisVendors()
    const fallbackVendor = vendors.length === 1 ? vendors[0]!.id : null
    return {
      order: settingsStore.get().providerListOrder ?? [],
      remapHost: (hostKey, accountId) => {
        if (hostKey !== ANALYSIS_API_HOST) return hostKey
        const account = accountId ? accountStore.get(accountId) : undefined
        if (account) return vendorIdFromEndpoint(account.endpoint)
        return fallbackVendor ?? hostKey
      }
    }
  }

  configureAnalysisCache({
    conversations: () => {
      conversationStore.hydrateMissingHostUsageAll()
      return conversationStore.all()
    },
    usageOptions: analysisUsageOptions,
    apiKeyPresent: analysisHasApiKey,
    readBalance: (force, hostKey) => lookupVendorApiBalance(hostKey, force),
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
        vendors: analysisVendors(),
        ...analysisUsageOptions(),
        apiKeyPresent: analysisHasApiKey(),
        forceRefresh: force,
        refreshQuotas: (forceRefresh) => quotaService.refreshAllHosts(forceRefresh),
        quotaWindows: (host) => quotaService.get(host),
        readAccount: (host) => readHostAccountInfo(host),
        hasApiKey: (hostKey) => {
          const account = accountForBalanceHost(hostKey)
          if (account) return accountHasKey(account, secretStore)
          return hostKey === ANALYSIS_API_HOST && analysisHasApiKey()
        },
        readApiBalance: (hostKey) => lookupVendorApiBalance(hostKey, force)
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

  ipcMain.handle(
    IPC.accountsGetPage,
    async (
      _event,
      workspaceKey?: string | null,
      options?: { refresh?: boolean; force?: boolean }
    ) => {
      if (options?.refresh) return refreshAccountsPage(workspaceKey, options.force === true)
      return accountsPage(workspaceKey)
    }
  )
  ipcMain.handle(
    IPC.accountsCreateVav,
    async (
      _event,
      input: {
        name: string
        endpoint: string
        apiKey: string
        agentId?: string
        provider?: 'vav' | 'custom'
      }
    ) => {
      const page = await accountsPage()
      const name = normalizeAccountName(input.name ?? '')
      const endpoint = (input.endpoint ?? '').trim()
      const apiKey = (input.apiKey ?? '').trim()
      const agentId = input.agentId?.trim() || 'vav'
      const provider = input.provider === 'custom' ? 'custom' : providerForAgent(agentId)
      if (!name) return Promise.reject(new Error(t('accounts.error.nameRequired')))
      if (nameConflict(accountStore.listAll(), agentId, name)) {
        return Promise.reject(new Error(t('accounts.error.nameTaken')))
      }
      if (!isHttpUrl(endpoint)) return Promise.reject(new Error(t('accounts.error.endpoint')))
      if (!apiKey) return Promise.reject(new Error(t('error.noApiKeyShort')))
      const check = await validateAccountKey(endpoint, apiKey)
      if (!check.ok) return Promise.reject(new Error(check.message))
      const created = accountStore.add({
        workspaceKey: DEFAULT_WORKSPACE_KEY,
        agentId,
        provider,
        kind: 'vav_key',
        name,
        endpoint,
        usesLegacyApiKey: false,
        lastUsedAt: null,
        lastModel: null,
        keyStatus: 'ok',
        oauthHost: null
      })
      secretStore.setAccountKey(created.id, apiKey)
      return accountsPage(page.workspaceKey)
    }
  )
  ipcMain.handle(
    IPC.accountsCreateDraft,
    async (
      _event,
      input: { agentId: string; kind?: 'vav_key' | 'oauth'; endpoint?: string }
    ) => {
      const page = await accountsPage()
      const agentId = input.agentId?.trim() || 'vav'
      const kind = input.kind === 'oauth' ? 'oauth' : 'vav_key'
      if (kind === 'oauth' && createKindForAgent(agentId) !== 'oauth') {
        return Promise.reject(new Error(t('accounts.error.missing')))
      }
      const name = nextDraftName(
        accountStore.listAll(),
        agentId,
        t('accounts.draftName')
      )
      const endpoint =
        kind === 'vav_key'
          ? input.endpoint !== undefined
            ? input.endpoint.trim() || null
            : defaultKeyEndpoint(agentId, settingsStore.get().apiEndpoint || '')
          : null
      const created = accountStore.add({
        workspaceKey: DEFAULT_WORKSPACE_KEY,
        agentId,
        provider: providerForAgent(agentId),
        kind,
        name,
        endpoint: endpoint || null,
        usesLegacyApiKey: false,
        lastUsedAt: null,
        lastModel: null,
        keyStatus: 'unknown',
        oauthHost: kind === 'oauth' ? agentId : null
      })
      return { page: await accountsPage(page.workspaceKey), id: created.id }
    }
  )
  ipcMain.handle(
    IPC.accountsUpdateVav,
    async (
      _event,
      id: string,
      patch: { alias?: string | null; endpoint?: string; apiKey?: string }
    ) => {
      const account = accountStore.get(id)
      if (!account) {
        return Promise.reject(new Error(t('accounts.error.missing')))
      }
      if (patch.alias !== undefined) {
        const alias = patch.alias == null ? '' : normalizeAccountName(patch.alias)
        accountStore.update(id, { alias: alias || null })
      }
      if (account.kind !== 'vav_key' && (patch.endpoint != null || patch.apiKey != null)) {
        return Promise.reject(new Error(t('accounts.error.missing')))
      }
      if (patch.endpoint != null) {
        const endpoint = patch.endpoint.trim()
        if (!isHttpUrl(endpoint)) return Promise.reject(new Error(t('accounts.error.endpoint')))
        accountStore.update(id, { endpoint })
      }
      if (patch.apiKey != null) {
        const key = patch.apiKey.trim()
        if (!key) return Promise.reject(new Error(t('error.noApiKeyShort')))
        secretStore.setAccountKey(id, key)
        accountStore.update(id, { usesLegacyApiKey: false, keyStatus: 'unknown' })
      }
      broadcast(IPC.settingsChanged, currentSettings())
      return accountsPage(account.workspaceKey)
    }
  )
  ipcMain.handle(IPC.accountsSetCurrent, (_event, id: string) => {
    const viewing = accountsPage().workspaceKey
    const account = accountStore.setCurrent(id, viewing)
    if (account) retargetEmptyConversations(account, viewing)
    broadcast(IPC.settingsChanged, currentSettings())
    return accountsPage(viewing)
  })
  ipcMain.handle(IPC.accountsActivate, async (_event, id: string) => {
    const viewing = accountsPage().workspaceKey
    const result = await activateAccount({
      accountId: id,
      accounts: accountStore,
      secrets: secretStore
    })
    if (result.kind === 'switched' || result.kind === 'alreadyLive') {
      const account = accountStore.setCurrent(id, viewing)
      if (account) retargetEmptyConversations(account, viewing)
      const live = accountStore.get(id)
      const host = live?.oauthHost ?? (live ? agentIdOf(live) : null)
      if (host && live) lastLiveOAuth.set(host, live.name)
      clearHostAuthIdentityCache()
      if (host && hostMayHaveAccountQuota(host)) {
        void quotaService.refreshHosts([host], true)
      }
    }
    broadcast(IPC.settingsChanged, currentSettings())
    return { page: accountsPage(viewing), result }
  })
  ipcMain.handle(IPC.accountsRemove, (_event, id: string) => {
    const result = accountStore.remove(id)
    if (result) {
      secretStore.clearAccountKey(id)
      secretStore.clearOAuthSnapshot(id)
      clearApiBalance(id)
    }
    broadcast(IPC.settingsChanged, currentSettings())
    return accountsPage(result?.removed.workspaceKey)
  })
  ipcMain.handle(IPC.accountsVerify, async (_event, id: string, apiKey?: string) => {
    const account = accountStore.get(id)
    if (!account || account.kind !== 'vav_key') {
      return { ok: false, message: t('accounts.error.missing') }
    }
    const key = apiKey?.trim() || accountSecret(account, secretStore)
    const endpoint = account.endpoint?.trim() || settingsStore.get().apiEndpoint
    if (!key) return { ok: false, message: t('error.noApiKeyShort') }
    const result = await validateAccountKey(endpoint, key)
    accountStore.setKeyStatus(id, result.ok ? 'ok' : result.authFailed ? 'invalid' : 'unknown')
    return { ok: result.ok, message: result.message, authFailed: result.authFailed }
  })
  ipcMain.handle(IPC.accountsRevealKey, async (event, id: string) => {
    if (!(await confirmRevealSecret(event))) return null
    const account = accountStore.get(id)
    if (!account || account.kind !== 'vav_key') return null
    if (account.usesLegacyApiKey) return secretStore.get('api')
    return secretStore.getAccountKey(id)
  })
  ipcMain.handle(IPC.accountsBeginOAuth, async (_event, agentId: string, accountId?: string) => {
    const host = agentId.trim()
    const name = DEFAULT_CLI_AGENTS.find((agent) => agent.id === host)?.name ?? host
    if (!isStructuredCliHost(host) || createKindForAgent(host) !== 'oauth' || !loginArgv(host)) {
      return Promise.reject(new Error(t('accounts.error.missing')))
    }
    const agent = settingsStore.get().cliAgents?.find((row) => row.id === host)
    const resolved = resolveAgentExecutable(candidatesForHost(host, agent))
    if (!resolved) {
      return Promise.reject(new Error(t('accounts.error.cliMissing', { name })))
    }
    const targetId = typeof accountId === 'string' && accountId.trim() ? accountId.trim() : undefined
    try {
      const live = await readHostAccountInfo(host)
      if (live.signedIn) {
        const email = live.accountId?.trim()
        if (email) {
          accountStore.upsertOAuth({
            workspaceKey: accountsPage().workspaceKey,
            agentId: host,
            provider: providerForAgent(host),
            name: email,
            oauthHost: host,
            signedIn: true
          })
        }
        await captureLiveHost(host, email ?? null, accountStore, secretStore)
      }
    } catch {
      // Still start OAuth — an empty or unreadable slot just means nothing to keep.
    }
    startHostOAuthLogin({
      agentId: host,
      accountId: targetId,
      resolved,
      onFinished: (result) => {
        void (async () => {
          clearHostAuthIdentityCache()
          if (result.cancelled) return
          if (result.exitCode !== 0) {
            finishHostOAuth(host, 'error', t('accounts.oauthFailedBody'))
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 400))
          try {
            const info = await readHostAccountInfo(host)
            if (!info.signedIn && !info.accountId) {
              finishHostOAuth(host, 'error', t('accounts.oauthFailedBody'))
              return
            }
            const page = accountsPage()
            const email = info.accountId?.trim() || name
            const saved = accountStore.upsertOAuth({
              id: targetId,
              workspaceKey: page.workspaceKey,
              agentId: host,
              provider: providerForAgent(host),
              name: email,
              oauthHost: host,
              signedIn: info.signedIn
            })
            if (info.signedIn) {
              await captureAccountCredentials(saved.id, accountStore, secretStore)
            }
            lastLiveOAuth.set(host, info.signedIn ? email : null)
            finishHostOAuth(host, 'ok')
            void quotaService.refreshForPanel(host)
          } catch {
            finishHostOAuth(host, 'error', t('accounts.oauthFailedBody'))
          }
        })()
      }
    })
    return accountsPage()
  })
  ipcMain.handle(IPC.accountsCancelOAuth, async (_event, agentId: string) => {
    cancelHostOAuthLogin(String(agentId ?? '').trim())
    return accountsPage()
  })
  ipcMain.handle(IPC.accountsSignOut, async (_event, agentId: string) => {
    const host = agentId.trim()
    if (!isStructuredCliHost(host) || !isOAuthSyncAgent(host)) {
      return Promise.reject(new Error(t('accounts.error.missing')))
    }
    const agent = settingsStore.get().cliAgents?.find((row) => row.id === host)
    const resolved = resolveAgentExecutable(candidatesForHost(host, agent))
    if (resolved) {
      try {
        await runHostLogout(resolved, host)
      } catch {
        // Still drop the local signed-in mark.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    clearHostAuthIdentityCache()
    accountStore.applyLiveOAuth(host, null, false)
    lastLiveOAuth.set(host, null)
    return accountsPage()
  })

  // --- conversations ---
  ipcMain.handle(IPC.convList, () => conversationStore.listMeta())
  ipcMain.handle(IPC.convGet, (_event, id: string) => {
    if (conversationStore.hydrateMissingHostUsage(id)) publishConversations()
    return conversationStore.get(id) ?? null
  })

  ipcMain.handle(
    IPC.convCreate,
    async (
      _event,
      options?: {
        workingDirectory?: string | null
        model?: string
        swarmParentId?: string | null
        machineId?: string | null
      }
    ): Promise<ConversationMeta> => {
      const machineId = options?.machineId ?? LOCAL_MACHINE_ID
      const workdir =
        options && 'workingDirectory' in options
          ? (options.workingDirectory ?? null)
          : await resolveNewWorkdirOn(machineId)
      const settings = settingsStore.get()
      const model = options?.model?.trim() || undefined
      if (workdir) {
        rememberWorkdir(workdir, machineId)
        broadcast(IPC.settingsChanged, currentSettings())
      }
      const defaultHost = resolveDefaultChatHost(settings.defaultAgentId)
      const conversation = conversationStore.create(
        workdir,
        modelForNewConversation(defaultHost, model),
        {
          approvalMode: settings.defaultApprovalMode ?? 'auto',
          thinkingLevel: parseThinkingLevel(settings.defaultThinkingLevel),
          cliHost: defaultHost,
          accountId: accountIdForSession(workdir, defaultHost),
          swarmParentId: options?.swarmParentId ?? null,
          machineId
        }
      )
      if (defaultHost) promoteEphemeralConversation(conversation.id)
      lastSeenConversationId = conversation.id
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
    if (cliHost.owns(id)) cliHost.applyThinkingLevel(id)
    publishConversations()
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convSetFast, (_event, id: string, fast: boolean) => {
    conversationStore.setFast(id, fast === true)
    if (cliHost.owns(id)) cliHost.applyFast(id)
    publishConversations()
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convSetAcpMode, (_event, id: string, modeId: string) => {
    if (typeof modeId === 'string' && modeId.trim()) {
      cliHost.applySessionMode(id, modeId.trim())
      publishConversations()
    }
    return conversationStore.listMeta()
  })

  ipcMain.handle(
    IPC.convSetAcpConfig,
    (_event, id: string, configId: string, value: string | boolean) => {
      if (typeof configId === 'string' && configId.trim()) {
        cliHost.applySessionConfig(id, configId.trim(), value)
        publishConversations()
      }
      return conversationStore.listMeta()
    }
  )

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
    const conversation = conversationStore.get(id)
    const host = (conversation?.cliHost ?? null) as CliHostKind | null
    const creds = resolveVavCredentials(
      { conversation, settingsEndpoint: settingsStore.get().apiEndpoint },
      accountStore,
      secretStore
    )
    const vendorId = host == null ? vendorIdFromEndpoint(creds.endpoint) : null
    conversationStore.updateMeta(id, {
      model,
      tokenLimit: contextWindowForModel(host, model, undefined, vendorId, creds.accountId)
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
    IPC.convSetSwarmLayout,
    (_event, id: string, layout: unknown, full?: unknown) => {
      const patch: { swarmLayout: ReturnType<typeof sanitizeSwarmLayout>; swarmLayoutFull?: ReturnType<typeof sanitizeSwarmLayout> } =
        { swarmLayout: sanitizeSwarmLayout(layout) }
      if (full !== undefined) patch.swarmLayoutFull = sanitizeSwarmLayout(full)
      conversationStore.updateMeta(id, patch)
      publishConversations()
      return conversationStore.listMeta()
    }
  )

  ipcMain.handle(
    IPC.convSetCliHost,
    (_event, id: string, host: string | null, accountId?: string | null) => {
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
        conversationStore.updateMeta(id, {
          accountId: accountId ?? accountIdForSession(prev?.workingDirectory ?? null, nextHost)
        })
        swarmSession.syncHostCursor(id, nextHost)
        // Empty buckets keep the previous host's model string — coerce so the
        // picker / context-window panel do not show a foreign VAV preset.
        coerceConversationModel(id)
      } else {
        const update: Partial<ConversationMeta> = {
          cliHost: nextHost,
          agentBinaryName: nextHost
        }
        if (accountId !== undefined) update.accountId = accountId
        conversationStore.updateMeta(id, update)
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
    const cached = peekHostAccountQuota(conversation, host)
    if (cached) {
      void loadHostAccountQuota(conversation, host).catch((err) => {
        console.error('[account-quota] background refresh failed', err)
      })
      return cached
    }
    return loadHostAccountQuota(conversation, host)
  })

  ipcMain.handle(IPC.convSetWorkdir, (_event, id: string, path: string, machineId?: string | null) =>
    applyWorkingDirectory(id, path, machineId)
  )

  ipcMain.handle(IPC.convPickWorkdir, async (_event, id: string) => {
    const conversation = conversationStore.get(id)
    if (conversation && !isLocalMachine(conversation.machineId)) return null
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    fileService.grantPath(result.filePaths[0])
    return applyWorkingDirectory(id, result.filePaths[0], conversation?.machineId)
  })

  ipcMain.handle(IPC.convUseTempWorkdir, async (_event, id: string) => {
    const machineId = conversationStore.get(id)?.machineId
    return applyWorkingDirectory(id, await mintTempWorkdirOn(machineId), machineId)
  })

  ipcMain.handle(
    IPC.convLocateWorkspace,
    async (_event, id: string, destinationDir: string, name: string) => {
      const conversation = conversationStore.get(id)
      if (!conversation?.workingDirectory) {
        return { ok: false as const, error: t('error.locateNoTemp') }
      }
      const source = conversation.workingDirectory
      const machineId = conversation.machineId
      const host = hostRegistry.hostFor(machineId)
      const safeName = name.trim().replace(/[\\/]/g, '-') || 'workspace'
      const target = joinHostPath(host.info.platform, destinationDir, safeName)
      try {
        if (isLocalMachine(machineId)) {
          if (existsSync(target)) {
            return { ok: false as const, error: t('error.locateExists', { target }) }
          }
          mkdirSync(destinationDir, { recursive: true })
          renameSync(source, target)
          try {
            rmdirSync(dirname(source))
            rmdirSync(dirname(dirname(source)))
          } catch {
            // leave leftover empty dirs
          }
        } else {
          if (!host.info.online) {
            return { ok: false as const, error: `${host.info.name} is offline` }
          }
          if (await host.fs.exists(target)) {
            return { ok: false as const, error: t('error.locateExists', { target }) }
          }
          await host.fs.mkdir(destinationDir, { recursive: true })
          await host.fs.rename(source, target)
        }
        return { ok: true as const, conversations: applyWorkingDirectory(id, target, machineId) }
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : t('error.locateFailed')
        }
      }
    }
  )

  ipcMain.handle(IPC.convDeleteMessage, (_event, id: string, messageId: string) => {
    const conversation = conversationStore.deleteMessage(id, messageId)
    if (!conversation) return null
    if (isStructuredCliHost(conversation.cliHost)) {
      cliHost.invalidateResume(id)
    }
    conversationStore.flush()
    publishConversations()
    return {
      conversations: conversationStore.listMeta(),
      messages: conversation.messages,
      activeLeafId: conversation.activeLeafId ?? null
    }
  })

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

  ipcMain.handle(IPC.convReveal, async (event, path: string) => {
    await revealOnMachine(machineIdForShell(event, String(path || '')), String(path || ''))
  })

  ipcMain.handle(IPC.convCopy, (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle(IPC.convClipboardRead, () => clipboard.readText())

  ipcMain.handle(IPC.convClipboardReadImage, () => {
    try {
      const image = clipboard.readImage()
      if (image.isEmpty()) return { ok: false as const, error: 'empty' }
      const bytes = image.toPNG()
      const written = writeClipBytes({ filename: 'paste.png', bytes })
      if (!written.ok) return written
      return { ok: true as const, path: written.path, bytes: bytes.length }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle(IPC.convCopyImage, (_event, base64Png: string) => {
    try {
      const raw = typeof base64Png === 'string' ? base64Png.trim() : ''
      if (!raw) return { ok: false as const, error: 'empty image' }
      // Accept accidental data-URL prefix from callers.
      const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
      return writePngToClipboard(Buffer.from(b64, 'base64'))
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
    (_event, path: string, sort: FileSortKey, ascending: boolean, conversationId?: string) =>
      fileService.listDirectory(path, sort, ascending, conversationId)
  )
  ipcMain.handle(IPC.filesRead, (_event, path: string, conversationId?: string) =>
    fileService.readTextFile(path, conversationId)
  )
  ipcMain.handle(
    IPC.filesReadTextWindow,
    (
      _event,
      path: string,
      opts?: { startByte?: number; maxBytes?: number; force?: boolean; conversationId?: string }
    ) => fileService.readTextWindow(path, opts)
  )
  ipcMain.handle(IPC.filesReadBinary, (_event, path: string, conversationId?: string) =>
    fileService.readBinary(path, conversationId)
  )
  ipcMain.handle(
    IPC.filesReadBinaryWindow,
    (
      _event,
      path: string,
      opts?: { startByte?: number; maxBytes?: number; conversationId?: string }
    ) => fileService.readBinaryWindow(path, opts)
  )
  ipcMain.handle(
    IPC.filesWriteBinary,
    (_event, path: string, base64: string, conversationId?: string) =>
      fileService.writeBinary(path, base64, conversationId)
  )
  ipcMain.handle(
    IPC.filesWriteClip,
    (
      _event,
      input: { filename: string; base64?: string; text?: string }
    ) => writeClip(input)
  )
  ipcMain.handle(IPC.filesCopyImage, (_event, path: string) => {
    try {
      if (typeof path !== 'string' || !isClipPath(path)) {
        return { ok: false as const, error: 'not a clip' }
      }
      return writePngToClipboard(readFileSync(path))
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
  ipcMain.handle(IPC.filesWrite, (_event, path: string, content: string, conversationId?: string) =>
    fileService.writeTextFile(path, content, conversationId)
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
  ipcMain.handle(IPC.filesQuickLook, async (event, path: string) => {
    await previewOnMachine(machineIdForShell(event, String(path || '')), String(path || ''))
  })
  ipcMain.handle(IPC.filesOpenWithDefault, async (event, path: string) =>
    openOnMachine(machineIdForShell(event, String(path || '')), String(path || ''))
  )
  registerVcsIpc(ipcMain, {
    cloudflare: () => ({
      token: secretStore.get('cloudflare') ?? null,
      accountId: settingsStore.get().cloudflareAccountId || null
    }),
    supabase: () => ({
      token: secretStore.get('supabase') ?? null,
      projectRef: settingsStore.get().supabaseProjectRef || null
    })
  })
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
      opts?: { maxBlocks?: number; maxRows?: number; conversationId?: string }
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
      fileService.grantPath(result.filePath)
      const written = await fileService.writeTextFile(result.filePath, content)
      if (!written.ok) return { ok: false, error: written.error }
      return { ok: true, path: result.filePath }
    }
  )
  ipcMain.handle(IPC.filesRename, (_event, path: string, newName: string, conversationId?: string) =>
    fileService.rename(path, newName, conversationId)
  )
  ipcMain.handle(IPC.filesTrash, (_event, paths: string[], conversationId?: string) =>
    fileService.trash(paths, conversationId)
  )
  ipcMain.handle(
    IPC.filesInspect,
    (_event, path: string, conversationId?: string) =>
      (conversationId ? null : takePreloadedInspect(path)) ??
      fileService.inspect(path, conversationId)
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
    async (_event, items: unknown, force?: boolean, machineId?: string) => {
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
      if (machineId && !isLocalMachine(machineId)) {
        if (force === true) await daemonAttach.probeProviders(machineId)
        const found = daemonAttach.providersOf(machineId)
        const byId = new Map(found.map((row) => [row.id, row.path]))
        const out: Record<string, string | null> = {}
        for (const spec of specs) {
          out[spec.id] = byId.get(spec.id) ?? daemonAttach.whichCached(machineId, spec.candidates)
        }
        return out
      }
      return probeAgentExecutables(specs, { force: force === true })
    }
  )

  ipcMain.handle(
    IPC.agentsListModels,
    (_event, host: string | null, force?: boolean) =>
      listHostModels(host, settingsStore, vavModelListOptions(force))
  )

  ipcMain.handle(IPC.agentsGetModelCatalog, () => {
    const snap = getModelCatalogSnapshot()
    if (Object.keys(snap).length > 0) return snap
    return seedModelCatalog(settingsStore, vavModelListOptions())
  })

  ipcMain.handle(IPC.agentsPreloadModels, async (_event, force?: boolean) => {
    const catalog = await preloadHostModels(settingsStore, {
      ...vavModelListOptions(force),
      prefer: preferredModelHosts(),
      onProgress: publishModelCatalog
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
    openSettingsWindow(view ?? 'appearance', typeof agentId === 'string' ? agentId : undefined)
  )
  ipcMain.handle(IPC.settingsDesiredView, () => settingsDesiredView)
  ipcMain.handle(IPC.windowCloseSettings, () => hideSettingsWindow())
  ipcMain.handle(IPC.windowOpenConnect, () => openConnectWindow())
  ipcMain.handle(IPC.windowCloseConnect, () => hideConnectWindow())
  ipcMain.handle(IPC.windowFitConnect, (_event, height: unknown) => {
    if (typeof height !== 'number' || !Number.isFinite(height)) return
    fitConnectWindow(height)
  })

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
  ipcMain.handle(IPC.remoteControlStatus, () => remoteControl.status())
  ipcMain.handle(IPC.remoteControlRegenerateSecret, () => remoteControl.regenerateSecret())
  ipcMain.handle(IPC.remoteControlResetIdentity, () => remoteControl.resetIdentity())
  ipcMain.handle(IPC.hostsList, () => decorateHosts(hostRegistry.list()))
  ipcMain.handle(IPC.hostsPairing, () => daemonAttach.pairing())
  ipcMain.handle(IPC.hostsPair, async (_event, payload: string) => {
    const result = await daemonAttach.pair(String(payload || ''))
    if (result.ok) await showHostWindow(result.host.id)
    return result
  })
  ipcMain.handle(IPC.hostsPairLan, async (_event, peer: HostDiscoveryPeer) => {
    const result = await daemonAttach.pairLan({
      address: String(peer?.address || ''),
      port: Number(peer?.port) || 0,
      name: typeof peer?.name === 'string' ? peer.name : undefined,
      machineId: typeof peer?.machineId === 'string' ? peer.machineId : undefined
    })
    if (result.ok) await showHostWindow(result.host.id)
    return result
  })
  ipcMain.handle(IPC.hostsCancelPair, () => {
    daemonAttach.cancelPair()
  })
  ipcMain.on(IPC.hostsCancelPair, () => {
    daemonAttach.cancelPair()
  })
  ipcMain.handle(IPC.hostsForget, (_event, machineId: string) => {
    const id = String(machineId || '')
    daemonAttach.forget(id)
    closeHostWindow(id)
    if (settingsStore.get().defaultMachineId === id) applyDefaultMachine(LOCAL_MACHINE_ID)
  })
  ipcMain.handle(IPC.hostsDiscovered, () => daemonAttach.listDiscovered())
  ipcMain.handle(IPC.hostsHome, (_event, machineId: string) => {
    if (isLocalMachine(machineId)) return homedir()
    return daemonAttach.homeOf(machineId)
  })
  ipcMain.handle(IPC.hostsShow, (_event, machineId: string) => {
    void showHostWindow(machineId)
  })
  ipcMain.handle(IPC.hostsOpenFolder, async (_event, machineId: string) => {
    const id = normalizeMachineId(machineId)
    await showHostWindow(id)
    const win = hostWindowOf(id)
    if (win && !win.isDestroyed()) safeSend(win.webContents, IPC.hostsPickFolder, id)
  })
  ipcMain.handle(IPC.hostsProbeProviders, async (_event, machineId: string) => {
    const id = String(machineId || '')
    if (!id || isLocalMachine(id)) return []
    const found = await daemonAttach.probeProviders(id)
    broadcast(IPC.hostsChanged, decorateHosts(hostRegistry.list()))
    return found
  })
  ipcMain.handle(IPC.hostsListDir, async (_event, machineId: string, path: string) => {
    const host = hostRegistry.get(normalizeMachineId(machineId)) ?? hostRegistry.hostFor(machineId)
    if (!host.info.online) {
      return { path, entries: [], truncated: 0, error: `${host.info.name} is offline` }
    }
    try {
      const dirents = await host.fs.readdir(path)
      const entries = dirents
        .filter((d) => d.isDirectory())
        .map((d) => ({
          name: d.name,
          path: joinHostPath(host.info.platform, path, d.name),
          isDirectory: true,
          size: 0,
          modifiedAt: 0,
          createdAt: 0
        }))
      return { path, entries, truncated: 0 }
    } catch (err) {
      return { path, entries: [], truncated: 0, error: (err as Error).message }
    }
  })
  ipcMain.on(IPC.notificationsSeen, (event, conversationId: unknown) => {
    const id = typeof conversationId === 'string' ? conversationId.trim() : ''
    if (!id) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return
    notifications.noteConversationView(window.id, id)
    lastSeenConversationId = id
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
      if (isE2eRuntime()) return e2ePopupMenu(items)
      const window = BrowserWindow.fromWebContents(event.sender)
      return window ? popupNativeMenu(window, items, position) : null
    }
  )
  ipcMain.handle(IPC.windowClosePopupMenu, () => {
    if (isE2eRuntime()) {
      e2eDismissPopupMenu()
      return
    }
    closeActiveNativePopup()
  })
  ipcMain.handle(IPC.windowE2ePeekMenu, () => e2ePeekPopupMenu())
  ipcMain.handle(IPC.windowE2eChooseMenu, (_event, idOrLabel: string) =>
    typeof idOrLabel === 'string' ? e2eChoosePopupMenu(idOrLabel) : false
  )
  ipcMain.handle(IPC.windowE2eDismissMenu, () => e2eDismissPopupMenu())

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
        daemonAttach.dispose()
        remoteControl.dispose()
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
  const userMsg: ChatMessage = {
    id: randomUUID(),
    parentId: null,
    role: 'user',
    content: 'Please update the smoke files.',
    blocks: [{ kind: 'text', text: 'Please update the smoke files.' }],
    createdAt: Date.now()
  }
  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    parentId: userMsg.id,
    role: 'assistant',
    content: 'Updated two files.',
    blocks: [{ kind: 'text', text: 'Updated two files.' }],
    createdAt: Date.now() + 1,
    changeSetId: set.id
  }
  conversationStore.appendMessage(meta.id, userMsg)
  conversationStore.appendMessage(meta.id, assistantMsg)
  conversationStore.flush()
  handleAgentEvent({ type: 'user', conversationId: meta.id, message: userMsg })
  handleAgentEvent({
    type: 'end',
    conversationId: meta.id,
    message: assistantMsg,
    tokensUsed: 0
  })
  handleAgentEvent({
    type: 'change-review',
    conversationId: meta.id,
    changeSetId: set.id,
    pendingCount: set.files.length,
    changeSet: set,
    messageId: assistantMsg.id
  })
  console.log('[smoke] seeded change review', set.id, 'conv', meta.id)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const singleInstance = isE2eRuntime() || app.requestSingleInstanceLock()
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
    macLidSleep?.stop()
    daemonAttach.dispose()
    remoteControl.dispose()
    agent.disposeAll()
    cliHost.disposeAll()
    stopAllAgentInstalls()
    ptyManager.killAll()
    fileService.disposeAll()
    quotaService.stop()
    conversationStore.flush()
    settingsStore.flushPersist()
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.whenReady().then(async () => {
    applyBranding()
    // Login PATH via zsh -ilc is ~1s; start it now so spawn never pays it sync.
    void ensureLoginPath()
    if (macLidSleep) {
      macLidSleep.onChange = () => {
        void publishKeepAwakeStatus()
      }
      macLidSleep.start()
      const onPowerChange = (): void => {
        macLidSleep.refresh()
        syncSleepBlocker()
      }
      powerMonitor.on('on-ac', onPowerChange)
      powerMonitor.on('on-battery', onPowerChange)
      powerMonitor.on('resume', onPowerChange)
    }
    protocol.handle('vav-local', async (request) => {
      try {
        const url = new URL(request.url)
        const pathParam = url.searchParams.get('path')
        if (!pathParam) {
          return new Response('Not found', { status: 404 })
        }
        // searchParams.get already decodes percent escapes. decodeURIComponent is redundant
        // and throws if the path contains a literal % (e.g. in a hash or filename).
        const requested = pathParam
        // Document sandbox: preview must read the working copy when one exists.
        const mapped = workingCopyService.ioPath(requested)
        const filePath = existsSync(mapped) ? mapped : requested
        if (!fileService.isAllowedPath(requested) && !fileService.isAllowedPath(filePath)) {
          return new Response('Forbidden', { status: 403 })
        }
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
    fileSessionStore.bind(conversationStore, {
      accountIdFor: (workdir) => accountIdForSession(workdir, null)
    })
    applyTheme(settings.theme ?? DEFAULT_SETTINGS.theme)
    nativeTheme.on('updated', repaintChrome)
    watchSystemAccentColor()
    registerGlobalHotkey(settings.globalHotkey)
    registerIpc()
    notifications.applySettings()
    remoteControl.applySettings()
    daemonAttach.applySettings()
    daemonAttach.restore()
    rebuildAppChrome()
    if (!process.env.VAV_SNAPSHOT) {
      quotaService.start()
      void (async () => {
        try {
          const untitled = t('accounts.workspaceDefault')
          const ctx = resolveWorkspaceContext(
            conversationStore.listMeta(),
            settingsStore.get(),
            untitled,
            lastSeenConversationId
          )
          rememberLiveOAuth(await syncOAuthProfiles(ctx.key, accountStore, { secrets: secretStore }))
        } catch (err) {
          console.error('[accounts] startup sync failed', err)
        }
      })()
    }
    if (!process.env.VAV_SNAPSHOT) {
      void warmAgentLaunchCache(settingsStore.get()).catch((err) => {
        console.warn('[agent-launch] warm failed', err)
      })
    }

    if (process.env.VAV_SNAPSHOT) {
      // Marketing captures should use default layout (tools open, files segment).
      await session.defaultSession.clearStorageData({ storages: ['localstorage'] })
    }

    const snapshotting = Boolean(process.env.VAV_SNAPSHOT)
    const cliOpen = argvRequestsCliOpen(process.argv)
    const argvOpens =
      snapshotting || cliOpen || isE2eRuntime() ? [] : parseOpenPathsFromArgv(process.argv)
    // Finder "Open With" / Dock drop cold start: the file the user asked for
    // goes up first. Booting the much heavier main shell ahead of it costs a
    // second of contended CPU and raises a window nobody asked for.
    let previewColdOpen =
      !snapshotting &&
      !cliOpen &&
      !isE2eRuntime() &&
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
      if (process.env.VAV_SMOKE_SEED === '1' || process.env.VAV_E2E_SEED_REVIEW === '1') {
        void seedSmokeChangeReview()
      }
      // Companion warm order: session first (global ⌘⇧↵ is latency-critical),
      // then token / preview / settings. A short delay lets the main shell paint
      // once so the hidden session boot does not contend on first frame.
      // E2E skips this — extra BrowserWindows make firstWindow() / focus flake.
      if (!isE2eRuntime()) {
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
      }
      // Seed static catalogues immediately, then live-probe in the background.
      try {
        publishModelCatalog(seedModelCatalog(settingsStore, vavModelListOptions()))
      } catch {
        // non-fatal
      }
      setTimeout(() => {
        void preloadHostModels(settingsStore, {
          prefer: preferredModelHosts(),
          onProgress: publishModelCatalog,
          ...vavModelListOptions()
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
    if (IS_MAC && !isE2eRuntime()) {
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
