import {
  app,
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
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { APP_NAME, applyBranding, applyDockIcon, loadAppIcon, pinUserDataPath } from './brand'
import {
  IPC,
  type Bootstrap,
  type MenuCommand,
  type NativeMenuItem,
  type SettingsView,
  type TokenUsageViewPayload
} from '@shared/ipc'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ConversationMeta,
  type FileSortKey,
  type ShellKind,
  type TurnEvent
} from '@shared/types'
import { compactionForLeaf } from '@shared/compaction'
import { threadPath } from '@shared/thread'
import { SettingsStore } from './store/SettingsStore'
import { SecretStore } from './store/SecretStore'
import { ConversationStore } from './store/ConversationStore'
import { VavPackService } from './store/VavPackService'
import { FileSessionStore } from './store/FileSessionStore'
import { FileService } from './fs/FileService'
import { FileAssociationService, formatIdForPath } from './fs/FileAssociationService'
import { DocumentRetrievalService } from './retrieval/DocumentRetrievalService'
import { DuckDbService } from './fs/DuckDbService'
import { WebSearchService } from './web/WebSearchService'
import { WebFetchService } from './web/WebFetchService'
import { ChangeSetStore } from './agent/ChangeSetStore'
import { UpdateService } from './updates'
import { PtyManager } from './terminal/PtyManager'
import { resolveAgentExecutable } from './terminal/loginPath'
import { menuCommandFromInput } from './menuShortcuts'
import { AgentRuntime } from './agent/AgentRuntime'
import { SkillService } from './agent/SkillService'
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
import { NotificationCenter } from './notifications'

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
/** At most one standalone window per conversation (sidebar spec, 双击). */
const detachedWindows = new Map<string, BrowserWindow>()
/** At most one preview window per absolute file path. */
const previewWindows = new Map<string, BrowserWindow>()
/**
 * Conversations minted by ⌘⇧↵. Closing one that never got a message deletes
 * it, so the quick-ask shortcut cannot litter the sidebar with empty shells.
 */
const ephemeralConversations = new Set<string>()
let quitting = false

const settingsStore = new SettingsStore()
const secretStore = new SecretStore()
const conversationStore = new ConversationStore()
// resolveNewWorkdir is a function declaration below (hoisted) — mint Temporary Workspaces on import.
const vavPackService = new VavPackService(conversationStore, () => resolveNewWorkdir())
const fileSessionStore = new FileSessionStore()

const fileAssociationService = new FileAssociationService()
const fileService = new FileService((conversationId, dirs) => {
  sendToWorkspaceWindows(IPC.filesDirty, { conversationId, dirs }, conversationId)
})
// Wired after construction — retrieval is defined below; assigned once created.

const ptyManager = new PtyManager(
  (tabId, data) =>
    sendToWorkspaceWindows(IPC.ptyData, { tabId, data }, ptyManager.conversationIdFor(tabId)),
  (tabId, conversationId) => sendToWorkspaceWindows(IPC.ptyExit, tabId, conversationId),
  // Workspace windows re-hydrate tab maps from main — no per-renderer PTY ownership.
  (conversationId) => sendToWorkspaceWindows(IPC.ptyChanged, { conversationId }, conversationId)
)

/** Conversation ids with a live or paused turn — drives the tray badge/menu. */
const activeTurns = new Map<string, 'running' | 'paused'>()

function focusConversation(conversationId: string): void {
  const wasMissing = !mainWindow || mainWindow.isDestroyed()
  showMainWindow()
  const send = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    safeSend(mainWindow.webContents, IPC.cliOpen, { conversationId, toast: null })
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
 * Detached session → main window: select the row, focus main, close companion.
 * (Reveal in List — user leaves the floating window for the sidebar list.)
 */
function revealConversationInList(conversationId: string): void {
  if (!conversationId || !conversationStore.get(conversationId)) return
  // ⌘⇧↵ sessions are ephemeral until they get a message; revealing into the
  // list is an explicit keep — don't auto-delete when the companion closes.
  ephemeralConversations.delete(conversationId)
  focusConversation(conversationId)
  const detached = detachedWindows.get(conversationId)
  if (detached && !detached.isDestroyed()) {
    // Defer close so main can take focus first (macOS Space / z-order).
    setTimeout(() => {
      if (!detached.isDestroyed()) detached.close()
    }, 80)
  }
}

const notifications = new NotificationCenter(
  () => settingsStore.get(),
  focusConversation,
  () => openSettingsWindow(),
  showMainWindow,
  () => mainWindow
)

function refreshTraySessions(): void {
  const sessions = [...activeTurns.keys()].map((id) => {
    const conversation = conversationStore.get(id)
    return { id, title: conversation?.title ?? id }
  })
  notifications.updateRunningSessions(sessions)
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

function rebuildAppChrome(): void {
  appMenu = buildAppMenu(sendMenuCommand, () => openSettingsWindow(), newDetachedSession)
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
    }
    return
  }
  if (event.type === 'awaiting') {
    activeTurns.set(event.conversationId, 'paused')
    refreshTraySessions()
    const tool = event.block.tool
    const body = event.block.summary || event.block.tool
    if (tool === 'ask_user_question') {
      notifications.notify(
        'ask',
        event.conversationId,
        t('notify.awaitingAnswer', { title }),
        body
      )
    } else if (tool === 'request') {
      notifications.notify(
        'request',
        event.conversationId,
        t('notify.requestConfirm', { title }),
        body
      )
    } else if (event.block.choices?.length) {
      notifications.notify(
        'approval',
        event.conversationId,
        t('notify.awaitingApproval', { title }),
        body
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
    refreshTraySessions()
    pushTokenUsageIfOpen(event.conversationId)
    if (!event.cancelled && !event.error) {
      const body = event.message.content || t('notify.turnComplete')
      notifications.notify('turn-complete', event.conversationId, title, body)
    }
  }
}

const changeSetStore = new ChangeSetStore()
const updateService = new UpdateService()
const documentRetrieval = new DocumentRetrievalService()
fileService.retrieval = documentRetrieval
const duckdb = new DuckDbService()
const webSearch = new WebSearchService()
const webFetch = new WebFetchService()
const skillService = new SkillService()

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
  emit: handleAgentEvent
})

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
  if (command === lastMenuCommand && now - lastMenuCommandAt < 80) return
  lastMenuCommand = command
  lastMenuCommandAt = now
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (target && !target.isDestroyed() && target !== settingsWindow) {
    safeSend(target.webContents, IPC.menuCommand, command)
  }
}

/**
 * Re-dispatch product shortcuts when focus is inside xterm (or any input).
 * Menu accelerators alone often never fire once the terminal helper textarea
 * owns keyboard focus — `before-input-event` runs first and is reliable.
 */
function wireMenuAccelerators(contents: Electron.WebContents): void {
  contents.on('before-input-event', (event, input) => {
    const command = menuCommandFromInput(input)
    if (!command) return
    event.preventDefault()
    // open-settings is owned by main (native window), not the renderer list.
    if (command === 'open-settings') {
      openSettingsWindow()
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

/**
 * Paint html/body/#root before React/CSS arrive so dark-mode cold opens
 * (⌘⇧↵ session, Settings, main) never flash system white.
 */
function primeRendererShell(win: BrowserWindow): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  const bg = windowBackground()
  const scheme = windowThemeName()
  const css = `html,body,#root{background:${bg}!important;margin:0;height:100%;color-scheme:${scheme}}`
  const inject = (): void => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    void win.webContents.insertCSS(css).catch(() => undefined)
  }
  inject()
  win.webContents.once('dom-ready', inject)
}

/** `barHeight` matches the renderer's own title bar, so the two rows line up. */
function overlayColors(barHeight = 52): {
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
function chrome(barHeight: number): Electron.BrowserWindowConstructorOptions {
  // Solid `backgroundColor` (no vibrancy): during a fast drag-resize Chromium
  // trails the NSWindow by a frame or two. Vibrancy paints those uncovered
  // strips black; a solid wash matching `--bg-window` makes the lag invisible.
  if (IS_MAC) {
    return {
      titleBarStyle: 'hiddenInset',
      // Vertically centred on the title bar, so the traffic lights sit on the
      // same line as the buttons at the other end of it.
      trafficLightPosition: { x: 12, y: Math.round((barHeight - 12) / 2) },
      backgroundColor: windowBackground()
    }
  }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(barHeight),
    backgroundColor: windowBackground(),
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

/** Preview windows that must confirm before close (unsaved edit). */
const previewCloseGuards = new WeakSet<BrowserWindow>()

/** Close an unfocused preview after idle; cap how many stay around. */
function wirePreviewLifecycle(window: BrowserWindow, path: string): void {
  let idleTimer: NodeJS.Timeout | null = null
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isFocused()) {
        afterLeavingFullscreen(window, () => {
          if (!window.isDestroyed() && !window.isFocused()) {
            fullscreenCloseAllowed.add(window)
            window.close()
          }
        })
      }
    }, PREVIEW_IDLE_MS)
  }
  window.on('blur', armIdle)
  window.on('focus', () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  })
  // Unsaved guard first; then leave native fullscreen before destroy.
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
    if (!window.isFullScreen()) return
    event.preventDefault()
    window.once('leave-full-screen', () => {
      if (window.isDestroyed()) return
      fullscreenCloseAllowed.add(window)
      window.close()
    })
    window.setFullScreen(false)
  })
  window.on('closed', () => {
    if (idleTimer) clearTimeout(idleTimer)
    previewCloseGuards.delete(window)
  })

  // Cap open previews: close the oldest unfocused ones first.
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
      if (!victim.isDestroyed()) {
        fullscreenCloseAllowed.add(victim)
        victim.close()
      }
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

async function waitForRendererPaint(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  if (win.webContents.isLoadingMainFrame()) return
  const script = `(function(){
    try {
      document.documentElement.dataset.summoning = '1';
      var prev = window.__vavSummonClear;
      if (prev) window.clearTimeout(prev);
      window.__vavSummonClear = window.setTimeout(function(){
        try { delete document.documentElement.dataset.summoning; } catch (e) {}
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

async function revealBrowserWindow(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  // Steal focus first so Space switching starts before pixels land.
  app.focus({ steal: true })
  try {
    win.setBackgroundColor(windowBackground())
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

function createWindow(): BrowserWindow {
  const icon = loadAppIcon()
  const snapshotting = Boolean(process.env.VAV_SNAPSHOT)
  const window = new BrowserWindow({
    width: snapshotting ? 1440 : 720,
    height: snapshotting ? 900 : 820,
    minWidth: 380,
    minHeight: 560,
    show: false,
    // Paint while hidden so ready-to-show / hotkey reveal has a real frame.
    paintWhenInitiallyHidden: true,
    title: APP_NAME,
    icon,
    ...chrome(52),
    webPreferences: rendererPrefs()
  })
  applyMenuBar(window)

  window.once('ready-to-show', () => {
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
  primeRendererShell(window)
  try {
    window.setBackgroundColor(windowBackground())
  } catch {
    // ignore
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL + (search ? `?${search}` : ''))
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { query: withTheme })
  }
}

function openSettingsWindow(view: SettingsView = 'api'): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    safeSend(settingsWindow.webContents, IPC.settingsView, view)
    void revealBrowserWindow(settingsWindow)
    return
  }

  ensureSettingsWindow(view, true)
}

/**
 * Keep Settings warm like the token panel: hide on close, show instantly next time.
 */
function ensureSettingsWindow(view: SettingsView = 'api', showNow: boolean): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (showNow) openSettingsWindow(view)
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
    ...chrome(38),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: rendererPrefs()
  })
  applyMenuBar(settingsWindow)

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
  loadRenderer(settingsWindow, { view: 'settings', category: view })
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
  const width = Math.min(380, area.width - 40)
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
function raiseDetachedWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
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
    return
  }
  // Cold companion: paint a frame while still hidden, then raise.
  void waitForRendererPaint(win).then(finish)
}

/**
 * Opens one conversation in its own window: transcript, tools and composer,
 * no sidebar.
 *
 * The main window is deliberately left alone — its selection, transcript,
 * bounds, and PTY size votes are independent. Detaching is "also show it over
 * here", not "hand it over" or "resize the main window to companion size".
 */
function openDetachedWindow(
  conversationId: string,
  options: { collapseTools?: boolean } = {}
): BrowserWindow | null {
  const existing = detachedWindows.get(conversationId)
  if (existing && !existing.isDestroyed()) {
    raiseDetachedWindow(existing)
    safeSend(existing.webContents, IPC.menuCommand, 'focus-composer')
    return existing
  }

  const conversation = conversationStore.get(conversationId)
  if (!conversation) return null

  // Snapshot main bounds so we can assert we never mutated them (debug aid).
  const mainBoundsBefore =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null

  const bounds = detachedBounds(detachedWindows.size)

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 420,
    show: false,
    paintWhenInitiallyHidden: true,
    title: conversation.title,
    icon: loadAppIcon(),
    ...chrome(38),
    // Companion column — never enter macOS fullscreen itself.
    fullscreenable: false,
    // Not a child of main — child windows can inherit geometry quirks on macOS.
    parent: undefined,
    webPreferences: rendererPrefs()
  })
  applyMenuBar(window)

  // Space membership is handled in raiseDetachedWindow (brief join-desktops,
  // then pin). Do not set visibleOnFullScreen here — that causes the flash
  // when switching into other apps’ fullscreen Spaces.

  detachedWindows.set(conversationId, window)
  // Main window must drop its live agent xterm for this id (exclusive PTY view).
  publishDetachedSessions()

  // Raise exactly once when the window is ready — a second raise on
  // did-finish-load re-focused the frame and made the shadow flicker.
  // Composer focus is owned by SessionWindow after React mounts.
  window.once('ready-to-show', () => {
    raiseDetachedWindow(window)
  })

  // Unlike the main window, closing here really does close: the conversation
  // is not going away, it just goes back to being a row in the sidebar.
  window.on('closed', () => {
    detachedWindows.delete(conversationId)
    publishDetachedSessions()
    if (ephemeralConversations.delete(conversationId)) {
      const stale = conversationStore.get(conversationId)
      // Empty *chat* is not empty work: a CLI agent host (Grok / Cursor / …)
      // or any PTY means the user already invested in this session.
      const agentActive =
        !!stale?.agentBinaryName && stale.agentBinaryName !== 'vav'
      const hasPty = ptyManager.hasConversation(conversationId)
      if (stale && stale.messages.length === 0 && !agentActive && !hasPty) {
        const removed = conversationStore.remove([conversationId])
        for (const id of removed) {
          agent.disposeConversation(id)
          ptyManager.killForConversation(id)
          fileService.unwatch(id)
        }
        if (removed.length) conversationStore.flush()
      }
    }
    publishConversations()
  })

  wireExternalLinks(window.webContents)
  wireMenuAccelerators(window.webContents)
  wirePtyViewerLifecycle(window.webContents)

  if (!app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[session:${event.level}] ${event.message}`)
    })
  }

  const query: Record<string, string> = { view: 'session', conversationId }
  if (options.collapseTools) query.collapseTools = '1'
  loadRenderer(window, query)

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
  options?: { origin?: 'dock' | 'session'; conversationId?: string }
): Record<string, string> {
  const query: Record<string, string> = {
    view: 'file-preview',
    path,
    origin: options?.origin ?? 'session'
  }
  if (options?.conversationId) query.conversationId = options.conversationId
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
 * File preview in its own window (file-preview.rpml).
 * One absolute path → one BrowserWindow: reopen focuses the existing window;
 * a different path always opens a new window (never navigates an open preview
 * in place). Capped by PREVIEW_MAX_OPEN.
 */
function openFilePreviewWindow(
  filePath: string,
  options?: { origin?: 'dock' | 'session'; conversationId?: string }
): void {
  const path = previewPathKey(filePath)
  if (!path) return

  const existing = previewWindows.get(path)
  if (existing && !existing.isDestroyed()) {
    void revealBrowserWindow(existing)
    return
  }

  const anchor = BrowserWindow.getFocusedWindow() ?? mainWindow
  const area = (
    anchor && !anchor.isDestroyed() ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay()
  ).workArea
  // Marketing snapshots need a wide preview (canvas + agent) — not the compact default.
  const snapshotting = Boolean(process.env.VAV_SNAPSHOT || process.env.VAV_SNAPSHOT_PLAN)
  const width = Math.min(snapshotting ? 1280 : 800, area.width - 40)
  const height = Math.min(snapshotting ? 820 : 700, area.height - 40)

  // Cascade off the frontmost preview (or focused window) so each open is visible.
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

  const window = new BrowserWindow({
    width,
    height,
    ...(x != null && y != null ? { x, y } : {}),
    minWidth: 520,
    minHeight: 400,
    // Show immediately so Dock / Finder open feels snappy; content paints after load.
    show: true,
    title: basename(path),
    icon: loadAppIcon(),
    // Match `.file-viewer-header` height so traffic lights sit on the drag bar.
    ...chrome(42),
    webPreferences: rendererPrefs({
      // Chromium's built-in PDF viewer.
      plugins: true
    })
  })
  applyMenuBar(window)

  previewWindows.set(path, window)
  window.on('closed', () => {
    forgetPreviewWindow(window)
  })
  wirePreviewLifecycle(window, path)
  // Same as main window: drop traffic-light lead inset when fullscreen so the
  // title is not left with a blank gutter (file-viewer-header uses --chrome-lead).
  wireFullscreenState(window)

  wireExternalLinks(window.webContents)
  wireMenuAccelerators(window.webContents)
  wirePtyViewerLifecycle(window.webContents)

  if (!app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[preview:${event.level}] ${event.message}`)
    })
  }

  loadRenderer(window, previewQuery(path, options))
  // Bring to front after create — Dock open can leave focus on the previous window.
  if (window.isMinimized()) window.restore()
  window.focus()
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
  const activeCompaction = compactionForLeaf(
    conversation.compactions,
    conversation.messages,
    leafId
  )
  const latestInput = conversation.tokenHistory?.at(-1)?.totalInputTokens ?? 0
  const estimated = activeCompaction?.estimatedContextTokens ?? 0
  const contextTokens =
    estimated > 0
      ? estimated
      : latestInput > 0
        ? latestInput
        : conversation.tokensUsed
  return {
    conversationId: conversation.id,
    model: conversation.model,
    tokensUsed: conversation.tokensUsed,
    tokenLimit: conversation.tokenLimit,
    history: conversation.tokenHistory ?? [],
    cacheCreatedAt: conversation.cacheCreatedAt ?? null,
    cacheExpiresAt: conversation.cacheExpiresAt ?? null,
    isRunning: phase === 'running' || phase === 'paused',
    apiEndpoint: settings.apiEndpoint,
    theme: settings.theme,
    locale: currentLocale(),
    now: Date.now(),
    hasCompaction: !!activeCompaction,
    compactedCount: activeCompaction?.compactedCount ?? 0,
    pathMessageCount: pathLen,
    contextTokens,
    contextTokensEstimated: estimated > 0
  }
}

function sendTokenUsagePayload(conversationId: string): void {
  if (!tokenUsageWindow || tokenUsageWindow.isDestroyed()) return
  const payload = buildTokenUsagePayload(conversationId)
  if (!payload) return
  safeSend(tokenUsageWindow.webContents, IPC.tokenUsageView, payload)
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
    ...(IS_MAC ? { type: 'panel' as const, roundedCorners: true } : {}),
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
    ...(IS_MAC ? { type: 'panel' as const, roundedCorners: true } : {}),
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

/** Debounce: menu accelerator + globalShortcut can both fire when vav is focused. */
let lastDetachedSessionAt = 0

/** ⌘⇧↵ from anywhere: a brand new conversation, straight into its own window. */
function newDetachedSession(): void {
  const now = Date.now()
  if (now - lastDetachedSessionAt < 450) return
  lastDetachedSessionAt = now
  const settings = settingsStore.get()
  const conversation = conversationStore.create(resolveNewWorkdir(), settings.defaultModel, {
    approvalMode: settings.defaultApprovalMode ?? 'auto'
  })
  ephemeralConversations.add(conversation.id)
  publishConversations()
  // ⌘⇧↵: tools panel starts collapsed (main-chat.rpml).
  // raiseDetachedWindow handles focus — do not app.focus alone (fullscreen steal).
  openDetachedWindow(conversation.id, { collapseTools: true })
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
  return new Promise((resolve) => {
    let chosen: string | null = null
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      // setImmediate so click handlers that themselves open menus still run first.
      setImmediate(() => resolve(chosen))
    }

    // Use `radio` (not `checkbox`) for exclusive picks like model / approval mode.
    // Checkbox groups on AppKit often fail to fire click for non-checked rows.
    const template: Electron.MenuItemConstructorOptions[] = items.map((item) => {
      if (item.separator) return { type: 'separator' }
      if (item.role) return { role: item.role, label: item.label }
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
    if (!app.isPackaged) {
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
      if (window.isDestroyed()) {
        finish()
        return
      }
      try {
        Menu.buildFromTemplate(template).popup(opts)
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

  const captureWindow = async (win: BrowserWindow, outPath: string): Promise<void> => {
    if (win.isMinimized()) win.restore()
    if (win === window) {
      win.setSize(1440, 900)
      await sleep(400)
    } else {
      // File-preview companions: ensure marketing size even if create used defaults.
      win.setSize(1280, 820)
      await sleep(450)
    }
    const image = await win.webContents.capturePage()
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, image.toPNG())
    console.log(`[snapshot] wrote ${outPath}`)
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
                w !== tokenUsageWindow
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
          await captureWindow(child, outPath)
          child.destroy()
        } else {
          await captureWindow(window, outPath)
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

function showMainWindow(): void {
  // Hidden-Dock sessions still need a visible window when the user (or a second
  // launch) asks for the app — briefly surface the Dock so Mission Control /
  // Cmd-Tab can find us too.
  if (process.platform === 'darwin' && app.dock && !app.dock.isVisible()) {
    app.dock.show()
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  void revealBrowserWindow(mainWindow)
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
  const conversation = conversationStore.create(resolved, sessionSettings.defaultModel, {
    approvalMode: sessionSettings.defaultApprovalMode ?? 'auto'
  })
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
const GLOBAL_NEW_SESSION_WINDOW = 'CommandOrControl+Shift+Return'

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
  // 2) Fixed: new detached session from any app (⌘⇧↵ / Ctrl+Shift+Enter)
  try {
    const ok = globalShortcut.register(GLOBAL_NEW_SESSION_WINDOW, () => {
      console.log(`[hotkey] new-session fired: ${GLOBAL_NEW_SESSION_WINDOW}`)
      newDetachedSession()
    })
    if (!ok) {
      console.warn(
        `[hotkey] failed to register global new-session: ${GLOBAL_NEW_SESSION_WINDOW} (taken by another app?)`
      )
    } else {
      console.log(`[hotkey] registered global new-session: ${GLOBAL_NEW_SESSION_WINDOW}`)
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
  app.on('browser-window-focus', () => {
    publishSystemAccentColor(false)
  })
}

// ---------------------------------------------------------------------------
// Working directories
// ---------------------------------------------------------------------------

/** Empty default workdir mints a Temporary Workspace folder (README §2.5). */
function resolveNewWorkdir(): string {
  const configured = settingsStore.get().defaultWorkingDirectory.trim()
  if (configured) return configured
  const dir = join(tmpdir(), 'vav', randomUUID().slice(0, 8), 'Workspace')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return tmpdir()
  }
  return dir
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function currentSettings(): AppSettings {
  return {
    ...settingsStore.get(),
    apiKeyPresent: secretStore.has('api'),
    braveSearchKeyPresent: secretStore.has('braveSearch')
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
  ipcMain.handle(IPC.secretsUnlock, () => secretStore.unlock())

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
    if (
      patch.trayEnabled !== undefined ||
      patch.hideDockIcon !== undefined ||
      patch.notificationsEnabled !== undefined
    ) {
      notifications.applySettings()
    }
    const settings = currentSettings()
    broadcast(IPC.settingsChanged, settings)
    return settings
  })

  ipcMain.handle(IPC.settingsReset, () => {
    secretStore.clear('api')
    secretStore.clear('braveSearch')
    const next = settingsStore.reset()
    setLocalePreference(next.locale)
    applyTheme(next.theme)
    registerGlobalHotkey(next.globalHotkey)
    rebuildAppChrome()
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

  ipcMain.handle(IPC.settingsCliStatus, () => getCliStatus())
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
      const conversation = conversationStore.create(workdir, model, {
        approvalMode: settings.defaultApprovalMode ?? 'auto'
      })
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
    conversationStore.updateMeta(id, { model })
    publishConversations()
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

  const applyWorkingDirectory = (id: string, path: string): ConversationMeta[] => {
    conversationStore.updateMeta(id, { workingDirectory: path })
    agent.setWorkingDirectory(id, path)
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
      // Deleting a conversation is the one path that tears down its processes.
      agent.disposeConversation(id)
      ptyManager.killForConversation(id)
      fileService.unwatch(id)
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

  // --- agent ---
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
  ipcMain.handle(IPC.agentCancel, (_event, id: string) => agent.cancel(id))
  ipcMain.handle(IPC.agentAnswer, (_event, id: string, toolCallId: string, answer: string) =>
    agent.answer(id, toolCallId, answer)
  )
  ipcMain.handle(IPC.agentStatus, (_event, id: string) => agent.status(id))
  ipcMain.handle(IPC.agentRegenerate, (_event, id: string, messageId: string) => {
    void agent.regenerate(id, messageId)
  })
  ipcMain.handle(IPC.agentEditUser, (_event, id: string, messageId: string, text: string) => {
    void agent.editUserMessage(id, messageId, text)
  })
  ipcMain.handle(IPC.agentFork, (_event, id: string, messageId: string) =>
    agent.fork(id, messageId)
  )
  ipcMain.handle(
    IPC.agentCompact,
    async (_event, id: string, options?: { keepAfterMessageId?: string | null }) => {
      const result = await agent.compact(id, options)
      if (result.ok) {
        const conversation = conversationStore.get(id)
        broadcast(IPC.compactionsChanged, {
          conversationId: id,
          compactions: conversation?.compactions ?? []
        })
        pushTokenUsageIfOpen(id)
      }
      return result
    }
  )
  ipcMain.handle(IPC.agentClearCompaction, (_event, id: string, leafId: string) => {
    const result = agent.clearCompaction(id, leafId)
    if (result.ok) {
      const conversation = conversationStore.get(id)
      broadcast(IPC.compactionsChanged, {
        conversationId: id,
        compactions: conversation?.compactions ?? []
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
    (_event, path: string, opts?: { startByte?: number; maxBytes?: number }) =>
      fileService.readTextWindow(path, opts)
  )
  ipcMain.handle(IPC.filesReadBinary, (_event, path: string) => fileService.readBinary(path))
  ipcMain.handle(IPC.filesWriteBinary, (_event, path: string, base64: string) =>
    fileService.writeBinary(path, base64)
  )
  ipcMain.handle(IPC.filesWrite, (_event, path: string, content: string) =>
    fileService.writeTextFile(path, content)
  )
  ipcMain.handle(IPC.filesQuickLook, (_event, path: string) => fileService.preview(path))
  ipcMain.handle(IPC.filesOpenWithDefault, (_event, path: string) => fileService.openWithDefault(path))
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
      fullscreenCloseAllowed.add(win)
      win.close()
    })
  })
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
  ipcMain.handle(IPC.filesInspect, (_event, path: string) => fileService.inspect(path))
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
    const settings = settingsStore.get()
    const opened = await fileSessionStore.open(
      path,
      settings.defaultModel,
      settings.defaultApprovalMode ?? 'auto'
    )
    // Don't broadcast file sessions into the main sidebar list (already filtered).
    return toFileSessionsState(opened.fileId, opened.activeSessionId, opened.sessions)
  })

  ipcMain.handle(IPC.fileSessionsCreate, async (_event, path: string) => {
    const settings = settingsStore.get()
    const created = await fileSessionStore.createSession(
      path,
      settings.defaultModel,
      settings.defaultApprovalMode ?? 'auto'
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

  // --- pty ---
  ipcMain.handle(
    IPC.ptyCreate,
    (
      _event,
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      options?: import('@shared/ipc').PtyCreateOptions | string
    ) => {
      // Spawning a shell or CLI agent host is enough to keep a ⌘⇧↵ session.
      promoteEphemeralConversation(conversationId)
      return ptyManager.create(
        conversationId,
        settingsStore.get().shell,
        cwd,
        cols,
        rows,
        options
      )
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
  ipcMain.handle(IPC.ptyKill, (_event, tabId: string) => ptyManager.kill(tabId))
  ipcMain.handle(IPC.ptyIsBusy, (_event, tabId: string) => ptyManager.isBusy(tabId))
  ipcMain.handle(IPC.ptyList, (_event, conversationId: string) =>
    ptyManager.listForConversation(String(conversationId || ''))
  )
  ipcMain.handle(IPC.ptyReplay, (_event, tabId: string) =>
    ptyManager.replay(String(tabId || ''))
  )

  // --- window ---
  ipcMain.handle(IPC.windowSetTheme, (_event, theme: AppSettings['theme']) => applyTheme(theme))
  ipcMain.handle(IPC.windowGetAccentColor, () => readSystemAccentColor())
  ipcMain.handle(IPC.windowShellPath, (_event, kind: ShellKind) => shellPath(kind))

  ipcMain.handle(IPC.windowOpenSettings, (_event, view?: SettingsView) => openSettingsWindow(view))
  ipcMain.handle(IPC.windowCloseSettings, () => {
    // Hide (don't destroy) so the next open is instant.
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.hide()
  })

  ipcMain.handle(IPC.windowOpenSession, (_event, id: string) => {
    // Must not return BrowserWindow — structured clone can't send it over IPC.
    openDetachedWindow(String(id || ''))
  })
  ipcMain.handle(IPC.windowRevealInList, (event, id: string) => {
    revealConversationInList(String(id || ''))
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
      setTimeout(() => {
        if (!senderWin.isDestroyed()) senderWin.close()
      }, 80)
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
      options?: { origin?: 'dock' | 'session'; conversationId?: string }
    ) => openFilePreviewWindow(path, options)
  )
  ipcMain.handle(
    IPC.windowOpenTokenUsage,
    (
      event,
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ) => openTokenUsageWindow(event.sender, conversationId, anchor)
  )
  ipcMain.handle(IPC.windowRelaunch, () => {
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle(IPC.notificationsPermission, () => notifications.permissionStatus())

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
    quitting = true
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
      approvalMode: s.defaultApprovalMode ?? 'auto'
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
  changeSetStore.beginTurn(meta.id)
  changeSetStore.recordWrite(meta.id, workdir, modified, 'const a = 1\n', 'const a = 2\n')
  changeSetStore.recordWrite(meta.id, workdir, added, null, 'export const x = 1\n')
  writeFileSync(modified, 'const a = 2\n', 'utf8')
  writeFileSync(added, 'export const x = 1\n', 'utf8')
  const set = changeSetStore.finalizeTurn(meta.id, 'smoke change review', meta.model || 'test')
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
    showMainWindow()
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
    agent.disposeAll()
    ptyManager.killAll()
    fileService.disposeAll()
    conversationStore.flush()
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())

  app.whenReady().then(async () => {
    applyBranding()
    protocol.handle('vav-local', async (request) => {
      try {
        const filePath = decodeURIComponent(new URL(request.url).searchParams.get('path') ?? '')
        if (!filePath || !existsSync(filePath)) {
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
    fileSessionStore.bind(conversationStore)
    applyTheme(settings.theme ?? DEFAULT_SETTINGS.theme)
    nativeTheme.on('updated', repaintChrome)
    watchSystemAccentColor()
    registerGlobalHotkey(settings.globalHotkey)
    registerIpc()
    notifications.applySettings()
    rebuildAppChrome()

    if (process.env.VAV_SNAPSHOT) {
      // Marketing captures should use default layout (tools open, files segment).
      await session.defaultSession.clearStorageData({ storages: ['localstorage'] })
    }

    mainWindow = createWindow()
    // Belt-and-suspenders: ready-to-show can race with Dock hide / focus steals
    // from the IDE. Force the main window up once the renderer finishes loading.
    mainWindow.webContents.once('did-finish-load', () => {
      showMainWindow()
      if (process.env.VAV_SMOKE_SEED === '1') {
        void seedSmokeChangeReview()
      }
      // After the main shell is up, preload companion windows so Settings /
      // token ring open without a cold BrowserWindow + renderer load.
      setTimeout(() => {
        try {
          warmTokenUsageWindow()
        } catch {
          // non-fatal
        }
      }, 1600)
      setTimeout(() => {
        try {
          warmSettingsWindow()
        } catch {
          // non-fatal
        }
      }, 2400)
    })
    // Dock tiles cache aggressively for the rebranded Electron.dev bundle —
    // re-assert the PNG after the first window exists so the tile updates.
    applyDockIcon()
    // Silent check so the bottom-left update chip can appear when a newer release exists.
    if (currentSettings().autoCheckUpdates) {
      void updateService.check()
    }

    if (process.env.VAV_SNAPSHOT) {
      // Marketing captures seed their own conversations; ignore argv path opens.
      appReadyForOpens = true
    } else if (argvRequestsCliOpen(process.argv)) {
      // Bare `vav` with the flag but empty value still goes through openFromCli.
      appReadyForOpens = true
      openFromCli(parseCliWorkdir(process.argv))
    } else {
      // Dock cold-start / Finder "Open With": queued open-file + argv paths.
      flushPendingOpens(parseOpenPathsFromArgv(process.argv))
    }

    // Dock click restores the single main window instead of spawning another.
    app.on('activate', showMainWindow)
  })
}
