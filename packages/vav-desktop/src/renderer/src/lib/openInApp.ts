/**
 * Open a path or `vav://app/…` URL in the right-hand app column.
 * Workspace agent stays put — app objects are not sessions.
 */
import { isClipPath } from '@shared/clipPath'
import { isDataFilePath } from '@shared/dataFile'
import {
  formatAppResourceUrl,
  isAppCatalogUrl,
  parseAppResourceUrl,
  type AppResourceKind,
  type AppResourceRef
} from '@shared/appResourceUrl'
import { looksLikeVisualOverlay } from '@shared/previewOverlay'
import { isAppObjectSession } from '@shared/sessionKind'
import { useSessionStore } from '../state/sessionStore'
import type { ApplicationsMode } from '../state/sessionTypes'
import { openFileSessionFromPath } from './openFileSession'
import { resolveMentionedPath } from './filePathLinks'
import { openAttachmentPreview } from './openSessionFile'

export { planOpenInApp } from '@shared/appResourceUrl'

function modeForKind(kind: AppResourceKind): ApplicationsMode {
  return kind
}

function resolveRawPath(raw: string): string {
  const state = useSessionStore.getState()
  const conv = state.conversations.find((row) => row.id === state.activeId)
  return resolveMentionedPath(raw, conv?.workingDirectory ?? null, state.home || '')
}

function findObjectId(ref: AppResourceRef): string | null {
  const { conversations } = useSessionStore.getState()
  if (ref.id) {
    const byId = conversations.find((row) => row.id === ref.id)
    if (byId) return byId.id
    const byHost = conversations.find((row) => row.knowledgeHostId === ref.id)
    if (byHost) return byHost.id
  }
  if (ref.path) {
    const byFile = conversations.find(
      (row) =>
        isAppObjectSession(row) &&
        (row.workingDirectory === ref.path ||
          row.dataFilePath === ref.path ||
          row.focusedFilePath === ref.path)
    )
    if (byFile) return byFile.id
  }
  return null
}

export async function openInApp(raw: string): Promise<void> {
  const trimmed = raw.trim()
  if (!trimmed) return
  const ref = parseAppResourceUrl(trimmed)
  if (isAppCatalogUrl(trimmed) || (ref && !ref.path && !ref.id)) {
    const store = useSessionStore.getState()
    if (!ref || ref.kind === 'storage') store.showFileList()
    else store.setApplicationsMode(modeForKind(ref.kind))
    return
  }

  if (ref?.id) {
    const id = findObjectId(ref)
    if (id) {
      useSessionStore.getState().openAppObject(id)
      return
    }
  }

  const path = ref?.path || resolveRawPath(trimmed)
  if (!path) return
  if (looksLikeVisualOverlay(path) || isClipPath(path)) {
    openAttachmentPreview(path, useSessionStore.getState().activeId)
    return
  }

  if (ref?.dir) {
    useSessionStore.getState().browseStoragePath(path)
    return
  }

  try {
    const info = await window.vav.files.inspect(path)
    if (info.kind === 'directory' || ref?.dir) {
      useSessionStore.getState().browseStoragePath(path)
      return
    }
  } catch {
    // Missing / unreadable: still try as a file session.
  }

  if (ref?.kind === 'data' && isDataFilePath(path)) {
    const existing = useSessionStore
      .getState()
      .conversations.find((row) => row.sessionKind === 'db' && row.dataFilePath === path)
    if (existing) {
      useSessionStore.getState().openAppObject(existing.id)
      return
    }
  }

  const opened = await openFileSessionFromPath(path)
  if (opened) return
  useSessionStore.getState().browseStoragePath(path)
}

/** Path the app column should advertise back to the agent (mention / tools). */
export function appResourceUrlForPath(
  path: string,
  opts?: { dir?: boolean; kind?: AppResourceKind }
): string {
  return formatAppResourceUrl({
    kind: opts?.kind ?? 'storage',
    path,
    ...(opts?.dir ? { dir: true } : {})
  })
}
