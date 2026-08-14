import type { NativeMenuItem } from '@shared/ipc'
import { tt } from '../i18n/useT'

export interface MenuItem {
  label: string
  /** macOS has no destructive style for popup menus; kept for call-site intent. */
  destructive?: boolean
  disabled?: boolean
  checked?: boolean
  divider?: boolean
  submenu?: MenuItem[]
  onSelect?: () => void
}

function toNativeItems(
  items: MenuItem[],
  handlers: Map<string, () => void>,
  prefix = ''
): NativeMenuItem[] {
  return items.map((item, index) => {
    const id = prefix ? `${prefix}.${index}` : String(index)
    if (item.divider) return { separator: true }
    if (item.submenu && item.submenu.length > 0) {
      return {
        id,
        label: item.label,
        enabled: !item.disabled,
        submenu: toNativeItems(item.submenu, handlers, id)
      }
    }
    if (item.onSelect) handlers.set(id, item.onSelect)
    return {
      id,
      label: item.label,
      enabled: !item.disabled,
      checked: item.checked
    }
  })
}

/**
 * Pops a real AppKit menu and runs the chosen row's handler.
 *
 * Menus are rendered by the system rather than the DOM, so they can escape the
 * window, honour the user's appearance and reduce-motion settings, and dismiss
 * with the same gestures as every other app.
 */
export async function showMenu(
  items: MenuItem[],
  position?: { x: number; y: number }
): Promise<void> {
  const handlers = new Map<string, () => void>()
  const payload = toNativeItems(items, handlers)
  const chosen = await window.vav.window.popupMenu(payload, position)
  if (chosen === null) return
  handlers.get(chosen)?.()
}

/** Anchors a menu under a button, the way a pull-down control behaves. */
export function menuAnchor(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
}

/** Same as {@link menuAnchor} when the trigger is on-screen; otherwise omit. */
export function menuAnchorIfVisible(
  element: HTMLElement | null | undefined
): { x: number; y: number } | undefined {
  if (!element) return undefined
  const rect = element.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return undefined
  return menuAnchor(element)
}

/**
 * Default right-click behaviour: the standard Edit menu wherever the click did
 * not land on something with a menu of its own (those call `preventDefault`).
 * In dev, always open a menu so main can append Inspect Element.
 */
export function installDefaultContextMenu(): () => void {
  const isDev = Boolean(import.meta.env?.DEV)
  const onContextMenu = (event: MouseEvent): void => {
    if (event.defaultPrevented) return
    const target = event.target as HTMLElement | null
    const editable =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable === true
    const hasSelection = !window.getSelection()?.isCollapsed

    const items: NativeMenuItem[] = []
    if (editable) {
      items.push(
        { role: 'undo', label: tt('menu.undo') },
        { role: 'redo', label: tt('menu.redo') },
        { separator: true },
        { role: 'cut', label: tt('menu.cut') }
      )
    }
    if (editable || hasSelection) items.push({ role: 'copy', label: tt('menu.copy') })
    if (editable) items.push({ role: 'paste', label: tt('menu.paste') })
    if (editable || hasSelection) {
      items.push({ separator: true }, { role: 'selectAll', label: tt('menu.selectAll') })
    }
    // Packaged: keep the old “no menu when empty” behaviour.
    // Dev: still popup so Inspect Element is always reachable.
    if (items.length === 0 && !isDev) return

    event.preventDefault()
    void window.vav?.window?.popupMenu?.(items, {
      x: event.clientX,
      y: event.clientY
    })
  }

  document.addEventListener('contextmenu', onContextMenu)
  return () => document.removeEventListener('contextmenu', onContextMenu)
}
