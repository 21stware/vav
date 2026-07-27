import type {
  AboutInfo,
  AppLocale,
  AppSettings,
  Conversation,
  ConversationMeta,
  DirectoryListing,
  FileSortKey,
  QuoteDraft,
  ShellKind,
  TurnEvent,
  TurnStatus,
  ValidateKeyResult
} from './types'
import type { Platform } from './platform'

export interface Bootstrap {
  settings: AppSettings
  /** Resolved from settings.locale + OS; same value main uses for menus. */
  resolvedLocale: AppLocale
  conversations: ConversationMeta[]
  activeConversationId: string
  apiKeyHint: string | null
  platform: Platform
  home: string
  tmp: string
  about: AboutInfo
}

export interface PtyDataEvent {
  tabId: string
  data: string
}

export interface FsDirtyEvent {
  conversationId: string
  dirs: string[]
}

/** A row in a native popup menu. `role` defers the action to Electron itself. */
export interface NativeMenuItem {
  /** Echoed back when this row is chosen; omit for separators and roles. */
  id?: string
  label?: string
  separator?: boolean
  enabled?: boolean
  checked?: boolean
  role?: 'copy' | 'cut' | 'paste' | 'selectAll' | 'undo' | 'redo'
}

export type SettingsView =
  | 'api'
  | 'workspace'
  | 'appearance'
  | 'notifications'
  | 'cli'
  | 'about'

export type CliInstallLocation = '/usr/local/bin' | '~/.local/bin'

export interface CliStatus {
  installed: boolean
  path: string | null
  preferredLocation: CliInstallLocation
  pathInPath: boolean
  version: string | null
  installedAt: number | null
  error?: string
}

export interface CreateConversationOptions {
  /** Absolute workdir; omit to use the Settings default / Temporary mint. */
  workingDirectory?: string | null
  /** Defaults to Settings.defaultModel when omitted. */
  model?: string
}

export interface CliOpenEvent {
  conversationId: string
  toast: string | null
  /** Absolute file paths to seed the composer attachment strip (Dock / CLI file open). */
  attachments?: string[]
}

export type FilePreviewKind = 'text' | 'csv' | 'image' | 'pdf' | 'audio' | 'video' | 'binary'

export interface FileInspectResult {
  path: string
  name: string
  size: number
  kind: FilePreviewKind
  mime: string
  error?: string
  /** UTF-8 text when kind is text/csv. */
  text?: string
  truncated?: boolean
  /** data: URL for image/audio/video under the size cap. */
  dataUrl?: string
  lineCount?: number
}

/** The full renderer-facing API, exposed on `window.vav` by the preload script. */
export interface VavApi {
  /**
   * Synchronous, unlike everything else here: keyboard hints and title-bar
   * metrics are decided while modules load, long before bootstrap resolves.
   */
  platform: Platform

  bootstrap(): Promise<Bootstrap>

  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
    setApiKey(key: string): Promise<{ hint: string | null }>
    revealApiKey(): Promise<string | null>
    apiKeyHint(): Promise<string | null>
    validateKey(key: string): Promise<ValidateKeyResult>
    availableFonts(): Promise<string[]>
    pickDirectory(): Promise<string | null>
    /** `ok: false` means the accelerator is already taken by another app. */
    setHotkey(accelerator: string): Promise<{ ok: boolean; settings: AppSettings }>
    cliStatus(): Promise<CliStatus>
    cliSetLocation(location: CliInstallLocation): Promise<CliStatus>
    cliInstall(): Promise<CliStatus>
    cliUninstall(): Promise<CliStatus>
  }

  conversations: {
    list(): Promise<ConversationMeta[]>
    get(id: string): Promise<Conversation | null>
    create(options?: CreateConversationOptions): Promise<ConversationMeta>
    rename(id: string, title: string): Promise<ConversationMeta[]>
    setModel(id: string, model: string): Promise<ConversationMeta[]>
    setWorkingDirectory(id: string, path: string): Promise<ConversationMeta[]>
    pickWorkingDirectory(id: string): Promise<ConversationMeta[] | null>
    /** Move a Temporary Workspace folder to a permanent path. */
    locateWorkspace(
      id: string,
      destinationDir: string,
      name: string
    ): Promise<{ ok: true; conversations: ConversationMeta[] } | { ok: false; error: string }>
    remove(ids: string[]): Promise<{ removed: string[]; conversations: ConversationMeta[] }>
    revealInFinder(path: string): Promise<void>
    copyToClipboard(text: string): Promise<void>
    /** Shows the variant `messageId` belongs to; resolves to the new leaf. */
    selectBranch(conversationId: string, messageId: string): Promise<string | null>
    /** Points the thread at an exact node — used for not-yet-written branches. */
    setLeaf(conversationId: string, leafId: string): Promise<void>
    /** Pinned rows sort above every time group. */
    setPinned(id: string, pinned: boolean): Promise<ConversationMeta[]>
    /** Archive / restore; refuses to archive the last active conversation. */
    setArchived(id: string, archived: boolean): Promise<ConversationMeta[]>
    /** Per-conversation Auto / Bypass / Edit tool approval policy. */
    setApprovalMode(
      id: string,
      mode: 'auto' | 'bypass' | 'edit'
    ): Promise<ConversationMeta[]>
    /** Deep-copies the thread up to `messageId` into a new conversation. */
    continueInNewSession(id: string, messageId: string): Promise<ConversationMeta | null>
    /** Deep-copies the whole conversation tree into a new session. */
    duplicate(id: string): Promise<ConversationMeta | null>
    /** Any window changing the list must reach the others. */
    onChanged(handler: (conversations: ConversationMeta[]) => void): () => void
  }

  agent: {
    send(
      conversationId: string,
      text: string,
      attachments: string[],
      quote?: QuoteDraft | null
    ): Promise<void>
    cancel(conversationId: string): Promise<void>
    answer(conversationId: string, toolCallId: string, answer: string): Promise<void>
    status(conversationId: string): Promise<TurnStatus>
    /** Another version of this reply, as a sibling rather than an appended one. */
    regenerate(conversationId: string, messageId: string): Promise<void>
    /** Rewrites a prompt and answers the new wording on a fresh branch. */
    editUserMessage(conversationId: string, messageId: string, text: string): Promise<void>
    /** Opens a sibling branch at `messageId` without sending anything yet. */
    fork(conversationId: string, messageId: string): Promise<string | null>
    onEvent(handler: (event: TurnEvent) => void): () => void
  }

  files: {
    list(path: string, sort: FileSortKey, ascending: boolean): Promise<DirectoryListing>
    read(path: string): Promise<{ content: string; truncated: boolean; error?: string }>
    quickLook(path: string): Promise<void>
    watch(conversationId: string, root: string | null): Promise<void>
    onDirty(handler: (event: FsDirtyEvent) => void): () => void
    /** Resolves a dropped File to its absolute path. */
    pathForFile(file: File): string
    /** Save dialog + write text contents (markdown Copy/Save, file viewer). */
    saveAs(
      defaultName: string,
      content: string
    ): Promise<{ ok: true; path: string } | { ok: false; cancelled?: boolean; error?: string }>
    rename(
      path: string,
      newName: string
    ): Promise<{ ok: true; path: string } | { ok: false; error: string }>
    trash(paths: string[]): Promise<{ ok: true } | { ok: false; error: string }>
    /** Metadata + optional data URL for in-app preview. */
    inspect(path: string): Promise<FileInspectResult>
  }

  pty: {
    create(
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      preferredId?: string
    ): Promise<string>
    write(tabId: string, data: string): Promise<void>
    resize(tabId: string, cols: number, rows: number): Promise<void>
    kill(tabId: string): Promise<void>
    /** Whether the tab's shell currently has a running (child) command. */
    isBusy(tabId: string): Promise<boolean>
    onData(handler: (event: PtyDataEvent) => void): () => void
    onExit(handler: (tabId: string) => void): () => void
  }

  window: {
    /** Applies the resolved light/dark appearance to the native window chrome. */
    setTheme(theme: AppSettings['theme']): Promise<void>
    shellPath(shell: ShellKind): Promise<string>
    /** Settings live in their own window, not a sheet over the transcript. */
    openSettings(view?: SettingsView): Promise<void>
    closeSettings(): Promise<void>
    /** Opens (or raises) the standalone window for one conversation. */
    openSession(conversationId: string): Promise<void>
    /** Fresh conversation in its own window — the ⌘⇧↵ path. */
    newDetachedSession(): Promise<void>
    /** Opens (or raises) a standalone file preview window for `path`. */
    openFilePreview(path: string): Promise<void>
    /**
     * Native context-window popup (panel shell, not a full document window).
     * `anchor` is the ring’s rect in the sender window’s content coordinates.
     */
    openTokenUsage(
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ): Promise<void>
    onTokenUsageView(handler: (conversationId: string) => void): () => void
    /** Relaunch the app (e.g. after Dock-hide preference). */
    relaunch(): Promise<void>
    /** Resolves to the chosen row's id, or null if the menu was dismissed. */
    popupMenu(
      items: NativeMenuItem[],
      position?: { x: number; y: number }
    ): Promise<string | null>
  }

  notifications: {
    /** System notification authorization for the settings hint. */
    permission(): Promise<'granted' | 'denied' | 'unknown'>
  }

  dialog: {
    /** Native alert (single button). */
    alert(options: {
      title: string
      message: string
      confirmLabel?: string
    }): Promise<void>
    /** Native confirm; resolves true when the confirm button is chosen. */
    confirm(options: {
      title: string
      message: string
      confirmLabel?: string
      cancelLabel?: string
      destructive?: boolean
    }): Promise<boolean>
  }

  /** Menu-driven commands (⌘N, ⌘F, ⌘, …) forwarded from the application menu. */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  /** Any window changing settings must reach the others. */
  onSettingsChanged(handler: (settings: AppSettings) => void): () => void
  /** Category to show, pushed when ⌘, hits an already-open settings window. */
  onSettingsView(handler: (view: SettingsView) => void): () => void
  /** `vav /path` from the installed CLI — select the minted conversation. */
  onCliOpen(handler: (event: CliOpenEvent) => void): () => void
  /** Native fullscreen entered/left — used to collapse traffic-light inset. */
  onFullscreen(handler: (fullscreen: boolean) => void): () => void
}

export type MenuCommand =
  | 'new-conversation'
  | 'focus-composer'
  | 'find'
  | 'find-next'
  | 'find-previous'
  | 'open-settings'
  | 'toggle-sidebar'
  | 'toggle-tools-panel'
  | 'toggle-panel-segment'
  | 'new-terminal'
  | 'switch-workdir'
  | 'send'
  /** ⌘1…⌘9 — slot 1 = Workspace; 2+ = bash tabs in order (Agent first). */
  | 'focus-tools-1'
  | 'focus-tools-2'
  | 'focus-tools-3'
  | 'focus-tools-4'
  | 'focus-tools-5'
  | 'focus-tools-6'
  | 'focus-tools-7'
  | 'focus-tools-8'
  | 'focus-tools-9'

export const IPC = {
  bootstrap: 'vav:bootstrap',

  settingsGet: 'vav:settings:get',
  settingsUpdate: 'vav:settings:update',
  settingsReset: 'vav:settings:reset',
  settingsSetKey: 'vav:settings:set-key',
  settingsRevealKey: 'vav:settings:reveal-key',
  settingsKeyHint: 'vav:settings:key-hint',
  settingsValidateKey: 'vav:settings:validate-key',
  settingsFonts: 'vav:settings:fonts',
  settingsPickDirectory: 'vav:settings:pick-directory',
  settingsSetHotkey: 'vav:settings:set-hotkey',
  settingsCliStatus: 'vav:settings:cli-status',
  settingsCliSetLocation: 'vav:settings:cli-set-location',
  settingsCliInstall: 'vav:settings:cli-install',
  settingsCliUninstall: 'vav:settings:cli-uninstall',

  convList: 'vav:conv:list',
  convGet: 'vav:conv:get',
  convCreate: 'vav:conv:create',
  convRename: 'vav:conv:rename',
  convSetModel: 'vav:conv:set-model',
  convSetWorkdir: 'vav:conv:set-workdir',
  convPickWorkdir: 'vav:conv:pick-workdir',
  convLocateWorkspace: 'vav:conv:locate-workspace',
  convRemove: 'vav:conv:remove',
  convReveal: 'vav:conv:reveal',
  convCopy: 'vav:conv:copy',
  convSelectBranch: 'vav:conv:select-branch',
  convSetLeaf: 'vav:conv:set-leaf',
  convSetPinned: 'vav:conv:set-pinned',
  convSetArchived: 'vav:conv:set-archived',
  convSetApprovalMode: 'vav:conv:set-approval-mode',
  convContinueNew: 'vav:conv:continue-new',
  convDuplicate: 'vav:conv:duplicate',
  convChanged: 'vav:conv:changed',

  agentSend: 'vav:agent:send',
  agentCancel: 'vav:agent:cancel',
  agentAnswer: 'vav:agent:answer',
  agentStatus: 'vav:agent:status',
  agentRegenerate: 'vav:agent:regenerate',
  agentEditUser: 'vav:agent:edit-user',
  agentFork: 'vav:agent:fork',
  agentEvent: 'vav:agent:event',

  filesList: 'vav:files:list',
  filesRead: 'vav:files:read',
  filesQuickLook: 'vav:files:quick-look',
  filesWatch: 'vav:files:watch',
  filesDirty: 'vav:files:dirty',
  filesSaveAs: 'vav:files:save-as',
  filesRename: 'vav:files:rename',
  filesTrash: 'vav:files:trash',
  filesInspect: 'vav:files:inspect',

  ptyCreate: 'vav:pty:create',
  ptyWrite: 'vav:pty:write',
  ptyResize: 'vav:pty:resize',
  ptyKill: 'vav:pty:kill',
  ptyIsBusy: 'vav:pty:is-busy',
  ptyData: 'vav:pty:data',
  ptyExit: 'vav:pty:exit',

  windowSetTheme: 'vav:window:set-theme',
  windowShellPath: 'vav:window:shell-path',
  windowOpenSettings: 'vav:window:open-settings',
  windowCloseSettings: 'vav:window:close-settings',
  windowPopupMenu: 'vav:window:popup-menu',
  windowOpenSession: 'vav:window:open-session',
  windowNewDetached: 'vav:window:new-detached',
  windowOpenFilePreview: 'vav:window:open-file-preview',
  windowOpenTokenUsage: 'vav:window:open-token-usage',
  tokenUsageView: 'vav:token-usage:view',
  windowRelaunch: 'vav:window:relaunch',
  windowFullscreen: 'vav:window:fullscreen',
  notificationsPermission: 'vav:notifications:permission',
  dialogAlert: 'vav:dialog:alert',
  dialogConfirm: 'vav:dialog:confirm',

  menuCommand: 'vav:menu:command',
  settingsChanged: 'vav:settings:changed',
  settingsView: 'vav:settings:view',
  cliOpen: 'vav:cli:open'
} as const
