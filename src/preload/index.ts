import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type MenuCommand,
  type NativeMenuItem,
  type CliInstallLocation,
  type AnalysisSnapshot,
  type SettingsView,
  type SettingsViewPayload,
  type ProviderAccountViewPayload,
  type SwarmHistoryResumeEvent,
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
    setCloudflareApiToken: (token: string) =>
      ipcRenderer.invoke(IPC.settingsSetCloudflareToken, token),
    cloudflareApiTokenHint: () => ipcRenderer.invoke(IPC.settingsCloudflareTokenHint),
    setSupabaseAccessToken: (token: string) =>
      ipcRenderer.invoke(IPC.settingsSetSupabaseToken, token),
    supabaseAccessTokenHint: () => ipcRenderer.invoke(IPC.settingsSupabaseTokenHint),
    validateKey: (key: string) => ipcRenderer.invoke(IPC.settingsValidateKey, key),
    availableFonts: () => ipcRenderer.invoke(IPC.settingsFonts),
    pickDirectory: () => ipcRenderer.invoke(IPC.settingsPickDirectory),
    pickColor: (defaultHex?: string) => ipcRenderer.invoke(IPC.settingsPickColor, defaultHex),
    pickSurfacePatternImage: () => ipcRenderer.invoke(IPC.settingsPickSurfacePattern),
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
      ipcRenderer.invoke(IPC.settingsRegisterAllFileAssociations),
    analysis: (options?: { refresh?: boolean }) =>
      ipcRenderer.invoke(IPC.settingsAnalysis, options)
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
    setCliHost: (id: string, host: string | null) =>
      ipcRenderer.invoke(IPC.convSetCliHost, id, host),
    setFocusedFile: (id: string, path: string | null) =>
      ipcRenderer.invoke(IPC.convSetFocusedFile, id, path),
    accountQuota: (id: string, host?: import('@shared/types').CliHostKind | null) =>
      ipcRenderer.invoke(IPC.convAccountQuota, id, host),
    setWorkingDirectory: (id: string, path: string) =>
      ipcRenderer.invoke(IPC.convSetWorkdir, id, path),
    pickWorkingDirectory: (id: string) => ipcRenderer.invoke(IPC.convPickWorkdir, id),
    useTempWorkingDirectory: (id: string) => ipcRenderer.invoke(IPC.convUseTempWorkdir, id),
    locateWorkspace: (id: string, destinationDir: string, name: string) =>
      ipcRenderer.invoke(IPC.convLocateWorkspace, id, destinationDir, name),
    remove: (ids: string[]) => ipcRenderer.invoke(IPC.convRemove, ids),
    revealInFinder: (path: string) => ipcRenderer.invoke(IPC.convReveal, path),
    copyToClipboard: (text: string) => ipcRenderer.invoke(IPC.convCopy, text),
    readClipboard: () => ipcRenderer.invoke(IPC.convClipboardRead) as Promise<string>,
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
    setThinkingLevel: (id: string, level) =>
      ipcRenderer.invoke(IPC.convSetThinkingLevel, id, level),
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
    onChanged: (handler) => subscribe(IPC.convChanged, handler),
    onActivity: (handler) => subscribe(IPC.activityChanged, handler)
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
    appendNotice: (id: string, text: string) =>
      ipcRenderer.invoke(IPC.agentAppendNotice, id, text),
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
    readTextWindow: (
      path: string,
      opts?: { startByte?: number; maxBytes?: number; force?: boolean }
    ) => ipcRenderer.invoke(IPC.filesReadTextWindow, path, opts),
    readBinary: (path: string) => ipcRenderer.invoke(IPC.filesReadBinary, path),
    readBinaryWindow: (path: string, opts?: { startByte?: number; maxBytes?: number }) =>
      ipcRenderer.invoke(IPC.filesReadBinaryWindow, path, opts),
    writeBinary: (path: string, base64: string) =>
      ipcRenderer.invoke(IPC.filesWriteBinary, path, base64),
    write: (path: string, content: string) => ipcRenderer.invoke(IPC.filesWrite, path, content),
    workingCopyEnsure: (path: string, opts?: { fileId?: string | null }) =>
      ipcRenderer.invoke(IPC.filesWorkingCopyEnsure, path, opts),
    workingCopyPromote: (path: string) => ipcRenderer.invoke(IPC.filesWorkingCopyPromote, path),
    workingCopyDiscard: (path: string) => ipcRenderer.invoke(IPC.filesWorkingCopyDiscard, path),
    workingCopyStatus: (path: string) => ipcRenderer.invoke(IPC.filesWorkingCopyStatus, path),
    quickLook: (path: string) => ipcRenderer.invoke(IPC.filesQuickLook, path),
    openWithDefault: (path: string) => ipcRenderer.invoke(IPC.filesOpenWithDefault, path),
    watch: (conversationId: string, root: string | null) =>
      ipcRenderer.invoke(IPC.filesWatch, conversationId, root),
    onDirty: (handler) => subscribe(IPC.filesDirty, handler),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    writeClip: (input) => ipcRenderer.invoke(IPC.filesWriteClip, input),
    saveAs: (defaultName: string, content: string) =>
      ipcRenderer.invoke(IPC.filesSaveAs, defaultName, content),
    rename: (path: string, newName: string) => ipcRenderer.invoke(IPC.filesRename, path, newName),
    trash: (paths: string[]) => ipcRenderer.invoke(IPC.filesTrash, paths),
    inspect: (path: string) => ipcRenderer.invoke(IPC.filesInspect, path),
    inspectStructured: (
      path: string,
      opts?: { maxBlocks?: number; maxRows?: number }
    ) => ipcRenderer.invoke(IPC.filesInspectStructured, path, opts),
    dbQuery: (path: string, table: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke(IPC.filesDbQuery, path, table, offset ?? 0, limit ?? 500),
    parseBlocks: (path: string, text: string) =>
      ipcRenderer.invoke(IPC.filesParseBlocks, path, text)
  },

  git: {
    status: (cwd: string) => ipcRenderer.invoke(IPC.gitStatus, cwd),
    diff: (cwd: string, path: string, opts?: { staged?: boolean }) =>
      ipcRenderer.invoke(IPC.gitDiff, cwd, path, opts),
    showBase64: (cwd: string, path: string, ref?: string) =>
      ipcRenderer.invoke(IPC.gitShowBase64, cwd, path, ref),
    init: (cwd: string) => ipcRenderer.invoke(IPC.gitInit, cwd),
    createBranch: (cwd: string, name: string, opts?: { checkout?: boolean }) =>
      ipcRenderer.invoke(IPC.gitCreateBranch, cwd, name, opts),
    checkoutBranch: (cwd: string, name: string) =>
      ipcRenderer.invoke(IPC.gitCheckoutBranch, cwd, name),
    createWorktree: (
      cwd: string,
      options: { path: string; newBranch?: string; branch?: string }
    ) => ipcRenderer.invoke(IPC.gitCreateWorktree, cwd, options)
  },

  cloudflare: {
    status: (cwd: string, query?: import('@shared/cloudflare').CloudflareStatusQuery) =>
      ipcRenderer.invoke(IPC.cloudflareStatus, cwd, query)
  },

  supabase: {
    status: (cwd: string, query?: import('@shared/supabase').SupabaseStatusQuery) =>
      ipcRenderer.invoke(IPC.supabaseStatus, cwd, query)
  },

  github: {
    listPulls: (cwd: string, state?: import('@shared/github').GithubPullStateFilter) =>
      ipcRenderer.invoke(IPC.githubListPulls, cwd, state),
    getPull: (cwd: string, number: number) => ipcRenderer.invoke(IPC.githubGetPull, cwd, number),
    listActions: (cwd: string, scope?: import('@shared/github').GithubActionsScope) =>
      ipcRenderer.invoke(IPC.githubListActions, cwd, scope),
    getActionRun: (cwd: string, runId: number) =>
      ipcRenderer.invoke(IPC.githubGetActionRun, cwd, runId),
    getSite: (cwd: string) => ipcRenderer.invoke(IPC.githubGetSite, cwd),
    listReleases: (cwd: string) => ipcRenderer.invoke(IPC.githubListReleases, cwd)
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
    onReadOnlyChanged: (handler) =>
      subscribe<{ sessionId: string; readOnly: boolean }>(
        IPC.fileSessionReadOnlyChanged,
        handler
      ),
    rename: (fileId: string, sessionId: string, title: string) =>
      ipcRenderer.invoke(IPC.fileSessionsRename, fileId, sessionId, title),
    delete: (fileId: string, sessionIds: string[]) =>
      ipcRenderer.invoke(IPC.fileSessionsDelete, fileId, sessionIds),
    forceDelete: (fileId: string, sessionIds: string[]) =>
      ipcRenderer.invoke(IPC.fileSessionsForceDelete, fileId, sessionIds)
  },

  agents: {
    resolveBinary: (candidates: string[], force?: boolean) =>
      ipcRenderer.invoke(IPC.agentsResolveBinary, candidates, force === true),
    probeBinaries: (items, force?: boolean) =>
      ipcRenderer.invoke(IPC.agentsProbeBinaries, items, force === true),
    listModels: (host: string | null, force?: boolean) =>
      ipcRenderer.invoke(IPC.agentsListModels, host, force === true),
    getModelCatalog: () => ipcRenderer.invoke(IPC.agentsGetModelCatalog),
    preloadModels: (force?: boolean) =>
      ipcRenderer.invoke(IPC.agentsPreloadModels, force === true),
    onModelCatalogChanged: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        catalog: Parameters<typeof handler>[0]
      ): void => {
        handler(catalog)
      }
      ipcRenderer.on(IPC.agentsModelCatalogChanged, listener)
      return () => ipcRenderer.removeListener(IPC.agentsModelCatalogChanged, listener)
    },
    installStart: (payload) => ipcRenderer.invoke(IPC.agentsInstallStart, payload),
    installCancel: (agentId) => ipcRenderer.invoke(IPC.agentsInstallCancel, agentId),
    installClear: (agentId) => ipcRenderer.invoke(IPC.agentsInstallClear, agentId),
    listInstallRuns: () => ipcRenderer.invoke(IPC.agentsListInstallRuns),
    onInstallRunsChanged: (handler) => subscribe(IPC.agentsInstallRunsChanged, handler)
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
    setLayouts: (
      conversationId: string,
      layouts: import('@shared/types').ConversationPtyLayouts
    ) => ipcRenderer.invoke(IPC.ptySetLayouts, conversationId, layouts),
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
    openSettings: (view?: SettingsView, agentId?: string) =>
      ipcRenderer.invoke(IPC.windowOpenSettings, view, agentId),
    closeSettings: () => ipcRenderer.invoke(IPC.windowCloseSettings),
    popupMenu: (items: NativeMenuItem[], position?: { x: number; y: number }) =>
      ipcRenderer.invoke(IPC.windowPopupMenu, items, position),
    closePopupMenu: () => ipcRenderer.invoke(IPC.windowClosePopupMenu),
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
    onRepaint: (handler) => subscribe(IPC.windowRepaint, () => handler()),
    openFilePreview: (path, options) =>
      ipcRenderer.invoke(IPC.windowOpenFilePreview, path, options),
    openOverlay: (payload) => ipcRenderer.invoke(IPC.windowOpenOverlay, payload),
    onPreviewNavigate: (handler) =>
      subscribe<import('@shared/overlayOpen').OverlayNavigatePayload>(IPC.previewNavigate, handler),
    previewShellReady: () => {
      ipcRenderer.send(IPC.previewShellReady)
    },
    onSessionNavigate: (handler) =>
      subscribe<{
        conversationId: string
        meta?: import('@shared/types').ConversationMeta
        empty?: boolean
        collapseTools?: boolean
        openSeq: number
        requestedAt?: number
      }>(IPC.sessionNavigate, handler),
    sessionShellReady: () => {
      ipcRenderer.send(IPC.sessionShellReady)
    },
    setPreviewCloseGuard: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.previewSetCloseGuard, enabled),
    forcePreviewClose: () => ipcRenderer.invoke(IPC.previewForceClose),
    onPreviewCloseAttempt: (handler) =>
      subscribe(IPC.previewCloseAttempt, () => handler()),
    openTokenUsage: (conversationId, anchor) =>
      ipcRenderer.invoke(IPC.windowOpenTokenUsage, conversationId, anchor),
    getTokenUsageView: () => ipcRenderer.invoke(IPC.tokenUsageGetView),
    onTokenUsageView: (handler) => subscribe<TokenUsageViewPayload>(IPC.tokenUsageView, handler),
    openProviderAccount: (conversationId, anchor) =>
      ipcRenderer.invoke(IPC.windowOpenProviderAccount, conversationId, anchor),
    getProviderAccountView: () => ipcRenderer.invoke(IPC.providerAccountGetView),
    onProviderAccountView: (handler) =>
      subscribe<ProviderAccountViewPayload>(IPC.providerAccountView, handler),
    fitProviderAccount: (height) => ipcRenderer.invoke(IPC.providerAccountFit, height),
    openSwarmHistory: (conversationId, anchor) =>
      ipcRenderer.invoke(IPC.windowOpenSwarmHistory, conversationId, anchor),
    onSwarmHistoryResume: (handler) =>
      subscribe<SwarmHistoryResumeEvent>(IPC.swarmHistoryResume, handler),
    relaunch: () => ipcRenderer.invoke(IPC.windowRelaunch)
  },

  notifications: {
    permission: () => ipcRenderer.invoke(IPC.notificationsPermission),
    seen: (conversationId) => ipcRenderer.send(IPC.notificationsSeen, conversationId)
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
  onSettingsView: (handler) => subscribe<SettingsViewPayload>(IPC.settingsView, handler),
  onSettingsAnalysis: (handler) => subscribe<AnalysisSnapshot>(IPC.settingsAnalysisUpdated, handler),
  onCliOpen: (handler) => subscribe(IPC.cliOpen, handler),
  onFullscreen: (handler) => subscribe<boolean>(IPC.windowFullscreen, handler)
}

contextBridge.exposeInMainWorld('vav', api)
