import { BrowserWindow, Menu, nativeImage } from 'electron'
import type { NativeMenuItem } from '@shared/ipc'
import { isDevRuntime } from '../devRuntime'

/**
 * At most one renderer-driven popup at a time.
 * Without this, ⌘⇧O / chip menus stack when the user switches sessions or
 * re-opens before the previous AppKit menu closes — leaving a sticky menu.
 */
let activeNativePopup: {
  menu: Electron.Menu
  window: BrowserWindow
  finish: () => void
  seq: number
} | null = null
let nativePopupSeq = 0

export function closeActiveNativePopup(): void {
  const active = activeNativePopup
  if (!active) return
  activeNativePopup = null
  nativePopupSeq += 1
  try {
    if (!active.window.isDestroyed()) active.menu.closePopup(active.window)
    else active.menu.closePopup()
  } catch {
    // Menu may already be gone
  }
  active.finish()
}

/**
 * Native popup menu driven by the renderer.
 *
 * Resolves to the chosen row's id — `click` fires before popup's `callback`,
 * so the id is already settled by the time the menu reports that it closed.
 */
export function popupNativeMenu(
  window: BrowserWindow,
  items: NativeMenuItem[],
  position?: { x: number; y: number }
): Promise<string | null> {
  closeActiveNativePopup()
  const seq = ++nativePopupSeq

  return new Promise((resolve) => {
    let chosen: string | null = null
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      if (activeNativePopup?.seq === seq) activeNativePopup = null
      setImmediate(() => resolve(chosen))
    }

    const iconFor = (item: NativeMenuItem): Electron.NativeImage | undefined => {
      if (!item.icon) return undefined
      const image = nativeImage.createEmpty()
      image.addRepresentation({ scaleFactor: 2, dataURL: item.icon })
      if (image.isEmpty()) return undefined
      if (item.iconTemplate) image.setTemplateImage(true)
      return image
    }

    const toTemplate = (rows: NativeMenuItem[]): Electron.MenuItemConstructorOptions[] =>
      rows.map((item) => {
        if (item.separator) return { type: 'separator' }
        if (item.header) {
          return process.platform === 'darwin'
            ? { type: 'header', label: item.label ?? '' }
            : { label: item.label ?? '', enabled: false }
        }
        if (item.role) return { role: item.role, label: item.label }
        if (item.submenu && item.submenu.length > 0) {
          return {
            type: 'submenu',
            label: item.label ?? '',
            enabled: item.enabled !== false,
            icon: iconFor(item),
            submenu: toTemplate(item.submenu)
          }
        }
        const hasCheck = item.checked !== undefined
        return {
          label: item.label ?? '',
          enabled: item.enabled !== false,
          type: hasCheck ? 'radio' : 'normal',
          checked: hasCheck ? !!item.checked : undefined,
          icon: iconFor(item),
          click: () => {
            chosen = item.id ?? null
          }
        }
      })
    const template: Electron.MenuItemConstructorOptions[] = toTemplate(items)

    const opts: Electron.PopupOptions = {
      window,
      callback: finish
    }
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      opts.x = Math.round(position.x)
      opts.y = Math.round(position.y)
    }

    if (isDevRuntime()) {
      const x = opts.x ?? 0
      const y = opts.y ?? 0
      if (template.length) template.push({ type: 'separator' })
      template.push({
        label: 'Inspect Element',
        click: () => {
          const wc = window.webContents
          wc.inspectElement(x, y)
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' })
        }
      })
    }

    setTimeout(() => {
      if (window.isDestroyed() || seq !== nativePopupSeq) {
        finish()
        return
      }
      try {
        const menu = Menu.buildFromTemplate(template)
        activeNativePopup = { menu, window, finish, seq }
        menu.popup(opts)
      } catch {
        finish()
      }
    }, 0)
  })
}
