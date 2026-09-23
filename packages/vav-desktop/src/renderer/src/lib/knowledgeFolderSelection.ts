import { useSyncExternalStore } from 'react'
import { KNOWLEDGE_ALL_NOTES_ID } from '@shared/knowledge'

let current = KNOWLEDGE_ALL_NOTES_ID
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function knowledgeFolderId(): string {
  return current
}

export function setKnowledgeFolderId(id: string): void {
  const next = id.trim() || KNOWLEDGE_ALL_NOTES_ID
  if (next === current) return
  current = next
  emit()
}

export function useKnowledgeFolderId(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
    () => KNOWLEDGE_ALL_NOTES_ID
  )
}
