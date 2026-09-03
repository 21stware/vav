import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import { isStructuredCliHost, resolveDefaultChatHost, type CliHostKind } from '@shared/cliHost'
import { vendorIdFromEndpoint } from '@shared/llmVendors'
import { LOCAL_MACHINE_ID, isLocalMachine } from '@shared/workspaceHost'
import { conversationToMeta } from '../store/conversationMeta'
import type { Conversation, ConversationMeta } from '@shared/types'
import { locateTempWorkspaceToDir } from '../fs/locateTempWorkspace'
import type { HostFs } from '../host/HostFs'

export type ConversationMutateIpcStore = {
  get: (id: string) => Conversation | undefined
  create: (
    workdir: string | null,
    model: string,
    extras?: {
      fileId?: string | null
      title?: string
      fileReadOnly?: boolean
      approvalMode?: ConversationMeta['approvalMode']
      thinkingLevel?: import('@shared/types').ThinkingLevel
      fast?: boolean
      cliHost?: CliHostKind | null
      accountId?: string | null
      swarmParentId?: string | null
      machineId?: string | null
    }
  ) => Conversation
  updateMeta: (id: string, patch: Partial<ConversationMeta>) => unknown
  listMeta: () => ConversationMeta[]
  switchHostTranscript: (id: string, host: CliHostKind | null) => unknown
  deleteMessage: (id: string, messageId: string) => Conversation | undefined | null
  flush: () => void
  remove: (ids: string[]) => string[]
  selectBranch: (id: string, messageId: string) => unknown
}

export type ConversationMutateIpcHost = {
  resolveNewWorkdirOn: (machineId: string | null | undefined) => Promise<string | null>
  rememberWorkdir: (path: string, machineId?: string | null) => void
  broadcastSettings: () => void
  settings: () => {
    defaultModel?: string
    defaultApprovalMode?: ConversationMeta['approvalMode']
    defaultThinkingLevel?: string
    defaultAgentId?: string | null
  }
  modelForNewConversation: (host: CliHostKind | null, model?: string | null) => string
  accountIdForSession: (workdir: string | null, host: CliHostKind | null) => string | null
  promoteEphemeral: (id: string) => void
  setLastSeen: (id: string) => void
  publish: () => void
  resolveVavCredentials: (conversation: Conversation | undefined) => {
    endpoint: string
    accountId?: string | null
  }
  contextWindowForModel: (
    host: CliHostKind | null,
    model: string,
    reported: number | undefined,
    vendorId: string | null | undefined,
    accountId: string | null | undefined
  ) => number
  cliOwns: (id: string) => boolean
  applyModel: (id: string, model: string) => void
  pushTokenUsageIfOpen: (id: string) => void
  disposeAgent: (id: string) => void
  disposeCli: (id: string) => void
  clearChangeSets: (id: string) => void
  syncHostCursor: (id: string, host: CliHostKind | null) => void
  coerceModel: (id: string) => void
  peekQuota: (conversation: Conversation, host: CliHostKind | null) => unknown
  loadQuota: (conversation: Conversation, host: CliHostKind | null) => Promise<unknown>
  applyWorkingDirectory: (id: string, path: string, machineId?: string | null) => unknown
  pickDirectory: () => Promise<string | null>
  grantPath: (path: string) => void
  mintTempWorkdirOn: (machineId: string | null | undefined) => Promise<string>
  locateNoTemp: () => string
  locateExists: (target: string) => string
  locateFailed: () => string
  hostFor: (machineId: string | null | undefined) => {
    info: { platform?: string; online: boolean; name: string }
    fs: Pick<HostFs, 'readdir' | 'exists' | 'mkdir' | 'rename'>
  }
  invalidateCliResume: (id: string) => void
  onRemoved: (id: string) => void
  revealPath: (event: IpcMainInvokeEvent, path: string) => Promise<void>
  writeText: (text: string) => void
  readText: () => string
  readClipboardImage: () => unknown
  copyImage: (base64Png: string) => unknown
  createOnRemote?: (options?: {
    workingDirectory?: string | null
    model?: string
    swarmParentId?: string | null
    machineId?: string | null
  }) => Promise<ConversationMeta | null>
  forwardConfigure?: (id: string, patch: { model?: string }) => Promise<boolean>
  forwardSetWorkspace?: (id: string, path: string | null) => Promise<boolean>
}

/** Create / host-switch / workdir / delete / clipboard — remaining conversation IPC. */
export function registerConversationMutateIpc(
  ipcMain: IpcMain,
  store: ConversationMutateIpcStore,
  host: ConversationMutateIpcHost
): void {
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
      const remote = await host.createOnRemote?.(options)
      if (remote) return remote
      const workdir =
        options && 'workingDirectory' in options
          ? (options.workingDirectory ?? null)
          : await host.resolveNewWorkdirOn(machineId)
      const settings = host.settings()
      const model = options?.model?.trim() || undefined
      if (workdir) {
        host.rememberWorkdir(workdir, machineId)
        host.broadcastSettings()
      }
      const defaultHost = resolveDefaultChatHost(settings.defaultAgentId)
      const conversation = store.create(
        workdir,
        host.modelForNewConversation(defaultHost, model),
        {
          approvalMode: settings.defaultApprovalMode ?? 'auto',
          thinkingLevel: parseThinkingLevel(settings.defaultThinkingLevel),
          cliHost: defaultHost,
          accountId: host.accountIdForSession(workdir, defaultHost),
          swarmParentId: options?.swarmParentId ?? null,
          machineId
        }
      )
      if (defaultHost) host.promoteEphemeral(conversation.id)
      host.setLastSeen(conversation.id)
      host.publish()
      return conversationToMeta(conversation)
    }
  )

  ipcMain.handle(IPC.convSetModel, async (_event, id: string, model: string) => {
    if (await host.forwardConfigure?.(id, { model })) return store.listMeta()
    const conversation = store.get(id)
    const cliHost = (conversation?.cliHost ?? null) as CliHostKind | null
    const creds = host.resolveVavCredentials(conversation)
    const vendorId = cliHost == null ? vendorIdFromEndpoint(creds.endpoint) : null
    store.updateMeta(id, {
      model,
      tokenLimit: host.contextWindowForModel(
        cliHost,
        model,
        undefined,
        vendorId,
        creds.accountId
      )
    })
    if (host.cliOwns(id)) host.applyModel(id, model)
    host.publish()
    host.pushTokenUsageIfOpen(id)
    return store.listMeta()
  })

  ipcMain.handle(
    IPC.convSetCliHost,
    (_event, id: string, next: string | null, accountId?: string | null) => {
      const prev = store.get(id)
      const prevHost = prev?.cliHost ?? null
      const nextHost = isStructuredCliHost(next) ? next : null
      const hostChanged = prevHost !== nextHost

      if (hostChanged && (prev?.messages.length ?? 0) > 0) {
        return {
          conversations: store.listMeta(),
          hostChanged: false,
          transcript: null
        }
      }

      if (hostChanged) {
        host.disposeAgent(id)
        host.disposeCli(id)
        host.clearChangeSets(id)
        store.switchHostTranscript(id, nextHost)
        store.updateMeta(id, {
          accountId: accountId ?? host.accountIdForSession(prev?.workingDirectory ?? null, nextHost)
        })
        host.syncHostCursor(id, nextHost)
        host.coerceModel(id)
      } else {
        const update: Partial<ConversationMeta> = {
          cliHost: nextHost,
          agentBinaryName: nextHost
        }
        if (accountId !== undefined) update.accountId = accountId
        store.updateMeta(id, update)
      }
      if (nextHost) host.promoteEphemeral(id)
      host.publish()
      const conversation = store.get(id)
      return {
        conversations: store.listMeta(),
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

  ipcMain.handle(IPC.convSetFocusedFile, (_event, id: string, path: string | null) => {
    const existing = store.get(id)
    if (existing && (existing.focusedFilePath ?? null) === path) {
      return store.listMeta()
    }
    store.updateMeta(id, { focusedFilePath: path })
    return store.listMeta()
  })

  ipcMain.handle(IPC.convAccountQuota, async (_event, id: string, hostOverride?: unknown) => {
    const conversation = store.get(id)
    if (!conversation) return null
    const cliHost =
      hostOverride === null
        ? null
        : typeof hostOverride === 'string' && isStructuredCliHost(hostOverride)
          ? hostOverride
          : (conversation.cliHost ?? null)
    const cached = host.peekQuota(conversation, cliHost)
    if (cached) {
      void host.loadQuota(conversation, cliHost).catch((err) => {
        console.error('[account-quota] background refresh failed', err)
      })
      return cached
    }
    return host.loadQuota(conversation, cliHost)
  })

  ipcMain.handle(IPC.convSetWorkdir, async (_event, id: string, path: string, machineId?: string | null) => {
    if (await host.forwardSetWorkspace?.(id, path)) return store.listMeta()
    return host.applyWorkingDirectory(id, path, machineId)
  })

  ipcMain.handle(IPC.convPickWorkdir, async (_event, id: string) => {
    const conversation = store.get(id)
    if (conversation && !isLocalMachine(conversation.machineId)) return null
    const path = await host.pickDirectory()
    if (!path) return null
    host.grantPath(path)
    return host.applyWorkingDirectory(id, path, conversation?.machineId)
  })

  ipcMain.handle(IPC.convUseTempWorkdir, async (_event, id: string) => {
    if (await host.forwardSetWorkspace?.(id, null)) return store.listMeta()
    const machineId = store.get(id)?.machineId
    return host.applyWorkingDirectory(id, await host.mintTempWorkdirOn(machineId), machineId)
  })

  ipcMain.handle(IPC.convLocateWorkspace, async (_event, id: string, destinationDir: string) => {
    const conversation = store.get(id)
    if (!conversation?.workingDirectory) {
      return { ok: false as const, error: host.locateNoTemp() }
    }
    const machineId = conversation.machineId
    const remote = host.hostFor(machineId)
    const dest = String(destinationDir || '').trim()
    if (!dest) {
      return { ok: false as const, error: host.locateFailed() }
    }
    try {
      if (!isLocalMachine(machineId) && !remote.info.online) {
        return { ok: false as const, error: `${remote.info.name} is offline` }
      }
      const located = await locateTempWorkspaceToDir({
        workdir: conversation.workingDirectory,
        destinationDir: dest,
        platform: remote.info.platform,
        fs: remote.fs,
        crossDeviceCopy: isLocalMachine(machineId)
      })
      if (!located.ok) {
        if (located.error === 'exists') {
          return { ok: false as const, error: host.locateExists(located.target ?? dest) }
        }
        return { ok: false as const, error: host.locateNoTemp() }
      }
      return {
        ok: true as const,
        conversations: host.applyWorkingDirectory(id, located.nextWorkdir, machineId)
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : host.locateFailed()
      }
    }
  })

  ipcMain.handle(IPC.convDeleteMessage, (_event, id: string, messageId: string) => {
    const conversation = store.deleteMessage(id, messageId)
    if (!conversation) return null
    if (isStructuredCliHost(conversation.cliHost)) {
      host.invalidateCliResume(id)
    }
    store.flush()
    host.publish()
    return {
      conversations: store.listMeta(),
      messages: conversation.messages,
      activeLeafId: conversation.activeLeafId ?? null
    }
  })

  ipcMain.handle(IPC.convRemove, (_event, ids: string[]) => {
    const removed = store.remove(ids)
    for (const id of removed) host.onRemoved(id)
    if (removed.length) store.flush()
    host.publish()
    return { removed, conversations: store.listMeta() }
  })

  ipcMain.handle(IPC.convReveal, async (event, path: string) => {
    await host.revealPath(event, String(path || ''))
  })

  ipcMain.handle(IPC.convCopy, (_event, text: string) => {
    host.writeText(text)
  })

  ipcMain.handle(IPC.convClipboardRead, () => host.readText())

  ipcMain.handle(IPC.convClipboardReadImage, () => host.readClipboardImage())

  ipcMain.handle(IPC.convCopyImage, (_event, base64Png: string) => host.copyImage(base64Png))

  ipcMain.handle(IPC.convSelectBranch, (_event, id: string, messageId: string) =>
    store.selectBranch(id, messageId)
  )
}
