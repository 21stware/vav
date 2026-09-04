import { nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { MENU_ICON_BITMAPS } from '@shared/menuIconBitmaps'
import type { LucideMenuIconKey } from '@shared/menuLucideIcons'

const cache = new Map<LucideMenuIconKey, NativeImage>()

/** 32×32 fully transparent PNG — reserves the icon column so labels line up. */
const SPACER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGklEQVRYhe3BAQEAAACCIP+vbkhAAQAAAO8GECAAAUcBoIgAAAAASUVORK5CYII='

let spacer: NativeImage | null = null

/** Template Lucide glyph for native application menu rows (16pt @2×). */
export function menuIcon(key: LucideMenuIconKey): NativeImage {
  let cached = cache.get(key)
  if (cached) return cached

  const dataUrl = MENU_ICON_BITMAPS[key]
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 2, dataURL: dataUrl })
  if (!image.isEmpty()) image.setTemplateImage(true)
  cached = image
  cache.set(key, cached)
  return cached
}

/** Empty icon slot so rows without a glyph still align with rows that have one. */
export function menuIconSpacer(): NativeImage {
  if (spacer) return spacer
  const image = nativeImage.createEmpty()
  image.addRepresentation({ scaleFactor: 2, dataURL: SPACER_PNG })
  image.setTemplateImage(true)
  spacer = image
  return image
}

/**
 * When any visible row has an icon, give the rest a transparent spacer so
 * AppKit/Win32 keep labels in one column.
 */
export function alignMenuIcons(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const needsSlot = items.some(
    (item) => item.visible !== false && item.type !== 'separator' && Boolean(item.icon)
  )
  if (!needsSlot) return items
  const gap = menuIconSpacer()
  return items.map((item) => {
    if (item.visible === false || item.type === 'separator' || item.icon) return item
    return { ...item, icon: gap }
  })
}
