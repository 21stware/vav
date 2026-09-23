import type { AppColumnFocus } from '@shared/appColumnFocus'
import { appColumnResourceUrl } from '@shared/appColumnFocus'
import type { MessageKey } from '@shared/i18n'
import {
  isDbSession,
  isKnowledgeSession,
  isTimerDefinition,
  type SessionKind
} from '@shared/sessionKind'
import type { StorageSource } from '@shared/storageSource'
import type { PreviewRef } from '@shared/types'
import { applicationsModeForConversation } from './applicationsWidth'
import { basename } from './path'
import { isBrowsableStorageSource } from './storageSources'
import type { ApplicationsMode } from '../state/sessionTypes'

export type AppContextLevel = 'list' | 'item' | 'selected'

export type AppColumnContextObject = {
  id: string
  title: string
  fileId?: string | null
  sessionKind?: SessionKind | null
  timerRunId?: string | null
  workingDirectory?: string | null
  dataFilePath?: string | null
  focusedDbTable?: string | null
  focusedFilePath?: string | null
  knowledgeHostId?: string | null
}

export type AppColumnContextState = {
  applicationsVisible: boolean
  applicationsMode: ApplicationsMode
  applicationsDetailOpen: boolean
  focusedAppObjectId: string | null
  storageBrowsePath: string | null
  filesSource: StorageSource
  filePreviewOpen: boolean
  activeDbTable: string | null
  activeId: string
  conversations: AppColumnContextObject[]
  commentCards: Record<string, Array<{ ref: PreviewRef; comment: string }>>
}

export type AppColumnContext = {
  level: AppContextLevel
  kind: ApplicationsMode
  /** Kind catalog / folder / highlighted row / open object. */
  title: string
  /** Open object name when level is selected. */
  parent?: string
  path: string | null
  objectId: string | null
  /** Live-DB / sheet table when a Data item is open. */
  table?: string | null
  storageSource?: StorageSource
  selectionLabel?: string
  selectionCount: number
}

const KIND_TITLE_FALLBACK: Record<ApplicationsMode, string> = {
  storage: 'Storage',
  data: 'Analysis',
  knowledge: 'Notes',
  scheduled: 'Schedule',
  devices: 'Devices'
}

export const APP_CONTEXT_KIND_KEY: Record<ApplicationsMode, MessageKey> = {
  storage: 'sidebar.category.storage',
  data: 'sidebar.category.data',
  knowledge: 'sidebar.category.knowledge',
  scheduled: 'sidebar.category.scheduled',
  devices: 'sidebar.devices'
}

/**
 * Primary document an app object advertises to the agent.
 *
 * A Storage file session's `workingDirectory` is the *enclosing folder*; the
 * open document is `focusedFilePath`. Preferring the folder made the app column
 * tell the agent "open Storage file: <folder>" for a previewed PDF / markdown —
 * so `focusedFilePath` wins whenever this row is a real open document
 * (knowledge note or file session), not just a workdir-scoped chat.
 */
function documentPathOf(row: AppColumnContextObject): string | null {
  if (isKnowledgeSession(row)) {
    return row.focusedFilePath?.trim() || row.workingDirectory?.trim() || null
  }
  if (row.dataFilePath?.trim()) return row.dataFilePath.trim()
  if (row.fileId) {
    return row.focusedFilePath?.trim() || row.workingDirectory?.trim() || null
  }
  return row.workingDirectory?.trim() || row.focusedFilePath?.trim() || null
}

function objectPath(row: AppColumnContextObject | undefined, table?: string | null): string | null {
  if (!row) return null
  const doc = documentPathOf(row)
  if (row.dataFilePath?.trim() && doc) {
    const focused = table?.trim() || row.focusedDbTable?.trim()
    return focused ? `${doc}/${focused}` : doc
  }
  return doc
}

function objectTitle(row: AppColumnContextObject | undefined, table?: string | null): string {
  if (!row) return ''
  if (isKnowledgeSession(row)) return row.title.trim()
  const doc = documentPathOf(row)
  const base = (doc ? basename(doc) : '') || row.title.trim()
  const focused = table?.trim() || row.focusedDbTable?.trim()
  if (focused && row.dataFilePath) return `${base} · ${focused}`
  return base
}

function commentMatchesPath(
  filePath: string,
  itemPath: string | null
): boolean {
  if (!itemPath) return true
  if (filePath === itemPath) return true
  return filePath.startsWith(`${itemPath}/`) || filePath.startsWith(`${itemPath}\\`)
}

export function commentCardsForAppItem<T extends { ref: { filePath: string } }>(
  cards: readonly T[],
  itemPath: string | null
): T[] {
  if (cards.length === 0) return []
  if (!itemPath) return [...cards]
  return cards.filter((card) => commentMatchesPath(card.ref.filePath, itemPath))
}

export function selectionLabelOf(
  cards: ReadonlyArray<{ ref: { label?: string; startLine?: number; endLine?: number } }>
): string {
  if (cards.length === 0) return ''
  if (cards.length > 1) return ''
  const ref = cards[0]!.ref
  if (ref.label?.trim()) return ref.label.trim()
  if (ref.startLine != null && ref.endLine != null) {
    return ref.startLine === ref.endLine
      ? `L${ref.startLine}`
      : `L${ref.startLine}–${ref.endLine}`
  }
  return ''
}

function focusedObject(state: AppColumnContextState): AppColumnContextObject | undefined {
  if (!state.focusedAppObjectId) return undefined
  const row = state.conversations.find((item) => item.id === state.focusedAppObjectId)
  if (!row) return undefined
  const mode = applicationsModeForConversation(row)
  if (mode && mode !== state.applicationsMode) return undefined
  return row
}

export function appColumnHasDetail(state: AppColumnContextState): boolean {
  const focused = focusedObject(state)
  switch (state.applicationsMode) {
    case 'storage':
      return !!(focused?.fileId || state.filePreviewOpen)
    case 'scheduled':
      return !!focused && isTimerDefinition(focused)
    case 'data':
      return !!focused && isDbSession(focused)
    case 'knowledge':
      return !!focused && isKnowledgeSession(focused)
    case 'devices':
      return false
  }
}

/** Current app-column focus. Null when the app column is collapsed. */
export function resolveAppColumnContext(state: AppColumnContextState): AppColumnContext | null {
  if (!state.applicationsVisible) return null

  const kind = state.applicationsMode
  const focused = focusedObject(state)
  const showingDetail = state.applicationsDetailOpen && appColumnHasDetail(state)
  const table = state.activeDbTable
  const path = objectPath(focused, table)
  const itemTitle = objectTitle(focused, table)
  const cards = commentCardsForAppItem(state.commentCards[state.activeId] ?? [], path)

  if (showingDetail && cards.length > 0) {
    return {
      level: 'selected',
      kind,
      title: itemTitle || KIND_TITLE_FALLBACK[kind],
      parent: itemTitle || undefined,
      path,
      objectId: focused?.id ?? null,
      table: kind === 'data' ? table?.trim() || null : null,
      selectionLabel: selectionLabelOf(cards) || undefined,
      selectionCount: cards.length
    }
  }

  if (showingDetail) {
    return {
      level: 'item',
      kind,
      title: itemTitle || KIND_TITLE_FALLBACK[kind],
      path,
      objectId: focused?.id ?? null,
      table: kind === 'data' ? table?.trim() || null : null,
      selectionCount: 0
    }
  }

  const source = state.filesSource ?? 'recent'
  const browse =
    kind === 'storage' && isBrowsableStorageSource(source)
      ? state.storageBrowsePath?.trim() || null
      : null
  const listDetail =
    kind === 'storage' && browse
      ? basename(browse) || browse
      : itemTitle || ''

  return {
    level: 'list',
    kind,
    title: listDetail,
    path: kind === 'storage' ? browse : null,
    objectId: focused && !showingDetail ? focused.id : null,
    storageSource: kind === 'storage' ? source : undefined,
    selectionCount: 0
  }
}

export function appColumnContextEqual(
  a: AppColumnContext | null,
  b: AppColumnContext | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.level === b.level &&
    a.kind === b.kind &&
    a.title === b.title &&
    a.parent === b.parent &&
    a.path === b.path &&
    a.objectId === b.objectId &&
    (a.table ?? null) === (b.table ?? null) &&
    a.storageSource === b.storageSource &&
    a.selectionLabel === b.selectionLabel &&
    a.selectionCount === b.selectionCount
  )
}

/**
 * Zustand 5 + React 19: `getSnapshot` must return the same reference when
 * the store has not changed. `resolveAppColumnContext` always allocates.
 */
let cachedAppColumnContext: AppColumnContext | null | undefined

export function selectAppColumnContext(state: AppColumnContextState): AppColumnContext | null {
  const next = resolveAppColumnContext(state)
  if (cachedAppColumnContext !== undefined && appColumnContextEqual(cachedAppColumnContext, next)) {
    return cachedAppColumnContext
  }
  cachedAppColumnContext = next
  return next
}

/** Path the workspace agent should treat as the open file (item / selected only). */
export function appColumnFocusPath(context: AppColumnContext | null): string | null {
  if (!context) return null
  if (context.level === 'list') return null
  return context.path
}

/** Real filesystem path for tool defaults — Data uses the file, not `file/table`. */
export function appColumnFilePath(
  context: AppColumnContext | null,
  object?: AppColumnContextObject | null
): string | null {
  if (!context || context.level === 'list') return null
  if (context.kind === 'data') return object?.dataFilePath?.trim() || null
  return context.path
}

export function appColumnFocusFromContext(
  context: AppColumnContext | null,
  object?: AppColumnContextObject | null
): AppColumnFocus | null {
  if (!context) return null
  const filePath = appColumnFilePath(context, object)
  const path = context.level === 'list' ? context.path : filePath
  const table = context.kind === 'data' ? context.table?.trim() || null : null
  return {
    kind: context.kind,
    level: context.level,
    title: context.title,
    path,
    objectId: context.objectId,
    url: appColumnResourceUrl({
      kind: context.kind,
      level: context.level,
      objectId: context.objectId,
      path,
      knowledgeHostId: object?.knowledgeHostId
    }),
    table,
    selectionLabel: context.selectionLabel ?? null
  }
}

/**
 * Focus snapshot for an outbound turn.
 * A highlighted list row is the write target even if the editor is not open.
 */
export function appColumnFocusForSend(
  context: AppColumnContext | null,
  object?: AppColumnContextObject | null
): AppColumnFocus | null {
  if (!context) return null
  if (context.level === 'list' && context.objectId && object) {
    const table = context.kind === 'data' ? context.table?.trim() || null : null
    return appColumnFocusFromContext(
      {
        ...context,
        level: 'item',
        title: objectTitle(object, table) || context.title,
        path: objectPath(object, table),
        parent: undefined,
        selectionCount: 0,
        selectionLabel: undefined
      },
      object
    )
  }
  return appColumnFocusFromContext(context, object)
}

export function appColumnFocusForSendFromState(state: AppColumnContextState): AppColumnFocus | null {
  if (!state.applicationsVisible) return null
  const context = resolveAppColumnContext(state)
  const object = context?.objectId
    ? state.conversations.find((row) => row.id === context.objectId)
    : undefined
  return appColumnFocusForSend(context, object)
}
