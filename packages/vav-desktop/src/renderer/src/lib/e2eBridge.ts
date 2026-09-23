import { resolveAppColumnContext } from './appColumnContext'
import { useSessionStore } from '../state/sessionStore'
import { insertAgentPrompt } from './insertAgentPrompt'
import { openInApp } from './openInApp'

export type VavE2eContextPeek = {
  activeId: string
  applicationsMode: string
  applicationsDetailOpen: boolean
  focusedAppObjectId: string | null
  selectedAppObjectIds: string[]
  commentCards: { filePath: string; label: string }[]
  focusedFilePath: string | null
  contextFile: string | null
  storageBrowsePath: string | null
  applicationsVisible: boolean
  appContextLevel: 'list' | 'item' | 'selected' | null
  appColumnFocus: {
    kind: string
    level: 'list' | 'item' | 'selected'
    title: string
    path: string | null
    objectId: string | null
    table?: string | null
  } | null
  draft: string
}

declare global {
  interface Window {
    __vavE2e?: {
      createDataFromFile: (path: string) => Promise<void>
      createKnowledgeNote: () => Promise<void>
      peekContext: () => VavE2eContextPeek
      openInApp: (path: string) => Promise<void>
      browseStorage: (path: string) => void
      insertAgentPrompt: (text: string) => string | null
    }
  }
}

/** Playwright-only store hook. Installed when the e2e popup-menu probe exists. */
export function installE2eBridge(): () => void {
  if (typeof window.vav?.window?.peekPopupMenu !== 'function') return () => undefined
  window.__vavE2e = {
    createDataFromFile: (path) => useSessionStore.getState().createDataFromFile(path),
    createKnowledgeNote: () => useSessionStore.getState().createKnowledgeNote(),
    openInApp: (path) => openInApp(path),
    browseStorage: (path) => useSessionStore.getState().browseStoragePath(path),
    insertAgentPrompt: (text) => insertAgentPrompt(text),
    peekContext: () => {
      const state = useSessionStore.getState()
      const active = state.conversations.find((row) => row.id === state.activeId)
      const cards = state.commentCards[state.activeId] ?? []
      const appContext = resolveAppColumnContext(state)
      return {
        activeId: state.activeId,
        applicationsMode: state.applicationsMode,
        applicationsDetailOpen: state.applicationsDetailOpen,
        focusedAppObjectId: state.focusedAppObjectId,
        selectedAppObjectIds: state.selectedAppObjectIds,
        commentCards: cards.map((card) => ({
          filePath: card.ref.filePath,
          label: card.ref.label
        })),
        focusedFilePath: active?.focusedFilePath ?? null,
        contextFile: state.contextFiles[state.activeId] ?? null,
        storageBrowsePath: state.storageBrowsePath,
        applicationsVisible: state.applicationsVisible,
        appContextLevel: appContext?.level ?? null,
        appColumnFocus: active?.appColumnFocus
          ? {
              kind: active.appColumnFocus.kind,
              level: active.appColumnFocus.level,
              title: active.appColumnFocus.title,
              path: active.appColumnFocus.path,
              objectId: active.appColumnFocus.objectId,
              table: active.appColumnFocus.table ?? null
            }
          : null,
        draft: state.activeId ? (state.drafts[state.activeId] ?? '') : ''
      }
    }
  }
  return () => {
    delete window.__vavE2e
  }
}
