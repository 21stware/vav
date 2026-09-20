import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { conversationToMeta } from '../store/conversationMeta'
import type { KnowledgeStore } from '../store/KnowledgeStore'
import type { ConversationStore } from '../store/ConversationStore'
import type { Conversation } from '@shared/types'
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
  ipcMain.handle(IPC.knowledgeCreateNote, async () => {
    const conversation = host.createDefinitionConversation()
    const knowledge = store.createNote('', conversation.id)
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
  ipcMain.handle(IPC.knowledgeImportDocument, async (_event, sourcePath: string) => {
    const path = String(sourcePath ?? '').trim()
    if (!path) return null
    const conversation = host.createDefinitionConversation()
    const knowledge = store.importDocument(path, conversation.id, retrieval)
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
}
