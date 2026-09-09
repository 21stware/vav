/**
 * In-window workspace-file drag, used when native `startDrag` hides HTML5 data.
 * Drop on the conversation surface reads this list and pins composer attachments.
 */
let inAppPaths: string[] | null = null

export const VAV_FILE_PATHS_TYPE = 'application/x-vav-file-paths'

export function beginInAppFileDrag(paths: string[]): void {
  const next = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
  inAppPaths = next.length > 0 ? next : null
}

export function peekInAppFileDrag(): string[] {
  return inAppPaths ?? []
}

export function clearInAppFileDrag(): void {
  inAppPaths = null
}

export function takeInAppFileDrag(): string[] {
  const next = peekInAppFileDrag()
  clearInAppFileDrag()
  return next
}
