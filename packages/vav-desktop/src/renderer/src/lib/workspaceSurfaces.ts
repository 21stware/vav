import { isDataFilePath } from '@shared/dataFile'
import { isKnowledgeDocPath } from '@shared/knowledge'
import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'

export { isDataFilePath, isKnowledgeDocPath }

export async function openPathAsData(path: string): Promise<string | null> {
  const store = useSessionStore.getState()
  if (!window.vav?.db?.createFromFile) return null
  try {
    const existing = store.conversations.find(
      (row) => row.sessionKind === 'db' && row.dataFilePath === path && !row.archived
    )
    if (existing) {
      store.setApplicationsMode('data')
      await store.selectConversation(existing.id)
      return existing.id
    }
    const created = await window.vav.db.createFromFile(path)
    if (!created) return null
    store.setApplicationsMode('data')
    await store.selectConversation(created.conversation.id)
    return created.conversation.id
  } catch (err) {
    store.showToast({
      kind: 'error',
      title: tt('data.addFileFailed'),
      description: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}

export async function importPathAsKnowledge(path: string): Promise<string | null> {
  const store = useSessionStore.getState()
  if (!window.vav?.knowledge?.importDocument) return null
  try {
    const created = await window.vav.knowledge.importDocument(path)
    if (!created) return null
    store.setApplicationsMode('knowledge')
    await store.selectConversation(created.conversation.id)
    return created.conversation.id
  } catch (err) {
    store.showToast({
      kind: 'error',
      title: tt('knowledge.importFailed'),
      description: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}
