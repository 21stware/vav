export const OVERLAY_IMAGE_EXTS = new Set([
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

function fileBase(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const i = normalized.lastIndexOf('/')
  return (i >= 0 ? normalized.slice(i + 1) : path).toLowerCase()
}

function fileExt(path: string): string {
  const base = fileBase(path)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot) : ''
}

/** App / xstate HTML — chrome-less overlay even when opened from the dock. */
export function looksLikeAppClip(filePath: string): boolean {
  const base = fileBase(filePath)
  if (base === 'app.html' || base === 'xstate.html' || base.endsWith('.app.html')) return true
  const clip = filePath.replace(/\\/g, '/').includes('/vav-clips/')
  return clip && (base.endsWith('.html') || base.endsWith('.htm'))
}

/**
 * Conversation preview kinds: App/HTML, images, Mermaid, Graphviz, Vega-Lite.
 * These open as an ephemeral overlay — not File Preview / File Session.
 */
export function looksLikeVisualOverlay(filePath: string): boolean {
  const base = fileBase(filePath)
  const ext = fileExt(filePath)
  if (looksLikeAppClip(filePath)) return true
  if (OVERLAY_IMAGE_EXTS.has(ext)) return true
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return true
  if (ext === '.mmd' || ext === '.mermaid' || ext === '.dot' || ext === '.gv') return true
  if (
    base.endsWith('.vl.json') ||
    base.endsWith('.vg.json') ||
    base.endsWith('.vegalite.json')
  ) {
    return true
  }
  return false
}

/**
 * Chrome-less overlay vs File Preview.
 * File Sessions must pass surface:'file' — a real image on disk is file viewing.
 * Conversation previews pass surface:'app', or are temp clips / app.html.
 */
export function shouldOpenAsOverlay(
  path: string,
  surface?: 'file' | 'app'
): boolean {
  if (surface === 'file') return false
  if (surface === 'app') return true
  if (looksLikeAppClip(path)) return true
  const clip = path.replace(/\\/g, '/').includes('/vav-clips/')
  return clip && looksLikeVisualOverlay(path)
}
