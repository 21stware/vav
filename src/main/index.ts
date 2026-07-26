import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  shell
} from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { APP_NAME, applyBranding, loadAppIcon } from './brand'
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
import { codeFonts, type Platform } from '@shared/platform'

const PLATFORM = process.platform as Platform
const IS_MAC = PLATFORM === 'darwin'

// Branding before ready so the menu bar reads "vav" instead of "Electron".
applyBranding()

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
/** At most one standalone window per conversation (sidebar spec, 双击). */
const detachedWindows = new Map<string, BrowserWindow>()
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

const agent = new AgentRuntime({
  conversations: conversationStore,
  settings: settingsStore,
  secrets: secretStore,
  files: fileService,
  emit: (event: TurnEvent) => send(IPC.agentEvent, event)
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
  if (IS_MAC) {
    return {
      titleBarStyle: 'hiddenInset',
      // Vertically centred on the title bar, so the traffic lights sit on the
      // same line as the buttons at the other end of it.
      trafficLightPosition: { x: 12, y: Math.round((barHeight - 12) / 2) },
      vibrancy: 'sidebar',
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

function createWindow(): BrowserWindow {
  const icon = loadAppIcon()
  const window = new BrowserWindow({
    width: 720,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    icon,
    ...chrome(52),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // ⌘W and the red traffic light only hide the window: agent turns and PTYs
  // must survive (README §2.9). Only an explicit Quit tears things down.
  //
  // Windows has no dock to bring a hidden window back from, so there the close
  // button means what it says and the teardown in `before-quit` runs instead.
  if (IS_MAC) {
    window.on('close', (event) => {
      if (quitting) return
      event.preventDefault()
      window.hide()
    })
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

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
    installSnapshotHook(window)
  }

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
    title: '设置',
    icon: loadAppIcon(),
    ...chrome(38),
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  settingsWindow.once('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

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

  const width = Math.min(460, area.width - 40)
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
function openDetachedWindow(conversationId: string): void {
  const existing = detachedWindows.get(conversationId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const conversation = conversationStore.get(conversationId)
  if (!conversation) return

  const bounds = detachedBounds(detachedWindows.size)

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 360,
    minHeight: 420,
    show: false,
    title: conversation.title,
    icon: loadAppIcon(),
    ...chrome(38),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  detachedWindows.set(conversationId, window)

  window.once('ready-to-show', () => window.show())

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

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged) {
    window.webContents.on('console-message', (event) => {
      console.log(`[session:${event.level}] ${event.message}`)
    })
  }

  loadRenderer(window, { view: 'session', conversationId })
}

/** ⌘⇧↵ from anywhere: a brand new conversation, straight into its own window. */
function newDetachedSession(): void {
  const conversation = conversationStore.create(
    resolveNewWorkdir(),
    settingsStore.get().defaultModel
  )
  ephemeralConversations.add(conversation.id)
  publishConversations()
  openDetachedWindow(conversation.id)
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
  window.webContents.once('did-finish-load', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const script = process.env.VAV_SNAPSHOT_JS
    if (script) {
      try {
        const result = await window.webContents.executeJavaScript(script, true)
        if (result !== undefined) console.log('[snapshot] script result:', result)
      } catch (err) {
        console.error('[snapshot] script failed', err)
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    const image = await window.webContents.capturePage()
    writeFileSync(target, image.toPNG())
    console.log(`[snapshot] wrote ${target}`)
    quitting = true
    app.quit()
  })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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
    const conversations = conversationStore.listMeta()
    return {
      settings: currentSettings(),
      conversations,
      activeConversationId: conversations[0]?.id ?? '',
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
    const settings = currentSettings()
    broadcast(IPC.settingsChanged, settings)
    return settings
  })

  ipcMain.handle(IPC.settingsReset, () => {
    secretStore.clear()
    const next = settingsStore.reset()
    applyTheme(next.theme)
    registerGlobalHotkey(next.globalHotkey)
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
    if (!effective) return { ok: false, message: '请先填写 API Key' }
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

  // --- conversations ---
  ipcMain.handle(IPC.convList, () => conversationStore.listMeta())
  ipcMain.handle(IPC.convGet, (_event, id: string) => conversationStore.get(id) ?? null)

  ipcMain.handle(IPC.convCreate, (): ConversationMeta => {
    const conversation = conversationStore.create(
      resolveNewWorkdir(),
      settingsStore.get().defaultModel
    )
    const { messages: _messages, ...meta } = conversation
    void _messages
    publishConversations()
    return meta
  })

  ipcMain.handle(IPC.convRename, (_event, id: string, title: string) => {
    const next = title.trim() || '新会话'
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

  ipcMain.handle(IPC.convContinueNew, (_event, id: string, messageId: string) => {
    const conversation = conversationStore.branchToNewConversation(id, messageId)
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

  ipcMain.handle(IPC.convSetWorkdir, (_event, id: string, path: string) => {
    conversationStore.updateMeta(id, { workingDirectory: path })
    agent.setWorkingDirectory(id, path)
    fileService.watchRoot(id, path)
    return conversationStore.listMeta()
  })

  ipcMain.handle(IPC.convPickWorkdir, async (_event, id: string) => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    conversationStore.updateMeta(id, { workingDirectory: path })
    agent.setWorkingDirectory(id, path)
    fileService.watchRoot(id, path)
    return conversationStore.listMeta()
  })

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
  ipcMain.handle(IPC.agentSend, (_event, id: string, text: string, attachments: string[]) => {
    // Not awaited: the turn streams for as long as it needs, and the renderer
    // is driven entirely by turn events.
    void agent.run(id, text, attachments ?? [])
  })
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

  // --- pty ---
  ipcMain.handle(
    IPC.ptyCreate,
    (_event, conversationId: string, cwd: string, cols: number, rows: number) =>
      ptyManager.create(conversationId, settingsStore.get().shell, cwd, cols, rows)
  )
  ipcMain.handle(IPC.ptyWrite, (_event, tabId: string, data: string) =>
    ptyManager.write(tabId, data)
  )
  ipcMain.handle(IPC.ptyResize, (_event, tabId: string, cols: number, rows: number) =>
    ptyManager.resize(tabId, cols, rows)
  )
  ipcMain.handle(IPC.ptyKill, (_event, tabId: string) => ptyManager.kill(tabId))

  // --- window ---
  ipcMain.handle(IPC.windowSetTheme, (_event, theme: AppSettings['theme']) => applyTheme(theme))
  ipcMain.handle(IPC.windowShellPath, (_event, kind: ShellKind) => shellPath(kind))

  ipcMain.handle(IPC.windowOpenSettings, (_event, view?: SettingsView) => openSettingsWindow(view))
  ipcMain.handle(IPC.windowCloseSettings, () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close()
  })

  ipcMain.handle(IPC.windowOpenSession, (_event, id: string) => openDetachedWindow(id))
  ipcMain.handle(IPC.windowNewDetached, () => newDetachedSession())

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
  app.quit()
} else {
  app.on('second-instance', showMainWindow)

  app.whenReady().then(() => {
    applyBranding()
    const settings = settingsStore.load()
    conversationStore.load({ model: settings.defaultModel, mintWorkdir: resolveNewWorkdir })
    applyTheme(settings.theme ?? DEFAULT_SETTINGS.theme)
    nativeTheme.on('updated', repaintChrome)
    registerGlobalHotkey(settings.globalHotkey)
    registerIpc()
    Menu.setApplicationMenu(
      buildAppMenu(sendMenuCommand, () => openSettingsWindow(), newDetachedSession)
    )

    mainWindow = createWindow()

    // Dock click restores the single main window instead of spawning another.
    app.on('activate', showMainWindow)
  })
}

// On macOS closing the last window must not quit: background turns and PTYs keep
// running, and the dock icon brings the window back.
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
