import type { NativeMenuItem } from '@shared/ipc'
import { tt } from '../i18n/useT'

export interface MenuItem {
  label: string
  /** macOS has no destructive style for popup menus; kept for call-site intent. */
  destructive?: boolean
  disabled?: boolean
  checked?: boolean
  divider?: boolean
  onSelect?: () => void
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
  const payload: NativeMenuItem[] = items.map((item, index) =>
    item.divider
      ? { separator: true }
      : {
          id: String(index),
          label: item.label,
          enabled: !item.disabled,
          checked: item.checked
        }
  )

  const chosen = await window.vav.window.popupMenu(payload, position)
  if (chosen === null) return
  items[Number(chosen)]?.onSelect?.()
}

/** Anchors a menu under a button, the way a pull-down control behaves. */
export function menuAnchor(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect()
  return { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
}

/**
 * Default right-click behaviour: the standard Edit menu wherever the click did
 * not land on something with a menu of its own (those call `preventDefault`).
 */
export function installDefaultContextMenu(): () => void {
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
    if (items.length === 0) return

    event.preventDefault()
    void window.vav?.window?.popupMenu?.(items)
  }

  document.addEventListener('contextmenu', onContextMenu)
  return () => document.removeEventListener('contextmenu', onContextMenu)
}
