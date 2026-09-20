import { isDataFilePath } from '@shared/dataFile'
import { isKnowledgeDocPath } from '@shared/knowledge'
import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import type { MenuItem } from './nativeMenu'

/** Storage → Data / Knowledge actions for a file path. */
export function storageCrossSurfaceItems(path: string): MenuItem[] {
  const items: MenuItem[] = []
  if (isDataFilePath(path)) {
    items.push({
      label: tt('storage.analyzeAsData'),
      onSelect: () => void useSessionStore.getState().createDataFromFile(path)
    })
  }
  if (isKnowledgeDocPath(path)) {
    items.push({
      label: tt('storage.addToKnowledge'),
      onSelect: () => void useSessionStore.getState().importKnowledgeDocument(path)
    })
  }
  return items
}
