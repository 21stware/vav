import type { MouseEvent } from 'react'
import { conversationSelectionRunClass } from './sidebarList'

export type AppListSort = 'updated' | 'name' | 'created'

export type AppListRowMeta = {
  title: string
  updatedAt: number
  createdAt: number
}

export function textMatchesQuery(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle))
}

export function compareAppListRows(a: AppListRowMeta, b: AppListRowMeta, sort: AppListSort): number {
  if (sort === 'name') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  if (sort === 'created') return b.createdAt - a.createdAt
  return b.updatedAt - a.updatedAt
}

export function applyAppObjectList<T>(
  rows: readonly T[],
  opts: {
    query: string
    sort: AppListSort
    fields: (row: T) => Array<string | null | undefined>
    meta: (row: T) => AppListRowMeta
    include?: (row: T) => boolean
  }
): T[] {
  return rows
    .filter((row) => (opts.include ? opts.include(row) : true) && textMatchesQuery(opts.query, ...opts.fields(row)))
    .sort((a, b) => compareAppListRows(opts.meta(a), opts.meta(b), opts.sort))
}

export function appObjectPointerHandlers(opts: {
  onSelect: (event: MouseEvent) => void
  onOpen: () => void
  onMenu?: (event: MouseEvent) => void
}): {
  onClick: (event: MouseEvent) => void
  onDoubleClick: (event: MouseEvent) => void
  onContextMenu: (event: MouseEvent) => void
} {
  return {
    onClick: (event) => {
      if (event.detail > 1) return
      opts.onSelect(event)
    },
    onDoubleClick: (event) => {
      event.preventDefault()
      opts.onOpen()
    },
    onContextMenu: (event) => {
      event.preventDefault()
      event.stopPropagation()
      opts.onMenu?.(event)
    }
  }
}

/** Finder-style: right-click inside a multi-selection keeps the set. */
export function appObjectContextTargets(
  id: string,
  selectedIds: readonly string[]
): { ids: string[]; collapse: boolean } {
  if (selectedIds.length > 1 && selectedIds.includes(id)) {
    return { ids: [...selectedIds], collapse: false }
  }
  return { ids: [id], collapse: selectedIds.length > 1 }
}

export function appObjectSelectionMods(
  id: string,
  selectedIds: readonly string[],
  orderedIds: readonly string[]
): string {
  const run = conversationSelectionRunClass(id, [...selectedIds], [...orderedIds])
  return run ? `multi ${run}` : ''
}

export function appObjectRowClassName(
  id: string,
  selectedIds: readonly string[],
  orderedIds: readonly string[],
  base = 'applications-object-row'
): string {
  const mods = appObjectSelectionMods(id, selectedIds, orderedIds)
  return mods ? `${base} ${mods}` : base
}

export type AppObjectListKeyAction =
  | { type: 'move'; id: string; range: boolean }
  | { type: 'delete' }
  | { type: 'selectAll' }

/** Session-list key bindings: arrows, delete, cmd/ctrl-A. */
export function appObjectListKeyAction(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  orderedIds: readonly string[],
  focusedId: string | null
): AppObjectListKeyAction | null {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const index = orderedIds.indexOf(focusedId ?? '')
    const next = orderedIds[index + (event.key === 'ArrowDown' ? 1 : -1)]
    return next ? { type: 'move', id: next, range: event.shiftKey } : null
  }
  if (event.key === 'Backspace' || event.key === 'Delete') return { type: 'delete' }
  if (event.key === 'a' && (event.metaKey || event.ctrlKey)) return { type: 'selectAll' }
  return null
}

export function menuPoint(event: MouseEvent): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY }
}
