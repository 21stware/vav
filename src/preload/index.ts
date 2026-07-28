import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type MenuCommand,
  type NativeMenuItem,
  type CliInstallLocation,
  type SettingsView,
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

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    reset: () => ipcRenderer.invoke(IPC.settingsReset),
    setApiKey: (key: string) => ipcRenderer.invoke(IPC.settingsSetKey, key),
    revealApiKey: () => ipcRenderer.invoke(IPC.settingsRevealKey),
    apiKeyHint: () => ipcRenderer.invoke(IPC.settingsKeyHint),
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
    setWorkingDirectory: (id: string, path: string) =>
      ipcRenderer.invoke(IPC.convSetWorkdir, id, path),
    pickWorkingDirectory: (id: string) => ipcRenderer.invoke(IPC.convPickWorkdir, id),
    locateWorkspace: (id: string, destinationDir: string, name: string) =>
      ipcRenderer.invoke(IPC.convLocateWorkspace, id, destinationDir, name),
    remove: (ids: string[]) => ipcRenderer.invoke(IPC.convRemove, ids),
    revealInFinder: (path: string) => ipcRenderer.invoke(IPC.convReveal, path),
    copyToClipboard: (text: string) => ipcRenderer.invoke(IPC.convCopy, text),
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
    onChanged: (handler) => subscribe(IPC.convChanged, handler)
  },

  agent: {
    send: (
      id: string,
      text: string,
      attachments: string[],
      quote?: import('@shared/types').QuoteDraft | null,
      contextBlocks?: import('@shared/types').PreviewRef[] | null
    ) =>
      ipcRenderer.invoke(IPC.agentSend, id, text, attachments, quote ?? null, contextBlocks ?? null),
    cancel: (id: string) => ipcRenderer.invoke(IPC.agentCancel, id),
    answer: (id: string, toolCallId: string, answer: string) =>
      ipcRenderer.invoke(IPC.agentAnswer, id, toolCallId, answer),
    status: (id: string) => ipcRenderer.invoke(IPC.agentStatus, id),
    regenerate: (id: string, messageId: string) =>
      ipcRenderer.invoke(IPC.agentRegenerate, id, messageId),
    editUserMessage: (id: string, messageId: string, text: string) =>
      ipcRenderer.invoke(IPC.agentEditUser, id, messageId, text),
    fork: (id: string, messageId: string) => ipcRenderer.invoke(IPC.agentFork, id, messageId),
    onEvent: (handler) => subscribe(IPC.agentEvent, handler)
  },

  files: {
    list: (path: string, sort: FileSortKey, ascending: boolean) =>
      ipcRenderer.invoke(IPC.filesList, path, sort, ascending),
    read: (path: string) => ipcRenderer.invoke(IPC.filesRead, path),
    write: (path: string, content: string) => ipcRenderer.invoke(IPC.filesWrite, path, content),
    quickLook: (path: string) => ipcRenderer.invoke(IPC.filesQuickLook, path),
    watch: (conversationId: string, root: string | null) =>
      ipcRenderer.invoke(IPC.filesWatch, conversationId, root),
    onDirty: (handler) => subscribe(IPC.filesDirty, handler),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    saveAs: (defaultName: string, content: string) =>
      ipcRenderer.invoke(IPC.filesSaveAs, defaultName, content),
    rename: (path: string, newName: string) => ipcRenderer.invoke(IPC.filesRename, path, newName),
    trash: (paths: string[]) => ipcRenderer.invoke(IPC.filesTrash, paths),
    inspect: (path: string) => ipcRenderer.invoke(IPC.filesInspect, path),
    parseBlocks: (path: string, text: string) =>
      ipcRenderer.invoke(IPC.filesParseBlocks, path, text)
  },

  pty: {
    create: (
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      preferredId?: string
    ) => ipcRenderer.invoke(IPC.ptyCreate, conversationId, cwd, cols, rows, preferredId),
    write: (tabId: string, data: string) => ipcRenderer.invoke(IPC.ptyWrite, tabId, data),
    resize: (tabId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.ptyResize, tabId, cols, rows),
    kill: (tabId: string) => ipcRenderer.invoke(IPC.ptyKill, tabId),
    isBusy: (tabId: string) => ipcRenderer.invoke(IPC.ptyIsBusy, tabId),
    onData: (handler) => subscribe(IPC.ptyData, handler),
    onExit: (handler) => subscribe<string>(IPC.ptyExit, handler)
  },

  window: {
    setTheme: (theme: AppSettings['theme']) => ipcRenderer.invoke(IPC.windowSetTheme, theme),
    shellPath: (kind: ShellKind) => ipcRenderer.invoke(IPC.windowShellPath, kind),
    openSettings: (view?: SettingsView) => ipcRenderer.invoke(IPC.windowOpenSettings, view),
    closeSettings: () => ipcRenderer.invoke(IPC.windowCloseSettings),
    popupMenu: (items: NativeMenuItem[], position?: { x: number; y: number }) =>
      ipcRenderer.invoke(IPC.windowPopupMenu, items, position),
    openSession: (conversationId: string) =>
      ipcRenderer.invoke(IPC.windowOpenSession, conversationId),
    newDetachedSession: () => ipcRenderer.invoke(IPC.windowNewDetached),
    openFilePreview: (path, options) =>
      ipcRenderer.invoke(IPC.windowOpenFilePreview, path, options),
    setPreviewCloseGuard: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.previewSetCloseGuard, enabled),
    forcePreviewClose: () => ipcRenderer.invoke(IPC.previewForceClose),
    onPreviewCloseAttempt: (handler) =>
      subscribe(IPC.previewCloseAttempt, () => handler()),
    openTokenUsage: (conversationId, anchor) =>
      ipcRenderer.invoke(IPC.windowOpenTokenUsage, conversationId, anchor),
    onTokenUsageView: (handler) => subscribe<string>(IPC.tokenUsageView, handler),
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
    onChanged: (handler) => subscribe(IPC.updatesChanged, handler)
  },

  dialog: {
    alert: (options) => ipcRenderer.invoke(IPC.dialogAlert, options),
    confirm: (options) => ipcRenderer.invoke(IPC.dialogConfirm, options)
  },

  onMenuCommand: (handler) => subscribe<MenuCommand>(IPC.menuCommand, handler),
  onSettingsChanged: (handler) => subscribe<AppSettings>(IPC.settingsChanged, handler),
  onSettingsView: (handler) => subscribe<SettingsView>(IPC.settingsView, handler),
  onCliOpen: (handler) => subscribe(IPC.cliOpen, handler),
  onFullscreen: (handler) => subscribe<boolean>(IPC.windowFullscreen, handler)
}

contextBridge.exposeInMainWorld('vav', api)
