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

export {}
