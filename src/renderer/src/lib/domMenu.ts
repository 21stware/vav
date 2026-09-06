import type { NativeMenuItem } from '@shared/ipc'

const MENU_ROOT_ID = 'vav-dom-menu'

function clearDomMenu(): void {
  document.getElementById(MENU_ROOT_ID)?.remove()
}

/**
 * Browser stand-in for `window.vav.window.popupMenu`. Desktop still uses the
 * native AppKit/Win32 menu; web and the Chrome extension share this popover
 * so SessionRunPicker / AgentModelPicker keep the same call site.
 */
export function showDomMenu(
  items: NativeMenuItem[],
  position?: { x: number; y: number }
): Promise<string | null> {
  clearDomMenu()
  return new Promise((resolve) => {
    const root = document.createElement('div')
    root.id = MENU_ROOT_ID
    root.className = 'vav-dom-menu'
    root.setAttribute('role', 'menu')
    const x = Math.max(8, position?.x ?? 12)
    const y = Math.max(8, position?.y ?? 12)
    root.style.left = `${x}px`
    root.style.top = `${y}px`

    const finish = (id: string | null): void => {
      clearDomMenu()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      resolve(id)
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(null)
    }
    const onDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && root.contains(event.target)) return
      finish(null)
    }

    for (const item of items) {
      if (item.separator) {
        const hr = document.createElement('div')
        hr.className = 'vav-dom-menu-sep'
        root.appendChild(hr)
        continue
      }
      if (item.header) {
        const head = document.createElement('div')
        head.className = 'vav-dom-menu-header'
        head.textContent = item.label || ''
        root.appendChild(head)
        continue
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'vav-dom-menu-item'
      btn.setAttribute('role', 'menuitem')
      if (item.checked) btn.dataset.checked = 'true'
      if (item.enabled === false) btn.disabled = true
      btn.textContent = item.label || ''
      btn.addEventListener('click', () => finish(item.id ?? null))
      root.appendChild(btn)
    }

    document.body.appendChild(root)
    const rect = root.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) {
      root.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
    }
    if (rect.bottom > window.innerHeight - 8) {
      root.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
  })
}
