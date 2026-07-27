import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell
} from 'electron'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync, mkdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { APP_NAME, applyBranding, applyDockIcon, loadAppIcon } from './brand'
import {
  IPC,
  type Bootstrap,
  type MenuCommand,
  type NativeMenuItem,
  type SettingsView
} from '@shared/ipc'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ConversationMeta,
  type FileSortKey,
  type ShellKind,
  type TurnEvent
} from '@shared/types'
import { SettingsStore } from './store/SettingsStore'
import { SecretStore } from './store/SecretStore'
import { ConversationStore } from './store/ConversationStore'
import { FileService } from './fs/FileService'
import { PtyManager } from './terminal/PtyManager'
import { AgentRuntime } from './agent/AgentRuntime'
import { validateApiKey } from './agent/provider'
import { shellPath } from './terminal/StickyShell'
import { buildAppMenu } from './menu'
import { currentLocale, setLocalePreference, t } from './i18n'
import { codeFonts, type Platform } from '@shared/platform'
import {
  getCliStatus,
  installCli,
  parseCliWorkdir,
  parseOpenPathsFromArgv,
  resolveOpenPaths,
  setCliPreferredLocation,
  uninstallCli,
  type CliInstallLocation
} from './cli'
import { NotificationCenter } from './notifications'

const PLATFORM = process.platform as Platform
const IS_MAC = PLATFORM === 'darwin'

// Branding before ready so the menu bar reads "vav" instead of "Electron".
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

const fileService = new FileService((conversationId, dirs) => {
  send(IPC.filesDirty, { conversationId, dirs })
})

const ptyManager = new PtyManager(
  (tabId, data) => send(IPC.ptyData, { tabId, data }),
  (tabId) => send(IPC.ptyExit, tabId)
)

/** Conversation ids with a live or paused turn — drives the tray badge/menu. */
const activeTurns = new Map<string, 'running' | 'paused'>()

function focusConversation(conversationId: string): void {
  showMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.cliOpen, { conversationId, toast: null })
  }
}

const notifications = new NotificationCenter(
  () => settingsStore.get(),
  focusConversation,
  () => openSettingsWindow(),
  () => mainWindow
)

function refreshTraySessions(): void {
  const sessions = [...activeTurns.keys()].map((id) => {
    const conversation = conversationStore.get(id)
    return { id, title: conversation?.title ?? id }
  })
  notifications.updateRunningSessions(sessions)
}

function rebuildAppChrome(): void {
  Menu.setApplicationMenu(
    buildAppMenu(sendMenuCommand, () => openSettingsWindow(), newDetachedSession)
  )
  refreshTraySessions()
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setTitle(t('app.settingsWindowTitle'))
  }
}

function handleAgentEvent(event: TurnEvent): void {
  send(IPC.agentEvent, event)
  const conversation = conversationStore.get(event.conversationId)
  const title = conversation?.title ?? t('window.sessionFallback')

  if (event.type === 'start') {
    activeTurns.set(event.conversationId, 'running')
    refreshTraySessions()
    return
  }
  if (event.type === 'phase') {
    if (event.phase === 'awaiting-user') {
      activeTurns.set(event.conversationId, 'paused')
      refreshTraySessions()
    } else if (event.phase === 'working' || event.phase === 'thinking' || event.phase === 'outputting') {
      activeTurns.set(event.conversationId, 'running')
      refreshTraySessions()
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
  if (event.type === 'end') {
    activeTurns.delete(event.conversationId)
    refreshTraySessions()
    if (!event.cancelled && !event.error) {
      const body = event.message.content || t('notify.turnComplete')
      notifications.notify('turn-complete', event.conversationId, title, body)
    }
  }
}

const agent = new AgentRuntime({
  conversations: conversationStore,
  settings: settingsStore,
  secrets: secretStore,
  files: fileService,
  emit: handleAgentEvent
})

/**
 * Turn, pty and watcher events go to every window.
 *
 * A conversation can be showing in the main window or in its own one, and the
 * renderer keys everything by conversationId anyway — so addressing a single
 * window would just mean guessing which one is currently displaying it.
 */
function send(channel: string, payload: unknown): void {
  broadcast(channel, payload)
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

/** Accelerators act on the window the user is actually looking at. */
function sendMenuCommand(command: MenuCommand): void {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (target && !target.isDestroyed() && target !== settingsWindow) {
    target.webContents.send(IPC.menuCommand, command)
  }
}

function publishConversations(): void {
  broadcast(IPC.convChanged, conversationStore.listMeta())
}

// ---------------------------------------------------------------------------
// Window chrome
// ---------------------------------------------------------------------------

/** The window's own fill, shown for the frame or two before the renderer paints. */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#121213' : '#eceaf1'
}

/** `barHeight` matches the renderer's own title bar, so the two rows line up. */
function overlayColors(barHeight = 52): {
  color: string
  symbolColor: string
  height: number
} {
  const dark = nativeTheme.shouldUseDarkColors
  return {
    color: dark ? '#121213' : '#eceaf1',
    symbolColor: dark ? '#efeff1' : '#131b35',
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
    backgroundColor: windowBackground()
  }
}

/** The system chrome does not follow `nativeTheme` on its own once overridden. */
function repaintChrome(): void {
  const background = windowBackground()
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
 * Chat / terminal links must leave the app. `setWindowOpenHandler` only covers
 * `window.open` / `target=_blank`; a plain `<a href>` navigates the current
 * BrowserWindow unless `will-navigate` sends it to the system browser instead.
 */
function wireExternalLinks(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    void shell.openExternal(url)
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

/** Close an unfocused preview after idle; cap how many stay around. */
function wirePreviewLifecycle(window: BrowserWindow, path: string): void {
  let idleTimer: NodeJS.Timeout | null = null
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isFocused()) window.close()
    }, PREVIEW_IDLE_MS)
  }
  window.on('blur', armIdle)
  window.on('focus', () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  })
  window.on('closed', () => {
    if (idleTimer) clearTimeout(idleTimer)
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
    victim.close()
  }
}

/**
 * Fullscreen hides the traffic-light gutter; tell the renderer so it can drop
 * the reserved leading inset that would otherwise read as empty space.
 */
function wireFullscreenState(window: BrowserWindow): void {
  const publish = (): void => {
    if (window.isDestroyed()) return
    window.webContents.send(IPC.windowFullscreen, window.isFullScreen())
  }
  window.on('enter-full-screen', publish)
  window.on('leave-full-screen', publish)
  window.webContents.on('did-finish-load', publish)
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
    title: APP_NAME,
    icon,
    ...chrome(52),
    webPreferences: rendererPrefs()
  })

  window.once('ready-to-show', () => window.show())

  // ⌘W and the red traffic light only hide the window: agent turns and PTYs
  // must survive (README §2.9). Only an explicit Quit tears things down.
  //
  // Windows has no dock to bring a hidden window back from, so there the close
  // button means what it says and the teardown in `before-quit` runs instead.
  if (IS_MAC && !snapshotting) {
    window.on('close', (event) => {
      if (quitting) return
      event.preventDefault()
      window.hide()
    })
  }

  wireExternalLinks(window.webContents)
  wireFullscreenState(window)

  if (!app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`)
    })
    window.webContents.on('preload-error', (_event, path, error) => {
      console.error('[preload error]', path, error)
    })
    window.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error('[did-fail-load]', code, description, url)
    })
  }

  installSnapshotHook(window)
  loadRenderer(window)

  return window
}

/** One renderer bundle serves both windows; `view` picks which one to mount. */
function loadRenderer(window: BrowserWindow, query: Record<string, string> = {}): void {
  const search = new URLSearchParams(query).toString()
  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL + (search ? `?${search}` : ''))
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), search ? { query } : undefined)
  }
}

function openSettingsWindow(view: SettingsView = 'api'): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send(IPC.settingsView, view)
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 620,
    minHeight: 440,
    show: false,
    title: t('app.settingsWindowTitle'),
    icon: loadAppIcon(),
    ...chrome(38),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: rendererPrefs()
  })

  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  wireExternalLinks(settingsWindow.webContents)

  if (!app.isPackaged) {
    settingsWindow.webContents.on('console-message', (event) => {
      console.log(`[settings:${event.level}] ${event.message}`)
    })
  }

  loadRenderer(settingsWindow, { view: 'settings', category: view })
}

/**
 * A narrow column parked against the right edge of the screen.
 *
 * A detached session is something you keep half an eye on beside whatever you
 * are actually working in, so it is sized as a companion rather than a second
 * main window, and it opens where it will not land on top of the thing that
 * spawned it. `cascade` steps each additional window so several stay tellable
 * apart instead of stacking into one.
 */
function detachedBounds(cascade: number): {
  width: number
  height: number
  x: number
  y: number
} {
  const anchor = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null
  const area = (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea

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
 * Opens one conversation in its own window: transcript, tools and composer,
 * no sidebar.
 *
 * The main window is deliberately left alone — its selection and transcript do
 * not move. Detaching is "also show it over here", not "hand it over".
 */
function openDetachedWindow(
  conversationId: string,
  options: { collapseTools?: boolean } = {}
): void {
  const existing = detachedWindows.get(conversationId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    existing.webContents.send(IPC.menuCommand, 'focus-composer')
    return
  }

  const conversation = conversationStore.get(conversationId)
  if (!conversation) return

  const bounds = detachedBounds(detachedWindows.size)

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 380,
    minHeight: 420,
    show: false,
    title: conversation.title,
    icon: loadAppIcon(),
    ...chrome(38),
    webPreferences: rendererPrefs()
  })

  detachedWindows.set(conversationId, window)

  window.once('ready-to-show', () => {
    window.show()
    window.focus()
  })
  // After the renderer boots, ask it to focus the prompt (⌘⇧↵).
  window.webContents.once('did-finish-load', () => {
    window.webContents.send(IPC.menuCommand, 'focus-composer')
  })

  // Unlike the main window, closing here really does close: the conversation
  // is not going away, it just goes back to being a row in the sidebar.
  window.on('closed', () => {
    detachedWindows.delete(conversationId)
    if (ephemeralConversations.delete(conversationId)) {
      const stale = conversationStore.get(conversationId)
      if (stale && stale.messages.length === 0) {
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

  if (!app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[session:${event.level}] ${event.message}`)
    })
  }

  const query: Record<string, string> = { view: 'session', conversationId }
  if (options.collapseTools) query.collapseTools = '1'
  loadRenderer(window, query)
}

/**
 * File preview in its own window (files-panel.rpml pin 5).
 * Reopening the same path raises the existing window.
 */
function openFilePreviewWindow(filePath: string): void {
  const path = filePath.trim()
  if (!path) return

  const existing = previewWindows.get(path)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const anchor = BrowserWindow.getFocusedWindow() ?? mainWindow
  const area = (
    anchor && !anchor.isDestroyed() ? screen.getDisplayMatching(anchor.getBounds()) : screen.getPrimaryDisplay()
  ).workArea
  const width = Math.min(720, area.width - 80)
  const height = Math.min(640, area.height - 80)

  const window = new BrowserWindow({
    width,
    height,
    minWidth: 420,
    minHeight: 320,
    show: false,
    title: basename(path),
    icon: loadAppIcon(),
    // Match `.file-viewer-header` height so traffic lights sit on the drag bar.
    ...chrome(52),
    webPreferences: rendererPrefs({
      // Chromium's built-in PDF viewer.
      plugins: true
    })
  })

  previewWindows.set(path, window)
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    previewWindows.delete(path)
  })
  wirePreviewLifecycle(window, path)

  wireExternalLinks(window.webContents)

  if (!app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[preview:${event.level}] ${event.message}`)
    })
  }

  loadRenderer(window, { view: 'file-preview', path })
}

type TokenUsageAnchor = { x: number; y: number; width: number; height: number }

let tokenUsageCloseTimer: ReturnType<typeof setTimeout> | null = null

function cancelTokenUsageDismiss(): void {
  if (!tokenUsageCloseTimer) return
  clearTimeout(tokenUsageCloseTimer)
  tokenUsageCloseTimer = null
}

function dismissTokenUsageSoon(): void {
  if (tokenUsageCloseTimer) return
  tokenUsageCloseTimer = setTimeout(() => {
    tokenUsageCloseTimer = null
    if (tokenUsageWindow && !tokenUsageWindow.isDestroyed()) {
      tokenUsageWindow.close()
    }
  }, 120)
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
 * anchored to the ring, dismisses on blur. Not a full document window.
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

  // Clicking the ring while open toggles the popup closed.
  if (tokenUsageWindow && !tokenUsageWindow.isDestroyed() && tokenUsageWindow.isVisible()) {
    tokenUsageWindow.close()
    return
  }

  const width = 360
  const height = 520

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
    backgroundColor: windowBackground(),
    ...(IS_MAC ? { type: 'panel' as const, roundedCorners: true } : {}),
    webPreferences: rendererPrefs()
  })

  tokenUsageWindow.once('ready-to-show', () => {
    if (!tokenUsageWindow || tokenUsageWindow.isDestroyed()) return
    placeTokenUsagePopup(tokenUsageWindow, parent, anchor)
    tokenUsageWindow.show()
    tokenUsageWindow.focus()
  })
  tokenUsageWindow.on('blur', () => dismissTokenUsageSoon())
  tokenUsageWindow.on('closed', () => {
    cancelTokenUsageDismiss()
    tokenUsageWindow = null
  })

  wireExternalLinks(tokenUsageWindow.webContents)

  if (!app.isPackaged) {
    tokenUsageWindow.webContents.on('console-message', (event) => {
      console.log(`[token-usage:${event.level}] ${event.message}`)
    })
  }

  loadRenderer(tokenUsageWindow, { view: 'token-usage', conversationId: id })
}

/** ⌘⇧↵ from anywhere: a brand new conversation, straight into its own window. */
function newDetachedSession(): void {
  const conversation = conversationStore.create(
    resolveNewWorkdir(),
    settingsStore.get().defaultModel
  )
  ephemeralConversations.add(conversation.id)
  publishConversations()
  // ⌘⇧↵: tools panel starts collapsed (main-chat.rpml).
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

    const template: Electron.MenuItemConstructorOptions[] = items.map((item) => {
      if (item.separator) return { type: 'separator' }
      if (item.role) return { role: item.role, label: item.label }
      return {
        label: item.label ?? '',
        enabled: item.enabled !== false,
        type: item.checked === undefined ? 'normal' : 'checkbox',
        checked: item.checked,
        click: () => {
          chosen = item.id ?? null
        }
      }
    })

    Menu.buildFromTemplate(template).popup({
      window,
      x: position?.x,
      y: position?.y,
      callback: () => setImmediate(() => resolve(chosen))
    })
  })
}

/**
 * Development-only screenshot hook.
 *
 * `VAV_SNAPSHOT=<file> [VAV_SNAPSHOT_JS=<expr>] npm start` renders the window
 * off-screen, optionally drives the UI into a given state, writes a PNG and
 * exits — a way to review a screen without a display server or focus stealing.
 */
function installSnapshotHook(window: BrowserWindow): void {
  const target = process.env.VAV_SNAPSHOT
  if (!target) return

  const capture = async (): Promise<void> => {
    // Bootstrap + directory listing need a beat after first paint.
    await new Promise((resolve) => setTimeout(resolve, 3200))
    if (process.env.VAV_SNAPSHOT_JS) {
      try {
        const result = await window.webContents.executeJavaScript(process.env.VAV_SNAPSHOT_JS, true)
        console.log('[snapshot] script result:', result)
        await new Promise((resolve) => setTimeout(resolve, 600))
      } catch (err) {
        console.error('[snapshot] script failed', err)
      }
    }
    if (window.isMinimized()) window.restore()
    window.setSize(1440, 900)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const image = await window.webContents.capturePage()
    writeFileSync(target, image.toPNG())
    console.log(`[snapshot] wrote ${target}`)
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
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.show()
  mainWindow.focus()
  app.focus({ steal: true })
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
  let workdir = options.workdirArg
  if (workdir && !existsSync(workdir)) {
    toast = t('toast.pathMissing')
    workdir = null
  }
  const resolved = workdir ?? resolveNewWorkdir()
  if (workdir) {
    const settings = settingsStore.rememberWorkspaceDirectory(workdir, tmpdir())
    broadcast(IPC.settingsChanged, { ...settings, apiKeyPresent: secretStore.has() })
  }
  const conversation = conversationStore.create(resolved, settingsStore.get().defaultModel)
  publishConversations()
  const payload = {
    conversationId: conversation.id,
    toast,
    attachments: options.attachments?.length ? options.attachments : undefined
  }
  const send = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(IPC.cliOpen, payload)
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

/** Dock / Finder "Open With" — files attach; folders become the workdir. */
function openFromDroppedPaths(paths: string[]): void {
  const { workdir, attachments } = resolveOpenPaths(paths)
  openWorkspaceSession({ workdirArg: workdir, attachments })
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
    mainWindow.hide()
    return
  }
  app.focus({ steal: true })
  showMainWindow()
}

function registerGlobalHotkey(accelerator: string): boolean {
  globalShortcut.unregisterAll()
  if (!accelerator) return true
  try {
    return globalShortcut.register(accelerator, toggleMainWindow)
  } catch {
    return false
  }
}

function applyTheme(theme: AppSettings['theme']): void {
  nativeTheme.themeSource = theme
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
  return { ...settingsStore.get(), apiKeyPresent: secretStore.has() }
}

function registerIpc(): void {
  ipcMain.handle(IPC.bootstrap, (): Bootstrap => {
    const settings = currentSettings()
    setLocalePreference(settings.locale)
    const conversations = conversationStore.listMeta()
    const activeConversationId =
      conversations.find((c) => !c.archived)?.id ?? conversations[0]?.id ?? ''
    return {
      settings,
      resolvedLocale: currentLocale(),
      conversations,
      activeConversationId,
      apiKeyHint: secretStore.maskedHint(),
      platform: PLATFORM,
      home: app.getPath('home'),
      tmp: tmpdir(),
      about: {
        version: app.getVersion(),
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
    secretStore.clear()
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
    secretStore.set(key)
    broadcast(IPC.settingsChanged, currentSettings())
    return { hint: secretStore.maskedHint() }
  })

  ipcMain.handle(IPC.settingsRevealKey, () => secretStore.get())
  ipcMain.handle(IPC.settingsKeyHint, () => secretStore.maskedHint())

  ipcMain.handle(IPC.settingsValidateKey, async (_event, key: string) => {
    const settings = settingsStore.get()
    const effective = key?.trim() || secretStore.get()
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
      const model = options?.model?.trim() || settingsStore.get().defaultModel
      if (workdir) {
        const settings = settingsStore.rememberWorkspaceDirectory(workdir, tmpdir())
        broadcast(IPC.settingsChanged, { ...settings, apiKeyPresent: secretStore.has() })
      }
      const conversation = conversationStore.create(workdir, model)
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

  ipcMain.handle(IPC.convSetModel, (_event, id: string, model: string) => {
    conversationStore.updateMeta(id, { model })
    publishConversations()
    return conversationStore.listMeta()
  })

  const applyWorkingDirectory = (id: string, path: string): ConversationMeta[] => {
    conversationStore.updateMeta(id, { workingDirectory: path })
    agent.setWorkingDirectory(id, path)
    fileService.watchRoot(id, path)
    const settings = settingsStore.rememberWorkspaceDirectory(path, tmpdir())
    broadcast(IPC.settingsChanged, { ...settings, apiKeyPresent: secretStore.has() })
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
      quote?: import('@shared/types').QuoteDraft | null
    ) => {
      // Not awaited: the turn streams for as long as it needs, and the renderer
      // is driven entirely by turn events.
      void agent.run(id, text, attachments ?? [], quote ?? null)
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

  // --- files ---
  ipcMain.handle(
    IPC.filesList,
    (_event, path: string, sort: FileSortKey, ascending: boolean) =>
      fileService.listDirectory(path, sort, ascending)
  )
  ipcMain.handle(IPC.filesRead, (_event, path: string) => fileService.readTextFile(path))
  ipcMain.handle(IPC.filesQuickLook, (_event, path: string) => fileService.preview(path))
  ipcMain.handle(IPC.filesWatch, (_event, id: string, root: string | null) =>
    fileService.watchRoot(id, root)
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
  ipcMain.handle(IPC.filesInspect, (_event, path: string) => fileService.inspect(path))

  // --- pty ---
  ipcMain.handle(
    IPC.ptyCreate,
    (
      _event,
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      preferredId?: string
    ) =>
      ptyManager.create(
        conversationId,
        settingsStore.get().shell,
        cwd,
        cols,
        rows,
        preferredId
      )
  )
  ipcMain.handle(IPC.ptyWrite, (_event, tabId: string, data: string) =>
    ptyManager.write(tabId, data)
  )
  ipcMain.handle(IPC.ptyResize, (_event, tabId: string, cols: number, rows: number) =>
    ptyManager.resize(tabId, cols, rows)
  )
  ipcMain.handle(IPC.ptyKill, (_event, tabId: string) => ptyManager.kill(tabId))
  ipcMain.handle(IPC.ptyIsBusy, (_event, tabId: string) => ptyManager.isBusy(tabId))

  // --- window ---
  ipcMain.handle(IPC.windowSetTheme, (_event, theme: AppSettings['theme']) => applyTheme(theme))
  ipcMain.handle(IPC.windowShellPath, (_event, kind: ShellKind) => shellPath(kind))

  ipcMain.handle(IPC.windowOpenSettings, (_event, view?: SettingsView) => openSettingsWindow(view))
  ipcMain.handle(IPC.windowCloseSettings, () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close()
  })

  ipcMain.handle(IPC.windowOpenSession, (_event, id: string) => openDetachedWindow(id))
  ipcMain.handle(IPC.windowNewDetached, () => newDetachedSession())
  ipcMain.handle(IPC.windowOpenFilePreview, (_event, path: string) => openFilePreviewWindow(path))
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
    IPC.windowPopupMenu,
    (event, items: NativeMenuItem[], position?: { x: number; y: number }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      return window ? popupNativeMenu(window, items, position) : null
    }
  )
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
    const workdir = parseCliWorkdir(argv)
    if (workdir !== null || argv.includes('--cli-workdir')) {
      openFromCli(workdir)
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
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    enqueueOpenPath(filePath)
  })

  // On macOS closing the last window must not quit: background turns and PTYs
  // keep running, and the dock icon brings the window back.
  app.on('window-all-closed', () => {
    if (!IS_MAC) app.quit()
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
    protocol.handle('vav-local', (request) => {
      try {
        const filePath = decodeURIComponent(new URL(request.url).searchParams.get('path') ?? '')
        if (!filePath || !existsSync(filePath)) {
          return new Response('Not found', { status: 404 })
        }
        return net.fetch(pathToFileURL(filePath).href)
      } catch {
        return new Response('Bad request', { status: 400 })
      }
    })
    const settings = settingsStore.load()
    setLocalePreference(settings.locale ?? DEFAULT_SETTINGS.locale)
    conversationStore.load({ model: settings.defaultModel, mintWorkdir: resolveNewWorkdir })
    applyTheme(settings.theme ?? DEFAULT_SETTINGS.theme)
    nativeTheme.on('updated', repaintChrome)
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
    mainWindow.webContents.once('did-finish-load', () => showMainWindow())
    // Dock tiles cache aggressively for the rebranded Electron.dev bundle —
    // re-assert the PNG after the first window exists so the tile updates.
    applyDockIcon()

    const launchWorkdir = parseCliWorkdir(process.argv)
    if (process.env.VAV_SNAPSHOT) {
      // Marketing captures seed their own conversations; ignore argv path opens.
      appReadyForOpens = true
    } else if (launchWorkdir !== null || process.argv.includes('--cli-workdir')) {
      // Bare `vav` with the flag but empty value still goes through openFromCli.
      appReadyForOpens = true
      openFromCli(launchWorkdir)
    } else {
      // Dock cold-start / Finder "Open With": queued open-file + argv paths.
      flushPendingOpens(parseOpenPathsFromArgv(process.argv))
    }

    // Dock click restores the single main window instead of spawning another.
    app.on('activate', showMainWindow)
  })
}
