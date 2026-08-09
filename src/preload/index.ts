import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type MenuCommand,
  type NativeMenuItem,
  type CliInstallLocation,
  type SettingsView,
  type TokenUsageViewPayload,
  type VavApi
} from '@shared/ipc'
import type { AppSettings, FileSortKey, ShellKind } from '@shared/types'
import type { Platform } from '@shared/platform'

/** Subscribes to a main→renderer channel and returns an unsubscribe function. */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api: VavApi = {
  platform: process.platform as Platform,

  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),

  secrets: {
    status: () => ipcRenderer.invoke(IPC.secretsStatus),
    unlock: () => ipcRenderer.invoke(IPC.secretsUnlock)
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    reset: () => ipcRenderer.invoke(IPC.settingsReset),
    setApiKey: (key: string) => ipcRenderer.invoke(IPC.settingsSetKey, key),
    revealApiKey: () => ipcRenderer.invoke(IPC.settingsRevealKey),
    apiKeyHint: () => ipcRenderer.invoke(IPC.settingsKeyHint),
    setBraveSearchKey: (key: string) => ipcRenderer.invoke(IPC.settingsSetBraveSearchKey, key),
    braveSearchKeyHint: () => ipcRenderer.invoke(IPC.settingsBraveSearchKeyHint),
    validateKey: (key: string) => ipcRenderer.invoke(IPC.settingsValidateKey, key),
    availableFonts: () => ipcRenderer.invoke(IPC.settingsFonts),
    pickDirectory: () => ipcRenderer.invoke(IPC.settingsPickDirectory),
    setHotkey: (accelerator: string) => ipcRenderer.invoke(IPC.settingsSetHotkey, accelerator),
    cliStatus: () => ipcRenderer.invoke(IPC.settingsCliStatus),
    cliSetLocation: (location: CliInstallLocation) =>
      ipcRenderer.invoke(IPC.settingsCliSetLocation, location),
    cliInstall: () => ipcRenderer.invoke(IPC.settingsCliInstall),
    cliUninstall: () => ipcRenderer.invoke(IPC.settingsCliUninstall),
    fileAssociations: () => ipcRenderer.invoke(IPC.settingsFileAssociations),
    fileAssociationForPath: (path: string) =>
      ipcRenderer.invoke(IPC.settingsFileAssociationForPath, path),
    setFileAssociation: (formatId: string) =>
      ipcRenderer.invoke(IPC.settingsSetFileAssociation, formatId),
    unsetFileAssociation: (formatId: string) =>
      ipcRenderer.invoke(IPC.settingsUnsetFileAssociation, formatId),
    registerAllFileAssociations: () =>
      ipcRenderer.invoke(IPC.settingsRegisterAllFileAssociations)
  },

  conversations: {
    list: () => ipcRenderer.invoke(IPC.convList),
    get: (id: string) => ipcRenderer.invoke(IPC.convGet, id),
    create: (options?: import('@shared/ipc').CreateConversationOptions) =>
      ipcRenderer.invoke(IPC.convCreate, options),
    rename: (id: string, title: string) => ipcRenderer.invoke(IPC.convRename, id, title),
    setModel: (id: string, model: string) => ipcRenderer.invoke(IPC.convSetModel, id, model),
    setAgentBinaryName: (id: string, agentBinaryName: string | null) =>
      ipcRenderer.invoke(IPC.convSetAgentBinary, id, agentBinaryName),
    setFocusedFile: (id: string, path: string | null) =>
      ipcRenderer.invoke(IPC.convSetFocusedFile, id, path),
    setWorkingDirectory: (id: string, path: string) =>
      ipcRenderer.invoke(IPC.convSetWorkdir, id, path),
    pickWorkingDirectory: (id: string) => ipcRenderer.invoke(IPC.convPickWorkdir, id),
    locateWorkspace: (id: string, destinationDir: string, name: string) =>
      ipcRenderer.invoke(IPC.convLocateWorkspace, id, destinationDir, name),
    remove: (ids: string[]) => ipcRenderer.invoke(IPC.convRemove, ids),
    revealInFinder: (path: string) => ipcRenderer.invoke(IPC.convReveal, path),
    copyToClipboard: (text: string) => ipcRenderer.invoke(IPC.convCopy, text),
    copyImageToClipboard: (base64Png: string) =>
      ipcRenderer.invoke(IPC.convCopyImage, base64Png) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
    selectBranch: (id: string, messageId: string) =>
      ipcRenderer.invoke(IPC.convSelectBranch, id, messageId),
    setLeaf: (id: string, leafId: string) => ipcRenderer.invoke(IPC.convSetLeaf, id, leafId),
    setPinned: (id: string, pinned: boolean) =>
      ipcRenderer.invoke(IPC.convSetPinned, id, pinned),
    setArchived: (id: string, archived: boolean) =>
      ipcRenderer.invoke(IPC.convSetArchived, id, archived),
    setApprovalMode: (id: string, mode) =>
      ipcRenderer.invoke(IPC.convSetApprovalMode, id, mode),
    continueInNewSession: (id: string, messageId: string) =>
      ipcRenderer.invoke(IPC.convContinueNew, id, messageId),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.convDuplicate, id),
    exportPack: (ids: string[]) =>
      ipcRenderer.invoke(IPC.convExportPack, ids) as Promise<
        | { ok: true; path: string; blobCount: number; conversationCount: number }
        | { ok: false; cancelled?: boolean; error?: string }
      >,
    importPack: () =>
      ipcRenderer.invoke(IPC.convImportPack) as Promise<
        | { ok: true; importedIds: string[]; path: string; blobCount: number }
        | { ok: false; cancelled?: boolean; error?: string }
      >,
    onChanged: (handler) => subscribe(IPC.convChanged, handler)
  },

  agent: {
    send: (
      id: string,
      text: string,
      attachments: string[],
      quote?: import('@shared/types').QuoteDraft | null,
      contextBlocks?: import('@shared/types').PreviewRef[] | null,
      contextFile?: string | null
    ) =>
      ipcRenderer.invoke(
        IPC.agentSend,
        id,
        text,
        attachments,
        quote ?? null,
        contextBlocks ?? null,
        contextFile ?? null
      ),
    cancel: (id: string) => ipcRenderer.invoke(IPC.agentCancel, id),
    answer: (id: string, toolCallId: string, answer: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.agentAnswer, id, toolCallId, answer),
    status: (id: string) => ipcRenderer.invoke(IPC.agentStatus, id),
    regenerate: (id: string, messageId: string) =>
      ipcRenderer.invoke(IPC.agentRegenerate, id, messageId),
    editUserMessage: (id: string, messageId: string, text: string) =>
      ipcRenderer.invoke(IPC.agentEditUser, id, messageId, text),
    fork: (id: string, messageId: string) => ipcRenderer.invoke(IPC.agentFork, id, messageId),
    compact: (id, options) => ipcRenderer.invoke(IPC.agentCompact, id, options),
    clearCompaction: (id, leafId) => ipcRenderer.invoke(IPC.agentClearCompaction, id, leafId),
    onEvent: (handler) => subscribe(IPC.agentEvent, handler),
    onCompactionsChanged: (handler) =>
      subscribe<{ conversationId: string; compactions: import('@shared/types').LeafCompaction[] }>(
        IPC.compactionsChanged,
        handler
      )
  },

  files: {
    list: (path: string, sort: FileSortKey, ascending: boolean) =>
      ipcRenderer.invoke(IPC.filesList, path, sort, ascending),
    read: (path: string) => ipcRenderer.invoke(IPC.filesRead, path),
    readTextWindow: (path: string, opts?: { startByte?: number; maxBytes?: number }) =>
      ipcRenderer.invoke(IPC.filesReadTextWindow, path, opts),
    readBinary: (path: string) => ipcRenderer.invoke(IPC.filesReadBinary, path),
    writeBinary: (path: string, base64: string) =>
      ipcRenderer.invoke(IPC.filesWriteBinary, path, base64),
    write: (path: string, content: string) => ipcRenderer.invoke(IPC.filesWrite, path, content),
    quickLook: (path: string) => ipcRenderer.invoke(IPC.filesQuickLook, path),
    openWithDefault: (path: string) => ipcRenderer.invoke(IPC.filesOpenWithDefault, path),
    watch: (conversationId: string, root: string | null) =>
      ipcRenderer.invoke(IPC.filesWatch, conversationId, root),
    onDirty: (handler) => subscribe(IPC.filesDirty, handler),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    saveAs: (defaultName: string, content: string) =>
      ipcRenderer.invoke(IPC.filesSaveAs, defaultName, content),
    rename: (path: string, newName: string) => ipcRenderer.invoke(IPC.filesRename, path, newName),
    trash: (paths: string[]) => ipcRenderer.invoke(IPC.filesTrash, paths),
    inspect: (path: string) => ipcRenderer.invoke(IPC.filesInspect, path),
    dbQuery: (path: string, table: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke(IPC.filesDbQuery, path, table, offset ?? 0, limit ?? 100),
    parseBlocks: (path: string, text: string) =>
      ipcRenderer.invoke(IPC.filesParseBlocks, path, text)
  },

  fileSessions: {
    open: (path: string) => ipcRenderer.invoke(IPC.fileSessionsOpen, path),
    create: (path: string) => ipcRenderer.invoke(IPC.fileSessionsCreate, path),
    setActive: (fileId: string, sessionId: string) =>
      ipcRenderer.invoke(IPC.fileSessionsSetActive, fileId, sessionId),
    list: (fileId: string) => ipcRenderer.invoke(IPC.fileSessionsList, fileId),
    listAll: () => ipcRenderer.invoke(IPC.fileSessionsListAll),
    resolve: (fileId: string) => ipcRenderer.invoke(IPC.fileSessionsResolve, fileId),
    setReadOnly: (sessionId: string, readOnly: boolean) =>
      ipcRenderer.invoke(IPC.fileSessionsSetReadOnly, sessionId, readOnly),
    rename: (fileId: string, sessionId: string, title: string) =>
      ipcRenderer.invoke(IPC.fileSessionsRename, fileId, sessionId, title),
    delete: (fileId: string, sessionIds: string[]) =>
      ipcRenderer.invoke(IPC.fileSessionsDelete, fileId, sessionIds),
    forceDelete: (fileId: string, sessionIds: string[]) =>
      ipcRenderer.invoke(IPC.fileSessionsForceDelete, fileId, sessionIds)
  },

  agents: {
    resolveBinary: (candidates: string[], force?: boolean) =>
      ipcRenderer.invoke(IPC.agentsResolveBinary, candidates, force === true)
  },

  pty: {
    create: (
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      options?: import('@shared/ipc').PtyCreateOptions | string
    ) => ipcRenderer.invoke(IPC.ptyCreate, conversationId, cwd, cols, rows, options),
    // One-way: keyboard / wheel / paste must not wait for main ACK.
    write: (tabId: string, data: string) => {
      ipcRenderer.send(IPC.ptyWrite, tabId, data)
    },
    resize: (tabId: string, cols: number, rows: number, force?: boolean) => {
      ipcRenderer.send(IPC.ptyResize, tabId, cols, rows, force === true)
    },
    kill: (tabId: string) => ipcRenderer.invoke(IPC.ptyKill, tabId),
    isBusy: (tabId: string) => ipcRenderer.invoke(IPC.ptyIsBusy, tabId),
    list: (conversationId: string) => ipcRenderer.invoke(IPC.ptyList, conversationId),
    replay: (tabId: string) => ipcRenderer.invoke(IPC.ptyReplay, tabId),
    onData: (handler) => subscribe(IPC.ptyData, handler),
    onExit: (handler) => subscribe<string>(IPC.ptyExit, handler),
    onChanged: (handler) => subscribe(IPC.ptyChanged, handler),
    onStatus: (handler) => subscribe(IPC.ptyStatus, handler)
  },

  window: {
    setTheme: (theme: AppSettings['theme']) => ipcRenderer.invoke(IPC.windowSetTheme, theme),
    getAccentColor: () => ipcRenderer.invoke(IPC.windowGetAccentColor) as Promise<string>,
    onAccentColorChanged: (handler) => subscribe<string>(IPC.accentColorChanged, handler),
    shellPath: (kind: ShellKind) => ipcRenderer.invoke(IPC.windowShellPath, kind),
    openSettings: (view?: SettingsView) => ipcRenderer.invoke(IPC.windowOpenSettings, view),
    closeSettings: () => ipcRenderer.invoke(IPC.windowCloseSettings),
    popupMenu: (items: NativeMenuItem[], position?: { x: number; y: number }) =>
      ipcRenderer.invoke(IPC.windowPopupMenu, items, position),
    openSession: (conversationId: string) =>
      ipcRenderer.invoke(IPC.windowOpenSession, conversationId),
    revealInList: (conversationId: string) =>
      ipcRenderer.invoke(IPC.windowRevealInList, conversationId),
    closeDetachedSession: (conversationId: string) =>
      ipcRenderer.invoke(IPC.windowCloseDetached, conversationId),
    newDetachedSession: () => ipcRenderer.invoke(IPC.windowNewDetached),
    listDetachedSessions: () => ipcRenderer.invoke(IPC.windowListDetached),
    onDetachedChanged: (handler) =>
      subscribe<string[]>(IPC.windowDetachedChanged, handler),
    openFilePreview: (path, options) =>
      ipcRenderer.invoke(IPC.windowOpenFilePreview, path, options),
    setPreviewCloseGuard: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.previewSetCloseGuard, enabled),
    forcePreviewClose: () => ipcRenderer.invoke(IPC.previewForceClose),
    onPreviewCloseAttempt: (handler) =>
      subscribe(IPC.previewCloseAttempt, () => handler()),
    openTokenUsage: (conversationId, anchor) =>
      ipcRenderer.invoke(IPC.windowOpenTokenUsage, conversationId, anchor),
    onTokenUsageView: (handler) => subscribe<TokenUsageViewPayload>(IPC.tokenUsageView, handler),
    relaunch: () => ipcRenderer.invoke(IPC.windowRelaunch)
  },

  notifications: {
    permission: () => ipcRenderer.invoke(IPC.notificationsPermission)
  },

  changeSets: {
    get: (id) => ipcRenderer.invoke(IPC.changeSetGet, id),
    active: (conversationId) => ipcRenderer.invoke(IPC.changeSetActive, conversationId),
    accept: (setId, filePaths) => ipcRenderer.invoke(IPC.changeSetAccept, setId, filePaths),
    reject: (setId, filePaths) => ipcRenderer.invoke(IPC.changeSetReject, setId, filePaths),
    acceptAll: (setId) => ipcRenderer.invoke(IPC.changeSetAcceptAll, setId),
    rejectAll: (setId) => ipcRenderer.invoke(IPC.changeSetRejectAll, setId),
    undo: (setId, filePath) => ipcRenderer.invoke(IPC.changeSetUndo, setId, filePath),
    applyEdit: (setId, filePath, content) =>
      ipcRenderer.invoke(IPC.changeSetApplyEdit, setId, filePath, content)
  },

  updates: {
    getState: () => ipcRenderer.invoke(IPC.updatesGet),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    openDownload: () => ipcRenderer.invoke(IPC.updatesOpenDownload),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onChanged: (handler) => subscribe(IPC.updatesChanged, handler)
  },

  dialog: {
    alert: (options) => ipcRenderer.invoke(IPC.dialogAlert, options),
    confirm: (options) => ipcRenderer.invoke(IPC.dialogConfirm, options),
    messageBox: (options) => ipcRenderer.invoke(IPC.dialogMessageBox, options)
  },

  onMenuCommand: (handler) => subscribe<MenuCommand>(IPC.menuCommand, handler),
  onSettingsChanged: (handler) => subscribe<AppSettings>(IPC.settingsChanged, handler),
  onSettingsView: (handler) => subscribe<SettingsView>(IPC.settingsView, handler),
  onCliOpen: (handler) => subscribe(IPC.cliOpen, handler),
  onFullscreen: (handler) => subscribe<boolean>(IPC.windowFullscreen, handler)
}

contextBridge.exposeInMainWorld('vav', api)
