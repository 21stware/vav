import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Bot,
  FileStack,
  Hammer,
  Import,
  ListTodo,
  MessageCircle,
  MessagesSquare,
  Rocket,
  Settings,
  Shield,
  type LucideIcon
} from 'lucide-react'
import { AGENT_ICONS, MONO_MARKS } from './agentMarkAssets'

/** Native menu rows get a 16pt slot; rasterize at 2x for retina. */
const ICON_PX = 32

export interface ResolvedMenuIcon {
  dataUrl: string
  /**
   * macOS template image: AppKit tints from the alpha channel, so the glyph
   * follows menu appearance and turns white on highlight like a checkmark.
   */
  template: boolean
}

const LUCIDE_MENU_ICONS = {
  'mode-plan': ListTodo,
  'mode-ask': MessageCircle,
  'mode-build': Hammer,
  'mode-agent': Bot,
  'approval-auto': Shield,
  'approval-bypass': Rocket,
  'approval-edit': BookOpen,
  settings: Settings,
  sessions: MessagesSquare,
  archive: Archive,
  unarchive: ArchiveRestore,
  'file-sessions': FileStack,
  import: Import
} as const

export type LucideMenuIconKey = keyof typeof LUCIDE_MENU_ICONS

export type MenuIconRequest =
  | { kind: 'brand'; markId: string }
  | { kind: 'lucide'; key: LucideMenuIconKey }

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
  canvas.width = ICON_PX
  canvas.height = ICON_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const w = img.naturalWidth || ICON_PX
  const h = img.naturalHeight || ICON_PX
  const scale = Math.min(ICON_PX / w, ICON_PX / h)
  const dw = w * scale
  const dh = h * scale
  ctx.drawImage(img, (ICON_PX - dw) / 2, (ICON_PX - dh) / 2, dw, dh)
  return canvas.toDataURL('image/png')
}

async function rasterizeUrl(src: string): Promise<string | null> {
  const img = await loadImage(src)
  return img ? rasterize(img) : null
}

async function rasterizeSvgMarkup(markup: string): Promise<string | null> {
  const blob = new Blob([markup], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    return await rasterizeUrl(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Render a Lucide component to SVG markup. React 19's browser build of
 * react-dom/server dropped renderToStaticMarkup, so use a detached root.
 */
let iconRenderHost: HTMLDivElement | null = null
let iconRenderRoot: Root | null = null

function lucideSvgMarkup(Icon: LucideIcon): string {
  if (!iconRenderHost || !iconRenderRoot) {
    iconRenderHost = document.createElement('div')
    iconRenderHost.style.display = 'none'
    document.body.appendChild(iconRenderHost)
    iconRenderRoot = createRoot(iconRenderHost)
  }
  const root = iconRenderRoot
  // stroke must be explicit — currentColor computes to black in an isolated
  // SVG, and template images only read the alpha channel either way.
  flushSync(() => {
    root.render(createElement(Icon, { size: ICON_PX, color: '#000', strokeWidth: 2 }))
  })
  return iconRenderHost.innerHTML
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
      // Monochrome marks go template so the menu tints them (highlight →
      // white); colored brand marks keep their colors. Pi ships white-on-
      // transparent and VAV is a line glyph — alpha is all a template reads.
      const template = MONO_MARKS.has(markId) || markId === 'pi' || markId === 'vav'
      return { dataUrl, template }
    })()
    cache.set(key, cached)
  }
  return cached
}

function lucideMenuIcon(key: LucideMenuIconKey): Promise<ResolvedMenuIcon | null> {
  const cacheKey = `lucide:${key}`
  let cached = cache.get(cacheKey)
  if (!cached) {
    cached = (async (): Promise<ResolvedMenuIcon | null> => {
      const dataUrl = await rasterizeSvgMarkup(lucideSvgMarkup(LUCIDE_MENU_ICONS[key]))
      return dataUrl ? { dataUrl, template: true } : null
    })()
    cache.set(cacheKey, cached)
  }
  return cached
}

/** Resolve a menu icon; null when the asset is unknown or fails to rasterize. */
export function resolveMenuIcon(request: MenuIconRequest): Promise<ResolvedMenuIcon | null> {
  return request.kind === 'brand' ? brandMenuIcon(request.markId) : lucideMenuIcon(request.key)
}

/** Mirrors ModeIcon in SessionRunPicker. */
export function menuIconKeyForMode(modeId: string): LucideMenuIconKey {
  const id = modeId.trim().toLowerCase()
  if (id.includes('plan')) return 'mode-plan'
  if (id.includes('ask')) return 'mode-ask'
  if (id.includes('build')) return 'mode-build'
  return 'mode-agent'
}

/** Fire-and-forget cache warm so the first menu open is instant. */
export function warmMenuIcons(requests: MenuIconRequest[]): void {
  for (const request of requests) void resolveMenuIcon(request)
}
