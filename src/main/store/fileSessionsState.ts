export type FileSessionRow = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

/** Lean snapshot the renderer hydrates into the file-preview session switcher. */
export function toFileSessionsState(
  fileId: string,
  activeSessionId: string,
  sessions: FileSessionRow[]
): { fileId: string; activeSessionId: string; sessions: FileSessionRow[] } {
  return { fileId, activeSessionId, sessions }
}
