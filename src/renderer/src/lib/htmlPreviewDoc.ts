/**
 * Prepare an HTML file for the in-app preview iframe.
 *
 * Scripts stay in the document so the page can paint like a browser. Relative
 * assets are rewritten to path-form `vav-local:` URLs so JS modules and CSS
 * resolve against the file on disk. Pick chrome is injected; it must not restyle
 * the author document.
 */

import { localFilePageUrl } from '../../../shared/localFileUrl.ts'
import { dirname, joinPath } from './path.ts'

/** Soft viewport clamp only — pick chrome is the parent screen-space HUD. */
export const HTML_PREVIEW_PICK_STYLE = `
img, video, svg, canvas {
  max-width: 100%;
  height: auto;
}
.office-pick-target,
.preview-select-region {
  cursor: default;
}
`

export function isAbsoluteOrSpecialUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|blob:|mailto:|tel:|javascript:)/i.test(
    value.trim()
  )
}

export function resolvePreviewAssetUrl(filePath: string, raw: string): string {
  const value = raw.trim()
  if (!value || isAbsoluteOrSpecialUrl(value)) return value
  try {
    const pathOnly = value.split(/[?#]/)[0] || value
    return localFilePageUrl(joinPath(dirname(filePath), pathOnly))
  } catch {
    return value
  }
}

export function rewriteCssPreviewUrls(css: string, filePath: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, url: string) => {
    if (isAbsoluteOrSpecialUrl(url)) return full
    return `url("${resolvePreviewAssetUrl(filePath, url)}")`
  })
}

function rewriteAssetAttrs(doc: Document, filePath: string): void {
  doc.querySelectorAll('[src], [href], [poster]').forEach((node) => {
    const el = node as HTMLElement
    for (const attr of ['src', 'href', 'poster'] as const) {
      const raw = el.getAttribute(attr)
      if (!raw) continue
      if (raw.startsWith('#')) continue
      // Leave normal links as-is (navigation is blocked in the preview).
      if (attr === 'href' && el.tagName === 'A') continue
      el.setAttribute(attr, resolvePreviewAssetUrl(filePath, raw))
    }
  })
}

function ensureBaseHref(doc: Document, filePath: string): void {
  let base = doc.querySelector('base')
  if (!base) {
    base = doc.createElement('base')
    doc.head.insertBefore(base, doc.head.firstChild)
  }
  base.setAttribute('href', localFilePageUrl(filePath))
}

function ensureColorScheme(doc: Document): void {
  const hasColorSchemeMeta = !!doc.querySelector(
    'meta[name="color-scheme"], meta[name="theme-color"]'
  )
  const hasColorSchemeCss =
    Array.from(doc.querySelectorAll('style')).some((s) =>
      /color-scheme\s*:/i.test(s.textContent || '')
    ) || /color-scheme\s*:/i.test(doc.documentElement.getAttribute('style') || '')
  if (hasColorSchemeMeta || hasColorSchemeCss) return
  const meta = doc.createElement('meta')
  meta.setAttribute('name', 'color-scheme')
  meta.setAttribute('content', 'light dark')
  doc.head.insertBefore(meta, doc.head.firstChild)
}

function injectPickStyle(doc: Document): void {
  doc.querySelectorAll('style[data-vav-html-pick]').forEach((el) => el.remove())
  const pickStyle = doc.createElement('style')
  pickStyle.setAttribute('data-vav-html-pick', '1')
  pickStyle.textContent = HTML_PREVIEW_PICK_STYLE
  doc.head.appendChild(pickStyle)
}

/** Mutate a parsed document in place so it can run JS and still be picked. */
export function applyHtmlPreviewPrep(doc: Document, filePath: string): void {
  // Scripts stay — the sandbox allows them so the page can render fully.
  rewriteAssetAttrs(doc, filePath)
  doc.querySelectorAll('style').forEach((style) => {
    if (style.textContent) style.textContent = rewriteCssPreviewUrls(style.textContent, filePath)
  })
  doc.querySelectorAll('[style]').forEach((node) => {
    const el = node as HTMLElement
    const style = el.getAttribute('style')
    if (style) el.setAttribute('style', rewriteCssPreviewUrls(style, filePath))
  })
  ensureBaseHref(doc, filePath)
  ensureColorScheme(doc)
  injectPickStyle(doc)
}

export function serializeHtmlPreview(doc: Document): string {
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}

export function prepareHtmlSrcDoc(
  source: string,
  filePath: string,
  parseHtml: (html: string) => Document = parseHtmlDocument
): string {
  const doc = parseHtml(source || '<!DOCTYPE html><html><body></body></html>')
  applyHtmlPreviewPrep(doc, filePath)
  return serializeHtmlPreview(doc)
}

export function parseHtmlDocument(source: string): Document {
  return new DOMParser().parseFromString(source, 'text/html')
}
