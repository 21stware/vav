import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import { sanitizeSwarmLayout } from '@shared/swarmLayout'
import { conversationToMeta } from '../store/conversationMeta'
import type { Conversation, ConversationMeta } from '@shared/types'

export type ConversationMetaIpcStore = {
  listMeta: () => ConversationMeta[]
  get: (id: string) => Conversation | undefined
  hydrateMissingHostUsage: (id: string) => boolean
  updateMeta: (id: string, patch: Partial<ConversationMeta>) => unknown
  setActiveLeaf: (id: string, leafId: string) => unknown
  setPinned: (id: string, pinned: boolean) => unknown
  setArchived: (id: string, archived: boolean) => unknown
  setApprovalMode: (id: string, mode: 'auto' | 'bypass' | 'edit') => unknown
  setThinkingLevel: (id: string, level: ReturnType<typeof parseThinkingLevel>) => unknown
  setFast: (id: string, fast: boolean) => unknown
  branchToNewConversation: (id: string, messageId: string) => Conversation | undefined | null
  duplicate: (id: string) => Conversation | undefined | null
}

export type ConversationMetaIpcHost = {
  untitledTitle: () => string
  publish: () => void
  renameDetached: (id: string, title: string) => void
  onArchive: (id: string) => void
  cliOwns: (id: string) => boolean
  applyThinkingLevel: (id: string) => void
  applyFast: (id: string) => void
  applySessionMode: (id: string, modeId: string) => void
  applySessionConfig: (id: string, configId: string, value: string | boolean) => void
  exportPack: (ids: string[], sender: unknown) => unknown
  importPack: (sender: unknown) => Promise<{ ok: boolean } & Record<string, unknown>>
  promoteEphemeral: (id: string) => void
}

/** Sidebar list / pin / archive / model — create and host-switch stay in the entry. */
export function registerConversationMetaIpc(
  ipcMain: IpcMain,
  store: ConversationMetaIpcStore,
  host: ConversationMetaIpcHost
): void {
  ipcMain.handle(IPC.convList, () => store.listMeta())
  ipcMain.handle(IPC.convGet, (_event, id: string) => {
    if (store.hydrateMissingHostUsage(id)) host.publish()
    return store.get(id) ?? null
  })
  ipcMain.handle(IPC.convRename, (_event, id: string, title: string) => {
    const next = title.trim() || host.untitledTitle()
    store.updateMeta(id, { title: next })
    host.renameDetached(id, next)
    host.publish()
    return store.listMeta()
  })
  ipcMain.handle(IPC.convSetLeaf, (_event, id: string, leafId: string) => {
    store.setActiveLeaf(id, leafId)
  })
  ipcMain.handle(IPC.convSetPinned, (_event, id: string, pinned: boolean) => {
    store.setPinned(id, pinned)
    host.publish()
    return store.listMeta()
  })
  ipcMain.handle(IPC.convSetArchived, (_event, id: string, archived: boolean) => {
    if (archived) host.onArchive(id)
    store.setArchived(id, archived)
    host.publish()
    return store.listMeta()
  })
  ipcMain.handle(IPC.convSetApprovalMode, (_event, id: string, mode: string) => {
    if (mode === 'auto' || mode === 'bypass' || mode === 'edit') {
      store.setApprovalMode(id, mode)
      host.publish()
    }
    return store.listMeta()
  })
  ipcMain.handle(IPC.convSetThinkingLevel, (_event, id: string, level: string) => {
    store.setThinkingLevel(id, parseThinkingLevel(level))
    if (host.cliOwns(id)) host.applyThinkingLevel(id)
    host.publish()
    return store.listMeta()
  })
  ipcMain.handle(IPC.convSetFast, (_event, id: string, fast: boolean) => {
    store.setFast(id, fast === true)
    if (host.cliOwns(id)) host.applyFast(id)
    host.publish()
    return store.listMeta()
  })
  ipcMain.handle(IPC.convSetAcpMode, (_event, id: string, modeId: string) => {
    if (typeof modeId === 'string' && modeId.trim()) {
      host.applySessionMode(id, modeId.trim())
      host.publish()
    }
    return store.listMeta()
  })
  ipcMain.handle(
    IPC.convSetAcpConfig,
    (_event, id: string, configId: string, value: string | boolean) => {
      if (typeof configId === 'string' && configId.trim()) {
        host.applySessionConfig(id, configId.trim(), value)
        host.publish()
      }
      return store.listMeta()
    }
  )
  ipcMain.handle(IPC.convContinueNew, (_event, id: string, messageId: string) => {
    const conversation = store.branchToNewConversation(id, messageId)
    if (!conversation) return null
    host.publish()
    return conversationToMeta(conversation)
  })
  ipcMain.handle(IPC.convDuplicate, (_event, id: string) => {
    const conversation = store.duplicate(id)
    if (!conversation) return null
    host.publish()
    return conversationToMeta(conversation)
  })
  ipcMain.handle(IPC.convExportPack, async (event, ids: string[]) =>
    host.exportPack(Array.isArray(ids) ? ids : [], event.sender)
  )
  ipcMain.handle(IPC.convImportPack, async (event) => {
    const result = await host.importPack(event.sender)
    if (result.ok) host.publish()
    return result
  })
  ipcMain.handle(IPC.convSetAgentBinary, (_event, id: string, agentBinaryName: string | null) => {
    store.updateMeta(id, { agentBinaryName })
    if (agentBinaryName) host.promoteEphemeral(id)
    host.publish()
    return store.listMeta()
  })
  ipcMain.handle(
    IPC.convSetSwarmLayout,
    (_event, id: string, layout: unknown, full?: unknown) => {
      const patch: {
        swarmLayout: ReturnType<typeof sanitizeSwarmLayout>
        swarmLayoutFull?: ReturnType<typeof sanitizeSwarmLayout>
      } = { swarmLayout: sanitizeSwarmLayout(layout) }
      if (full !== undefined) patch.swarmLayoutFull = sanitizeSwarmLayout(full)
      store.updateMeta(id, patch)
      host.publish()
      return store.listMeta()
    }
  )
}
