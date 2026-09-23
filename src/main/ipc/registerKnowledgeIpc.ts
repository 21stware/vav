import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { conversationToMeta } from '../store/conversationMeta'
import type { KnowledgeStore } from '../store/KnowledgeStore'
import type { ConversationStore } from '../store/ConversationStore'
import type { Conversation } from '@shared/types'
import { KNOWLEDGE_ALL_NOTES_ID } from '@shared/knowledge'
import type { DocumentRetrievalService } from '../retrieval/DocumentRetrievalService'

export type KnowledgeIpcHost = {
  createDefinitionConversation: () => Conversation
  publishConversations: () => void
}

export function registerKnowledgeIpc(
  ipcMain: IpcMain,
  store: KnowledgeStore,
  conversations: ConversationStore,
  retrieval: DocumentRetrievalService,
  broadcast: () => void,
  host: KnowledgeIpcHost
): void {
  ipcMain.handle(IPC.knowledgeList, async () => store.list())
  ipcMain.handle(IPC.knowledgeGet, async (_event, id: string) => store.get(String(id ?? '')) ?? null)
  ipcMain.handle(IPC.knowledgeGetForConversation, async (_event, conversationId: string) => {
    return store.getForConversation(String(conversationId ?? '')) ?? null
  })
  ipcMain.handle(IPC.knowledgeCreateNote, async (_event, folderId?: string | null) => {
    const conversation = host.createDefinitionConversation()
    const knowledge = store.createNote('', conversation.id, Date.now(), folderOrNull(store, folderId))
    conversations.updateMeta(conversation.id, {
      knowledgeHostId: knowledge.id,
      sessionKind: 'knowledge',
      title: knowledge.title
    })
    host.publishConversations()
    broadcast()
    const next = conversations.get(conversation.id) ?? conversation
    return { host: knowledge, conversation: conversationToMeta(next) }
  })
  ipcMain.handle(
    IPC.knowledgeImportDocument,
    async (_event, sourcePath: string, folderId?: string | null) => {
    const path = String(sourcePath ?? '').trim()
    if (!path) return null
    const conversation = host.createDefinitionConversation()
    const knowledge = store.importDocument(
      path,
      conversation.id,
      retrieval,
      Date.now(),
      folderOrNull(store, folderId)
    )
    conversations.updateMeta(conversation.id, {
      knowledgeHostId: knowledge.id,
      sessionKind: 'knowledge',
      title: knowledge.title
    })
    host.publishConversations()
    broadcast()
    const next = conversations.get(conversation.id) ?? conversation
    return { host: knowledge, conversation: conversationToMeta(next) }
  })
  ipcMain.handle(IPC.knowledgeReadNote, async (_event, id: string) => {
    return store.readNote(String(id ?? ''))
  })
  ipcMain.handle(IPC.knowledgeWriteNote, async (_event, id: string, markdown: string) => {
    const note = store.writeNote(String(id ?? ''), String(markdown ?? ''))
    if (note) {
      const knowledge = store.get(note.hostId)
      if (knowledge?.conversationId && knowledge.title.trim()) {
        conversations.updateMeta(knowledge.conversationId, { title: knowledge.title })
        host.publishConversations()
      }
      broadcast()
    }
    return note
  })
  ipcMain.handle(IPC.knowledgeRename, async (_event, id: string, title: string) => {
    const knowledge = store.rename(String(id ?? ''), String(title ?? ''))
    if (knowledge?.conversationId && knowledge.title.trim()) {
      conversations.updateMeta(knowledge.conversationId, { title: knowledge.title })
      host.publishConversations()
    }
    if (knowledge) broadcast()
    return knowledge
  })
  ipcMain.handle(IPC.knowledgeRemove, async (_event, id: string) => {
    const ok = store.remove(String(id ?? ''))
    if (ok) broadcast()
    return ok
  })
  ipcMain.handle(IPC.knowledgeRefresh, async (_event, id: string) => {
    const knowledge = await store.refreshChunks(String(id ?? ''), retrieval)
    if (knowledge) broadcast()
    return knowledge
  })
  ipcMain.handle(IPC.knowledgeListFolders, async () => store.listFolders())
  ipcMain.handle(IPC.knowledgeCreateFolder, async (_event, name: string) => {
    const folder = store.createFolder(String(name ?? ''))
    broadcast()
    return folder
  })
  ipcMain.handle(IPC.knowledgeRenameFolder, async (_event, id: string, name: string) => {
    const folder = store.renameFolder(String(id ?? ''), String(name ?? ''))
    if (folder) broadcast()
    return folder
  })
  ipcMain.handle(IPC.knowledgeRemoveFolder, async (_event, id: string) => {
    const ok = store.removeFolder(String(id ?? ''))
    if (ok) broadcast()
    return ok
  })
  ipcMain.handle(IPC.knowledgeMove, async (_event, ids: string[], folderId: string | null) => {
    const requested = typeof folderId === 'string' ? folderId.trim() : ''
    if (requested && requested !== KNOWLEDGE_ALL_NOTES_ID && !store.getFolder(requested)) return false
    const moved = store.moveToFolder(
      Array.isArray(ids) ? ids.map(String) : [],
      requested && requested !== KNOWLEDGE_ALL_NOTES_ID ? requested : null
    )
    if (moved && moved.length) broadcast()
    return moved != null
  })
}

function folderOrNull(store: KnowledgeStore, folderId: string | null | undefined): string | null {
  const requested = typeof folderId === 'string' ? folderId.trim() : ''
  if (!requested || requested === KNOWLEDGE_ALL_NOTES_ID) return null
  return store.getFolder(requested) ? requested : null
}
