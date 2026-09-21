import { useSessionStore } from '../state/sessionStore'

export type VavE2eContextPeek = {
  activeId: string
  applicationsMode: string
  focusedAppObjectId: string | null
  commentCards: { filePath: string; label: string }[]
  focusedFilePath: string | null
  contextFile: string | null
}

declare global {
  interface Window {
    __vavE2e?: {
      createDataFromFile: (path: string) => Promise<void>
      peekContext: () => VavE2eContextPeek
    }
  }
}

/** Playwright-only store hook. Installed when the e2e popup-menu probe exists. */
export function installE2eBridge(): () => void {
  if (typeof window.vav?.window?.peekPopupMenu !== 'function') return () => undefined
  window.__vavE2e = {
    createDataFromFile: (path) => useSessionStore.getState().createDataFromFile(path),
    peekContext: () => {
      const state = useSessionStore.getState()
      const active = state.conversations.find((row) => row.id === state.activeId)
      const cards = state.commentCards[state.activeId] ?? []
      return {
        activeId: state.activeId,
        applicationsMode: state.applicationsMode,
        focusedAppObjectId: state.focusedAppObjectId,
        commentCards: cards.map((card) => ({
          filePath: card.ref.filePath,
          label: card.ref.label
        })),
        focusedFilePath: active?.focusedFilePath ?? null,
        contextFile: state.contextFiles[state.activeId] ?? null
      }
    }
  }
  return () => {
    delete window.__vavE2e
  }
}
