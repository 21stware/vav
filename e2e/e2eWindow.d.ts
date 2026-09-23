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

export {}
