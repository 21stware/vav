import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { dbConnectionTitle, type DbConnectionInput } from '@shared/dbConnection'
import { isDefaultSessionTitle } from '@shared/i18n'
import { conversationToMeta } from '../store/conversationMeta'
import type { DbConnectionStore } from '../store/DbConnectionStore'
import type { PostgresService } from '../fs/PostgresService'
import type { ConversationStore } from '../store/ConversationStore'
import type { Conversation } from '@shared/types'

export type DbIpcHost = {
  createDefinitionConversation: () => Conversation
  publishConversations: () => void
}

export function registerDbIpc(
  ipcMain: IpcMain,
  store: DbConnectionStore,
  postgres: PostgresService,
  conversations: ConversationStore,
  broadcast: () => void,
  host: DbIpcHost
): void {
  ipcMain.handle(IPC.dbList, async () => store.list())
  ipcMain.handle(IPC.dbCreate, async () => {
    const conversation = host.createDefinitionConversation()
    const connection = store.create({
      title: '',
      conversationId: conversation.id
    })
    conversations.updateMeta(conversation.id, {
      dbConnectionId: connection.id,
      sessionKind: 'db'
    })
    host.publishConversations()
    broadcast()
    const next = conversations.get(conversation.id) ?? conversation
    return { connection, conversation: conversationToMeta(next) }
  })
  ipcMain.handle(IPC.dbCreateSession, async (_event, connectionId: string) => {
    const existing = store.get(connectionId.trim())
    if (!existing) return null
    const conversation = host.createDefinitionConversation()
    conversations.updateMeta(conversation.id, {
      dbConnectionId: existing.id,
      sessionKind: 'db'
    })
    const connection = store.update(existing.id, { conversationId: conversation.id }) ?? existing
    host.publishConversations()
    broadcast()
    const next = conversations.get(conversation.id) ?? conversation
    return { connection, conversation: conversationToMeta(next) }
  })
  ipcMain.handle(IPC.dbGetForConversation, async (_event, conversationId: string) => {
    return store.getForConversation(conversationId) ?? null
  })
  ipcMain.handle(IPC.dbEnsureForConversation, async (_event, conversationId: string) => {
    const id = conversationId.trim()
    if (!id) return null
    const existing = store.getForConversation(id)
    if (existing) return existing
    const conversation = conversations.get(id)
    if (!conversation) return null
    const connection = store.create({
      title: '',
      conversationId: id
    })
    conversations.updateMeta(id, {
      dbConnectionId: connection.id,
      sessionKind: 'db'
    })
    host.publishConversations()
    broadcast()
    return connection
  })
  ipcMain.handle(
    IPC.dbUpdate,
    async (_event, id: string, patch: DbConnectionInput) => {
      const connection = store.update(id, patch)
      if (connection?.conversationId && typeof patch.title === 'string' && patch.title.trim()) {
        conversations.updateMeta(connection.conversationId, { title: patch.title.trim() })
        host.publishConversations()
      }
      if (connection) broadcast()
      return connection
    }
  )
  ipcMain.handle(IPC.dbRemove, async (_event, id: string) => {
    postgres.evict(id)
    const ok = store.remove(id)
    if (ok) broadcast()
    return ok
  })
  ipcMain.handle(IPC.dbTest, async (_event, id: string) => {
    const result = await postgres.test(id)
    broadcast()
    return result
  })
  ipcMain.handle(IPC.dbOpen, async (_event, id: string) => {
    const result = await postgres.test(id)
    broadcast()
    if (!result.ok) {
      throw new Error(result.error || 'Connect failed')
    }
    const connection = store.get(id) ?? null
    if (connection?.conversationId) {
      const conversation = conversations.get(connection.conversationId)
      const display = dbConnectionTitle(connection)
      if (conversation && (isDefaultSessionTitle(conversation.title) || !conversation.title.trim())) {
        conversations.updateMeta(connection.conversationId, { title: display })
        host.publishConversations()
      }
    }
    return connection
  })
  ipcMain.handle(IPC.dbSchema, async (_event, id: string) => postgres.schema(id))
  ipcMain.handle(
    IPC.dbQueryTable,
    async (_event, id: string, table: string, offset: number, limit: number) =>
      postgres.queryTable(id, table, offset, limit)
  )
}
