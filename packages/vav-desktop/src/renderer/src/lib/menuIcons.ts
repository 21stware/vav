import { AGENT_ICONS, MONO_MARKS } from './agentMarkAssets'
import { lucideSvgMarkup } from '@shared/menuIconSvg'
import { MENU_ICON_PX, type LucideMenuIconKey } from '@shared/menuLucideIcons'

export type { LucideMenuIconKey } from '@shared/menuLucideIcons'

export interface ResolvedMenuIcon {
  dataUrl: string
  /**
   * macOS template image: AppKit tints from the alpha channel, so the glyph
   * follows menu appearance and turns white on highlight like a checkmark.
   */
  template: boolean
}

export type MenuIconRequest =
  | { kind: 'brand'; markId: string }
  | { kind: 'lucide'; key: LucideMenuIconKey }
  | { kind: 'bitmap'; src: string; template?: boolean }
  /** Transparent slot so a row without a glyph lines up with icon rows. */
  | { kind: 'spacer' }

const cache = new Map<string, Promise<ResolvedMenuIcon | null>>()

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Draw contain-fit into a square canvas and export as PNG. */
function rasterize(img: HTMLImageElement): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = MENU_ICON_PX
  canvas.height = MENU_ICON_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const w = img.naturalWidth || MENU_ICON_PX
  const h = img.naturalHeight || MENU_ICON_PX
  const scale = Math.min(MENU_ICON_PX / w, MENU_ICON_PX / h)
  const dw = w * scale
  const dh = h * scale
  ctx.drawImage(img, (MENU_ICON_PX - dw) / 2, (MENU_ICON_PX - dh) / 2, dw, dh)
  return canvas.toDataURL('image/png')
}

async function rasterizeUrl(src: string): Promise<string | null> {
  const img = await loadImage(src)
  return img ? rasterize(img) : null
}

async function rasterizeSvgMarkup(markup: string): Promise<string | null> {
  // data: URL — blob: + revoke can drop the decode before drawImage in Electron.
  return rasterizeUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)
}

function brandMenuIcon(markId: string): Promise<ResolvedMenuIcon | null> {
  const key = `brand:${markId}`
  let cached = cache.get(key)
  if (!cached) {
    cached = (async (): Promise<ResolvedMenuIcon | null> => {
      const src = AGENT_ICONS[markId]
      if (!src) return null
      const dataUrl = await rasterizeUrl(src)
      if (!dataUrl) return null
      const template = MONO_MARKS.has(markId) || markId === 'pi' || markId === 'vav'
      return { dataUrl, template }
    })()
    cache.set(key, cached)
  }
  return cached
}

function lucideMenuIconResolve(key: LucideMenuIconKey): Promise<ResolvedMenuIcon | null> {
  const cacheKey = `lucide:${key}`
  let cached = cache.get(cacheKey)
  if (!cached) {
    cached = (async (): Promise<ResolvedMenuIcon | null> => {
      const dataUrl = await rasterizeSvgMarkup(lucideSvgMarkup(key))
      return dataUrl ? { dataUrl, template: true } : null
    })()
    cache.set(cacheKey, cached)
  }
  return cached
}

function bitmapMenuIcon(src: string, template: boolean): Promise<ResolvedMenuIcon | null> {
  const cacheKey = `bitmap:${template ? 't' : 'c'}:${src}`
  let cached = cache.get(cacheKey)
  if (!cached) {
    cached = (async (): Promise<ResolvedMenuIcon | null> => {
      const dataUrl = await rasterizeUrl(src)
      return dataUrl ? { dataUrl, template } : null
    })()
    cache.set(cacheKey, cached)
  }
  return cached
}

function spacerMenuIcon(): Promise<ResolvedMenuIcon | null> {
  const cacheKey = 'spacer'
  let cached = cache.get(cacheKey)
  if (!cached) {
    cached = Promise.resolve().then(() => {
      const canvas = document.createElement('canvas')
      canvas.width = MENU_ICON_PX
      canvas.height = MENU_ICON_PX
      return { dataUrl: canvas.toDataURL('image/png'), template: true }
    })
    cache.set(cacheKey, cached)
  }
  return cached
}

/** Resolve a menu icon; null when the asset is unknown or fails to rasterize. */
export function resolveMenuIcon(request: MenuIconRequest): Promise<ResolvedMenuIcon | null> {
  if (request.kind === 'spacer') return spacerMenuIcon()
  if (request.kind === 'brand') return brandMenuIcon(request.markId)
  if (request.kind === 'bitmap') return bitmapMenuIcon(request.src, request.template !== false)
  return lucideMenuIconResolve(request.key)
}

/** Mirrors ModeIcon in SessionRunPicker. */
export function menuIconKeyForMode(modeId: string): LucideMenuIconKey {
  const id = modeId.trim().toLowerCase()
  if (id.includes('plan')) return 'mode-plan'
  if (id.includes('ask')) return 'mode-ask'
  if (id.includes('build')) return 'mode-build'
  return 'mode-agent'
}

/** Shorthand for native popup menu rows. */
export function lucideMenuIcon(key: LucideMenuIconKey): MenuIconRequest {
  return { kind: 'lucide', key }
}

/** Fire-and-forget cache warm so the first menu open is instant. */
export function warmMenuIcons(requests: MenuIconRequest[]): void {
  for (const request of requests) void resolveMenuIcon(request)
}

/** Pre-warm every session sidebar context-menu glyph. */
export function warmSessionContextMenuIcons(): void {
  warmMenuIcons([
    lucideMenuIcon('app-window'),
    lucideMenuIcon('pin'),
    lucideMenuIcon('star'),
    lucideMenuIcon('archive'),
    lucideMenuIcon('unarchive'),
    lucideMenuIcon('pencil'),
    lucideMenuIcon('copy-plus'),
    lucideMenuIcon('upload'),
    lucideMenuIcon('clipboard-copy'),
    lucideMenuIcon('folder-open'),
    lucideMenuIcon('trash-2'),
    lucideMenuIcon('message-square'),
    lucideMenuIcon('file-text')
  ])
}
