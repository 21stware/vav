import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { LOG_EVENT } from '@shared/appLog'
import type { PreviewRef, QuoteDraft } from '@shared/types'
import { logUserAnswer, logUserCancel, logUserSend, appLog } from '../log/appLogger'

export type AgentIpcRuntimes = {
  ownsCli: (id: string) => boolean
  runCli: (
    id: string,
    text: string,
    attachments: string[],
    quote: QuoteDraft | null,
    contextBlocks: PreviewRef[] | null,
    contextFile: string | null
  ) => void
  runBuiltin: (
    id: string,
    text: string,
    attachments: string[],
    quote: QuoteDraft | null,
    contextBlocks: PreviewRef[] | null,
    contextFile: string | null
  ) => void
  appendNotice: (id: string, text: string) => void
  cancelCli: (id: string) => void
  cancelBuiltin: (id: string) => void
  answerCli: (id: string, toolCallId: string, answer: string) => boolean
  answerBuiltin: (id: string, toolCallId: string, answer: string) => boolean
  statusCli: (id: string) => unknown
  statusBuiltin: (id: string) => unknown
  regenerateCli: (id: string, messageId: string) => void
  regenerateBuiltin: (id: string, messageId: string) => void
  editUserCli: (id: string, messageId: string, text: string) => void
  editUserBuiltin: (id: string, messageId: string, text: string) => void
  fork: (id: string, messageId: string) => unknown
  compact: (
    id: string,
    options?: { keepAfterMessageId?: string | null }
  ) => Promise<{ ok: boolean }>
  clearCompaction: (id: string, leafId: string) => { ok: boolean }
  tryRemoteSend?: (
    id: string,
    text: string,
    attachments: string[],
    quote: QuoteDraft | null,
    contextBlocks: PreviewRef[] | null,
    contextFile: string | null
  ) => boolean
  tryRemoteCancel?: (id: string) => boolean
  tryRemoteAnswer?: (id: string, toolCallId: string, answer: string) => Promise<boolean>
  controlPlaneOwns?: (id: string) => boolean
}

export type AgentIpcStore = {
  get: (id: string) => { archived?: boolean; cliHost?: string | null; compactions?: unknown } | undefined
}

/** Built-in and CLI-host turn IPC. Spawn stays in the main entry. */
export function registerAgentIpc(
  ipcMain: IpcMain,
  store: AgentIpcStore,
  runtimes: AgentIpcRuntimes,
  afterCompact: (id: string) => void,
  errors: () => { archived: string; cliHost: string }
): void {
  ipcMain.handle(
    IPC.agentSend,
    (
      _event,
      id: string,
      text: string,
      attachments: string[],
      quote?: QuoteDraft | null,
      contextBlocks?: PreviewRef[] | null,
      contextFile?: string | null
    ) => {
      if (store.get(id)?.archived) return
      logUserSend(id, {
        chars: typeof text === 'string' ? text.length : 0,
        attachments: attachments?.length ?? 0,
        quoted: !!quote,
        contextBlocks: contextBlocks?.length ?? 0
      })
      const args = [
        id,
        text,
        attachments ?? [],
        quote ?? null,
        contextBlocks ?? null,
        contextFile ?? null
      ] as const
      if (runtimes.tryRemoteSend?.(...args)) return
      if (runtimes.ownsCli(id)) void runtimes.runCli(...args)
      else void runtimes.runBuiltin(...args)
    }
  )
  ipcMain.handle(IPC.agentAppendNotice, (_event, id: string, text: string) => {
    runtimes.appendNotice(id, text)
  })
  ipcMain.handle(IPC.agentCancel, (_event, id: string) => {
    logUserCancel(id)
    if (runtimes.tryRemoteCancel?.(id)) return
    if (runtimes.ownsCli(id)) runtimes.cancelCli(id)
    else runtimes.cancelBuiltin(id)
  })
  ipcMain.handle(IPC.agentAnswer, async (_event, id: string, toolCallId: string, answer: string) => {
    logUserAnswer(id, toolCallId, typeof answer === 'string' ? answer.length : 0)
    if (await runtimes.tryRemoteAnswer?.(id, toolCallId, answer)) return true
    if (runtimes.answerCli(id, toolCallId, answer)) return true
    return runtimes.answerBuiltin(id, toolCallId, answer)
  })
  ipcMain.handle(IPC.agentStatus, (_event, id: string) =>
    runtimes.ownsCli(id) ? runtimes.statusCli(id) : runtimes.statusBuiltin(id)
  )
  ipcMain.handle(IPC.agentRegenerate, (_event, id: string, messageId: string) => {
    if (store.get(id)?.archived) return
    appLog().user(LOG_EVENT.userRegenerate, 'Regenerate', {
      conversationId: id,
      data: { messageId }
    })
    if (runtimes.controlPlaneOwns?.(id)) return
    if (runtimes.ownsCli(id)) void runtimes.regenerateCli(id, messageId)
    else void runtimes.regenerateBuiltin(id, messageId)
  })
  ipcMain.handle(IPC.agentEditUser, (_event, id: string, messageId: string, text: string) => {
    if (store.get(id)?.archived) return
    appLog().user(LOG_EVENT.userEdit, 'Edit prompt', {
      conversationId: id,
      data: { messageId, chars: typeof text === 'string' ? text.length : 0 }
    })
    if (runtimes.controlPlaneOwns?.(id)) return
    if (runtimes.ownsCli(id)) void runtimes.editUserCli(id, messageId, text)
    else void runtimes.editUserBuiltin(id, messageId, text)
  })
  ipcMain.handle(IPC.agentFork, (_event, id: string, messageId: string) => {
    if (store.get(id)?.archived) return null
    appLog().user(LOG_EVENT.userFork, 'Fork', { conversationId: id, data: { messageId } })
    if (runtimes.controlPlaneOwns?.(id)) return null
    return runtimes.fork(id, messageId)
  })
  ipcMain.handle(
    IPC.agentCompact,
    async (_event, id: string, options?: { keepAfterMessageId?: string | null }) => {
      const conversation = store.get(id)
      const copy = errors()
      if (conversation?.archived) {
        return { ok: false as const, error: copy.archived }
      }
      if (conversation?.cliHost) {
        return { ok: false as const, error: copy.cliHost }
      }
      if (runtimes.controlPlaneOwns?.(id)) {
        return { ok: false as const, error: copy.cliHost }
      }
      const result = await runtimes.compact(id, options)
      if (result.ok) afterCompact(id)
      return result
    }
  )
  ipcMain.handle(IPC.agentClearCompaction, (_event, id: string, leafId: string) => {
    const conversation = store.get(id)
    if (conversation?.cliHost) {
      return { ok: false as const, error: errors().cliHost }
    }
    const result = runtimes.clearCompaction(id, leafId)
    if (result.ok) afterCompact(id)
    return result
  })
}
