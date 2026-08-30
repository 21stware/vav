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

/**
 * Lucide path data (viewBox 0 0 24 24). Serialized here instead of rendering
 * through React — React 19's detached-root SVG often lacks a parseable
 * `xmlns` when loaded as `image/svg+xml`, so native menu icons stayed blank.
 */
const LUCIDE_ICON_NODES = {
  'mode-plan': [
    ['path', { d: 'M13 5h8' }],
    ['path', { d: 'M13 12h8' }],
    ['path', { d: 'M13 19h8' }],
    ['path', { d: 'm3 17 2 2 4-4' }],
    ['rect', { x: '3', y: '4', width: '6', height: '6', rx: '1' }]
  ],
  'mode-ask': [
    [
      'path',
      {
        d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719'
      }
    ]
  ],
  'mode-build': [
    ['path', { d: 'm15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9' }],
    ['path', { d: 'm18 15 4-4' }],
    [
      'path',
      {
        d: 'm21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5'
      }
    ]
  ],
  'mode-agent': [
    ['path', { d: 'M12 8V4H8' }],
    ['rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }],
    ['path', { d: 'M2 14h2' }],
    ['path', { d: 'M20 14h2' }],
    ['path', { d: 'M15 13v2' }],
    ['path', { d: 'M9 13v2' }]
  ],
  'approval-auto': [
    [
      'path',
      {
        d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'
      }
    ]
  ],
  'approval-bypass': [
    [
      'path',
      {
        d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z'
      }
    ],
    [
      'path',
      {
        d: 'm12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z'
      }
    ],
    ['path', { d: 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0' }],
    ['path', { d: 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5' }]
  ],
  'approval-edit': [
    ['path', { d: 'M12 7v14' }],
    [
      'path',
      {
        d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'
      }
    ]
  ],
  settings: [
    [
      'path',
      {
        d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'
      }
    ],
    ['circle', { cx: '12', cy: '12', r: '3' }]
  ],
  sessions: [
    [
      'path',
      {
        d: 'M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'
      }
    ],
    [
      'path',
      {
        d: 'M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1'
      }
    ]
  ],
  archive: [
    ['rect', { width: '20', height: '5', x: '2', y: '3', rx: '1' }],
    ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' }],
    ['path', { d: 'M10 12h4' }]
  ],
  unarchive: [
    ['rect', { width: '20', height: '5', x: '2', y: '3', rx: '1' }],
    ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h2' }],
    ['path', { d: 'M20 8v11a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'm9 15 3-3 3 3' }],
    ['path', { d: 'M12 12v9' }]
  ],
  'file-sessions': [
    ['path', { d: 'M11 21a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1' }],
    ['path', { d: 'M16 16a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1' }],
    [
      'path',
      {
        d: 'M21 6a2 2 0 0 0-.586-1.414l-2-2A2 2 0 0 0 17 2h-3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1z'
      }
    ]
  ],
  import: [
    ['path', { d: 'M12 3v12' }],
    ['path', { d: 'm8 11 4 4 4-4' }],
    [
      'path',
      {
        d: 'M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4'
      }
    ]
  ]
} as const

export type LucideMenuIconKey = keyof typeof LUCIDE_ICON_NODES

export type MenuIconRequest =
  | { kind: 'brand'; markId: string }
  | { kind: 'lucide'; key: LucideMenuIconKey }
  | { kind: 'bitmap'; src: string; template?: boolean }

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

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Well-formed SVG Lucide can load as an image (xmlns + kebab-case attrs). */
export function lucideSvgMarkup(key: LucideMenuIconKey): string {
  const body = LUCIDE_ICON_NODES[key]
    .map(([tag, attrs]) => {
      const attr = Object.entries(attrs)
        .map(([name, value]) => `${name}="${escapeAttr(value)}"`)
        .join(' ')
      return `<${tag} ${attr}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_PX}" height="${ICON_PX}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
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

/** Resolve a menu icon; null when the asset is unknown or fails to rasterize. */
export function resolveMenuIcon(request: MenuIconRequest): Promise<ResolvedMenuIcon | null> {
  if (request.kind === 'brand') return brandMenuIcon(request.markId)
  if (request.kind === 'bitmap') return bitmapMenuIcon(request.src, request.template !== false)
  return lucideMenuIcon(request.key)
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
