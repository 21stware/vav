import type { NativeMenuItem } from '@shared/ipc'

const MENU_ROOT_ID = 'vav-dom-menu'

function clearDomMenu(): void {
  document.getElementById(MENU_ROOT_ID)?.remove()
}

export function resolveMenuView(
  items: NativeMenuItem[],
  trail: number[]
): { items: NativeMenuItem[]; title: string | null } {
  let current = items
  let title: string | null = null
  for (const index of trail) {
    const next = current[index]
    if (!next?.submenu?.length) break
    title = next.label?.trim() || title
    current = next.submenu
  }
  return { items: current, title }
}

function paintItems(root: HTMLElement, items: NativeMenuItem[], onPick: (item: NativeMenuItem, index: number) => void): void {
  for (const [index, item] of items.entries()) {
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
    if (item.submenu?.length) btn.dataset.submenu = 'true'
    if (item.enabled === false) btn.disabled = true
    if (item.icon) {
      const mark = document.createElement('img')
      mark.className = 'vav-dom-menu-icon'
      mark.src = item.icon
      mark.alt = ''
      btn.appendChild(mark)
    }
    const label = document.createElement('span')
    label.textContent = item.label || ''
    btn.appendChild(label)
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      if (item.enabled === false) return
      onPick(item, index)
    })
    root.appendChild(btn)
  }
}

/**
 * Browser stand-in for `window.vav.window.popupMenu`. Desktop still uses the
 * native AppKit/Win32 menu; web and the Chrome extension share this popover
 * so SessionRunPicker / AgentModelPicker keep the same call site.
 *
 * Parent rows with `submenu` drill in — native menus fly out, but a 420px
 * side panel cannot host a second column.
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

    const trail: number[] = []

    const finish = (id: string | null): void => {
      clearDomMenu()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
      resolve(id)
    }

    const place = (): void => {
      const rect = root.getBoundingClientRect()
      if (rect.right > window.innerWidth - 8) {
        root.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
      }
      if (rect.bottom > window.innerHeight - 8) {
        root.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
      }
    }

    const render = (): void => {
      root.replaceChildren()
      const view = resolveMenuView(items, trail)
      if (trail.length > 0) {
        const back = document.createElement('button')
        back.type = 'button'
        back.className = 'vav-dom-menu-item vav-dom-menu-back'
        back.textContent = view.title ? `‹ ${view.title}` : '‹'
        back.addEventListener('click', (event) => {
          event.stopPropagation()
          trail.pop()
          render()
        })
        root.appendChild(back)
        const hr = document.createElement('div')
        hr.className = 'vav-dom-menu-sep'
        root.appendChild(hr)
      }
      paintItems(root, view.items, (item, index) => {
        if (item.submenu?.length) {
          trail.push(index)
          render()
          return
        }
        finish(item.id ?? null)
      })
      place()
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (trail.length > 0) {
          trail.pop()
          render()
          return
        }
        finish(null)
      }
    }
    const onDown = (event: MouseEvent): void => {
      if (event.target instanceof Node && root.contains(event.target)) return
      finish(null)
    }

    document.body.appendChild(root)
    render()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
  })
}
