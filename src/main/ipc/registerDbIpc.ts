import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  UNTITLED_DB_CONNECTION,
  dbConnectionTitle,
  isReplaceableDbTitle,
  type DbConnectionInput
} from '@shared/dbConnection'
import { dataFileFormat, dataFileTitle, isDataFilePath } from '@shared/dataFile'
import { isDefaultSessionTitle } from '@shared/i18n'
import { conversationToMeta } from '../store/conversationMeta'
import type { DbConnectionStore } from '../store/DbConnectionStore'
import type { PostgresService } from '../fs/PostgresService'
import type { DuckDbService } from '../fs/DuckDbService'
import type { ConversationStore } from '../store/ConversationStore'
import type { Conversation } from '@shared/types'

export type DbIpcHost = {
  createDefinitionConversation: () => Conversation
  publishConversations: () => void
  grantPath?: (path: string) => void
}

export function registerDbIpc(
  ipcMain: IpcMain,
  store: DbConnectionStore,
  postgres: PostgresService,
  conversations: ConversationStore,
  broadcast: () => void,
  host: DbIpcHost,
  duckdb?: DuckDbService
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
  ipcMain.handle(IPC.dbCreateFromFile, async (_event, sourcePath: string) => {
    const path = String(sourcePath ?? '').trim()
    if (!path || !isDataFilePath(path)) return null
    host.grantPath?.(path)
    const conversation = host.createDefinitionConversation()
    const title = dataFileTitle(path)
    conversations.updateMeta(conversation.id, {
      sessionKind: 'db',
      dataFilePath: path,
      title
    })
    host.publishConversations()
    broadcast()
    const next = conversations.get(conversation.id) ?? conversation
    return {
      conversation: conversationToMeta(next),
      path,
      format: dataFileFormat(path)
    }
  })
  ipcMain.handle(IPC.dbFileSchema, async (_event, sourcePath: string) => {
    const path = String(sourcePath ?? '').trim()
    if (!path || !duckdb) return { error: 'DuckDB is unavailable' }
    host.grantPath?.(path)
    const inspected = await duckdb.schema(path)
    if ('error' in inspected) return inspected
    return { tables: inspected.tables }
  })
  ipcMain.handle(
    IPC.dbFileQuery,
    async (_event, sourcePath: string, sql: string) => {
      const path = String(sourcePath ?? '').trim()
      if (!path || !duckdb) {
        return { columns: [], rows: [], total: 0, offset: 0, limit: 0, error: 'DuckDB is unavailable' }
      }
      host.grantPath?.(path)
      const result = await duckdb.query(path, String(sql ?? ''))
      return {
        columns: result.columns,
        rows: result.rows,
        total: result.rowCount,
        offset: 0,
        limit: result.rows.length,
        error: result.error
      }
    }
  )
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
    if (!conversation || conversation.dataFilePath) return null
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
      const before = store.get(id)
      const previousAuto = before ? dbConnectionTitle({ ...before, title: '' }) : ''
      const connection = store.update(id, patch)
      if (connection?.conversationId) {
        const conversation = conversations.get(connection.conversationId)
        const named = typeof patch.title === 'string' ? patch.title.trim() : ''
        const auto = dbConnectionTitle({ ...connection, title: '' })
        const nextTitle = named || auto || UNTITLED_DB_CONNECTION
        if (
          conversation &&
          (named ||
            isDefaultSessionTitle(conversation.title) ||
            isReplaceableDbTitle(conversation.title, connection, previousAuto))
        ) {
          if (conversation.title !== nextTitle) {
            conversations.updateMeta(connection.conversationId, { title: nextTitle })
            host.publishConversations()
          }
        }
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
      const display = dbConnectionTitle({ ...connection, title: '' }) || UNTITLED_DB_CONNECTION
      if (
        conversation &&
        (isDefaultSessionTitle(conversation.title) || isReplaceableDbTitle(conversation.title, connection))
      ) {
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
