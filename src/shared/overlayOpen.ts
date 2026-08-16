const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif',
  '.heic',
  '.heif',
  '.tif',
  '.tiff'
])

export type OverlayKind = 'app' | 'image' | 'diagram'
export type OverlayDiagramKind = 'mermaid' | 'graphviz' | 'vegalite'

/** Inline payload so the overlay can paint without a disk round-trip. */
export type OverlayPayload = {
  path?: string
  kind?: OverlayKind
  diagramKind?: OverlayDiagramKind
  filename?: string
  text?: string
  mediaSrc?: string
}

export type OverlayNavigatePayload = OverlayPayload & {
  openSeq: number
  requestedAt?: number
  origin?: 'dock' | 'session'
  conversationId?: string
}

function fileBase(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const i = normalized.lastIndexOf('/')
  return (i >= 0 ? normalized.slice(i + 1) : path).toLowerCase()
}

/** Stable enough to reuse an already-open overlay for the same content. */
export function overlayContentKey(input: string): string {
  let h1 = 2166136261
  let h2 = 2166136261 ^ input.length
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 ^= c
    h1 = Math.imul(h1, 16777619)
    h2 = Math.imul(h2 ^ c, 16777619)
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

export function overlayIdentity(payload: OverlayPayload): string {
  const path = (payload.path ?? '').trim().replace(/\\/g, '/')
  if (path) return path
  if (payload.mediaSrc) return `src:${overlayContentKey(payload.mediaSrc)}`
  if (payload.text) return `text:${overlayContentKey(payload.text)}:${payload.filename ?? ''}`
  return (payload.filename ?? '').trim()
}

export function inferOverlayKind(path: string): OverlayKind | undefined {
  if (!path.trim()) return undefined
  const base = fileBase(path)
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot) : ''
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (
    ext === '.mmd' ||
    ext === '.mermaid' ||
    ext === '.dot' ||
    ext === '.gv' ||
    base.endsWith('.vl.json') ||
    base.endsWith('.vg.json') ||
    base.endsWith('.vegalite.json')
  ) {
    return 'diagram'
  }
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'app'
  return undefined
}

export function inferDiagramKind(path: string): OverlayDiagramKind | undefined {
  const base = fileBase(path)
  if (base.endsWith('.mmd') || base.endsWith('.mermaid')) return 'mermaid'
  if (base.endsWith('.dot') || base.endsWith('.gv')) return 'graphviz'
  if (
    base.endsWith('.vl.json') ||
    base.endsWith('.vg.json') ||
    base.endsWith('.vegalite.json')
  ) {
    return 'vegalite'
  }
  return undefined
}
