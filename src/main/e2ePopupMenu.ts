import type { NativeMenuItem } from '@shared/ipc'

export interface NativeMenuPeekItem {
  id?: string
  label?: string
  checked?: boolean
}

type PendingMenu = {
  items: NativeMenuItem[]
  resolve: (id: string | null) => void
}

let pending: PendingMenu | null = null

function walkSelectable(
  items: NativeMenuItem[],
  visit: (item: NativeMenuItem) => string | null | void,
  opts?: { includeHeaders?: boolean }
): string | null {
  for (const item of items) {
    if (item.separator) continue
    if (item.header && !opts?.includeHeaders) continue
    if (item.submenu && item.submenu.length > 0) {
      const nested = walkSelectable(item.submenu, visit, opts)
      if (nested) return nested
      continue
    }
    const hit = visit(item)
    if (typeof hit === 'string') return hit
  }
  return null
}

/** Skip AppKit in e2e; keep the same item ids the renderer would receive. */
export function e2ePopupMenu(items: NativeMenuItem[]): Promise<string | null> {
  pending?.resolve(null)
  return new Promise((resolve) => {
    pending = { items, resolve }
  })
}

export function e2ePeekPopupMenu(): NativeMenuPeekItem[] | null {
  if (!pending) return null
  const rows: NativeMenuPeekItem[] = []
  walkSelectable(
    pending.items,
    (item) => {
      rows.push({ id: item.id, label: item.label, checked: item.checked })
    },
    { includeHeaders: true }
  )
  return rows
}

export function e2eChoosePopupMenu(idOrLabel: string): boolean {
  if (!pending) return false
  const id = walkSelectable(pending.items, (item) =>
    item.id === idOrLabel || item.label === idOrLabel ? (item.id ?? '') : undefined
  )
  if (id === null) return false
  const resolve = pending.resolve
  pending = null
  resolve(id || null)
  return true
}

export function e2eDismissPopupMenu(): boolean {
  if (!pending) return false
  const resolve = pending.resolve
  pending = null
  resolve(null)
  return true
}
