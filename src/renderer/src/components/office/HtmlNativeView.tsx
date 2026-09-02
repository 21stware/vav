/**
 * HTML P0 preview: sandboxed render of the file source + DevTools-style element pick.
 *
 * Product flow (not a visual editor): view → select block for comment → Agent edits
 * the HTML source on disk → user confirms Save. Scripts do not run.
 */

import { useEffect, useRef, useState } from 'react'
import type { PreviewBlock, PreviewBlockKind } from '@shared/previewBlock'
import { scheduleClickPick } from '../../lib/clickPick'
import { dirname, joinPath } from '../../lib/path'
import { useT } from '../../i18n/useT'

/** Leaf-ish targets — same spirit as office pickFromDom, plus common HTML chrome. */
const HTML_PICK_SELECTOR = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'td',
  'th',
  'blockquote',
  'pre',
  'code',
  'figcaption',
  'caption',
  'label',
  'button',
  'a',
  'summary',
  'dt',
  'dd',
  'img',
  'video',
  'audio',
  'table',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'form',
  'div',
  'span'
].join(',')

/**
 * Pick chrome only — must NOT restyle the author document.
 *
 * Earlier builds forced body font/color/padding/background which made the same
 * HTML look different in vav than in a browser. Keep overrides limited to
 * vav-injected classes.
 */
const PICK_STYLE = `
/* Soft viewport clamp only (common in constrained previews; does not set fonts). */
img, video, svg, canvas {
  max-width: 100%;
  height: auto;
}
/* Hit targets only — pick chrome is the parent screen-space HUD. */
.office-pick-target,
.preview-select-region {
  cursor: default;
}
`

function isAbsoluteOrSpecialUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|blob:|mailto:|tel:|javascript:)/i.test(
    value.trim()
  )
}

function toVavLocalUrl(absPath: string): string {
  return `vav-local://preview/?path=${encodeURIComponent(absPath)}`
}

function resolveAssetUrl(filePath: string, raw: string): string {
  const value = raw.trim()
  if (!value || isAbsoluteOrSpecialUrl(value)) return value
  try {
    // Drop query/hash for path resolution (P0); rare cache-busters are ignored.
    const pathOnly = value.split(/[?#]/)[0] || value
    const abs = joinPath(dirname(filePath), pathOnly)
    return toVavLocalUrl(abs)
  } catch {
    return value
  }
}

function rewriteCssUrls(css: string, filePath: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, url: string) => {
    if (isAbsoluteOrSpecialUrl(url)) return full
    const resolved = resolveAssetUrl(filePath, url)
    return `url("${resolved}")`
  })
}

/**
 * Prepare a same-origin srcdoc document: relative assets → vav-local, pick styles,
 * no scripts (sandbox also blocks them).
 */
export function prepareHtmlSrcDoc(source: string, filePath: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(source || '<!DOCTYPE html><html><body></body></html>', 'text/html')

  // Strip scripts for a quieter static preview (Agent still edits source).
  doc.querySelectorAll('script').forEach((el) => el.remove())

  // Relative CSS / media → local protocol so sibling assets load.
  doc.querySelectorAll('[src], [href], [poster]').forEach((node) => {
    const el = node as HTMLElement
    for (const attr of ['src', 'href', 'poster'] as const) {
      const raw = el.getAttribute(attr)
      if (!raw) continue
      // Keep in-page anchors and pure fragments.
      if (raw.startsWith('#')) continue
      // Don't rewrite stylesheet/script already absolute; do rewrite relative.
      if (attr === 'href') {
        const rel = (el.getAttribute('rel') || '').toLowerCase()
        const isStylesheet = el.tagName === 'LINK' && rel.includes('stylesheet')
        const isIcon = el.tagName === 'LINK' && (rel.includes('icon') || rel.includes('apple'))
        if (!isStylesheet && !isIcon && el.tagName === 'A') {
          // Leave normal links as-is (we'll block navigation in pick mode).
          continue
        }
      }
      el.setAttribute(attr, resolveAssetUrl(filePath, raw))
    }
  })

  doc.querySelectorAll('style').forEach((style) => {
    if (style.textContent) style.textContent = rewriteCssUrls(style.textContent, filePath)
  })
  doc.querySelectorAll('[style]').forEach((node) => {
    const el = node as HTMLElement
    const style = el.getAttribute('style')
    if (style) el.setAttribute('style', rewriteCssUrls(style, filePath))
  })

  // Base is informational; assets already rewritten.
  let base = doc.querySelector('base')
  if (!base) {
    base = doc.createElement('base')
    doc.head.insertBefore(base, doc.head.firstChild)
  }
  base.setAttribute('href', toVavLocalUrl(filePath))

  // Prefer the page's own color-scheme / meta; only seed a neutral default when
  // the document never declares one — otherwise Electron's dark shell can make
  // system UI (form controls, scrollbars, Canvas) diverge from Safari/Chrome.
  const hasColorSchemeMeta = !!doc.querySelector(
    'meta[name="color-scheme"], meta[name="theme-color"]'
  )
  const hasColorSchemeCss =
    Array.from(doc.querySelectorAll('style')).some((s) =>
      /color-scheme\s*:/i.test(s.textContent || '')
    ) || /color-scheme\s*:/i.test(doc.documentElement.getAttribute('style') || '')
  if (!hasColorSchemeMeta && !hasColorSchemeCss) {
    const meta = doc.createElement('meta')
    meta.setAttribute('name', 'color-scheme')
    meta.setAttribute('content', 'light dark')
    doc.head.insertBefore(meta, doc.head.firstChild)
  }

  // Drop any previous pick sheet (hot reloads / re-prepare).
  doc.querySelectorAll('style[data-vav-html-pick]').forEach((el) => el.remove())

  const pickStyle = doc.createElement('style')
  pickStyle.setAttribute('data-vav-html-pick', '1')
  pickStyle.textContent = PICK_STYLE
  doc.head.appendChild(pickStyle)

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
}

function cssEscapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

function cssPath(el: Element, maxDepth = 6): string {
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && cur.nodeType === 1 && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase()
    if (tag === 'html' || tag === 'body') {
      parts.unshift(tag)
      break
    }
    let part = tag
    if (cur.id) {
      part += `#${cssEscapeIdent(cur.id)}`
      parts.unshift(part)
      break
    }
    const className =
      typeof cur.className === 'string'
        ? cur.className
            .split(/\s+/)
            .filter((c) => c && !c.startsWith('office-pick') && c !== 'selected' && c !== 'preview-select-region')
            .slice(0, 2)
            .map((c) => `.${cssEscapeIdent(c)}`)
            .join('')
        : ''
    if (className) part += className
    const parentEl: Element | null = cur.parentElement
    if (parentEl) {
      const tagName = cur.tagName
      const siblings = Array.from(parentEl.children).filter(
        (child): child is Element => child.tagName === tagName
      )
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1
        part += `:nth-of-type(${idx})`
      }
    }
    parts.unshift(part)
    cur = parentEl
    depth++
  }
  return parts.join(' > ')
}

function isPickableElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style') {
    return false
  }
  if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'table') return true
  const inner = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  const alt = el.getAttribute('alt')?.trim() || ''
  // Skip empty layout shells so deeper leaves win for hover/pick.
  return !!(inner || alt)
}

function kindForTag(tag: string): PreviewBlockKind {
  if (tag === 'td' || tag === 'th') return 'cell-table'
  if (tag.startsWith('h') && tag.length === 2) return 'heading'
  if (tag === 'li') return 'list-item'
  if (tag === 'pre' || tag === 'code') return 'code'
  if (tag === 'table') return 'table'
  if (tag === 'section' || tag === 'article' || tag === 'main' || tag === 'nav' || tag === 'aside') {
    return 'section'
  }
  return 'paragraph'
}

function estimateSourceLine(source: string, el: HTMLElement): number {
  const id = el.getAttribute('id')
  if (id) {
    const re = new RegExp(`id=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i')
    const m = re.exec(source)
    if (m && m.index != null) return source.slice(0, m.index).split(/\r?\n/).length
  }
  const text = (el.innerText || el.textContent || '').trim().slice(0, 48)
  if (text.length >= 8) {
    const idx = source.indexOf(text)
    if (idx >= 0) return source.slice(0, idx).split(/\r?\n/).length
  }
  const tag = el.tagName.toLowerCase()
  const open = source.toLowerCase().indexOf(`<${tag}`)
  if (open >= 0) return source.slice(0, open).split(/\r?\n/).length
  return 0
}

function blockFromElement(el: HTMLElement, source: string, id: string): PreviewBlock | null {
  const tag = el.tagName.toLowerCase()
  if (tag === 'html' || tag === 'body' || tag === 'head' || tag === 'script' || tag === 'style') {
    return null
  }

  const inner = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  const alt = el.getAttribute('alt')?.trim() || ''
  const src = el.getAttribute('src')?.trim() || ''
  if (!inner && !alt && tag !== 'img' && tag !== 'video' && tag !== 'audio' && tag !== 'table') {
    // Skip empty layout shells so pick hits meaningful leaves.
    return null
  }

  const selector = cssPath(el)
  const outer = el.outerHTML.replace(/\s+/g, ' ').trim().slice(0, 3500)
  const line = estimateSourceLine(source, el)
  const kind = kindForTag(tag)
  const labelBits = [`<${tag}>`, inner.slice(0, 48) || alt || src.slice(0, 40) || selector]
  const textParts = [
    `HTML element <${tag}>`,
    `selector: ${selector}`,
    inner ? `text:\n${inner.slice(0, 2500)}` : alt ? `alt: ${alt}` : null,
    src && (tag === 'img' || tag === 'video' || tag === 'audio') ? `src: ${src}` : null,
    `outerHTML:\n${outer}`
  ].filter((x): x is string => x != null)

  return {
    id,
    kind,
    text: textParts.join('\n'),
    label: labelBits.filter(Boolean).join(' ').slice(0, 80),
    startLine: line,
    endLine: line,
    level: kind === 'heading' ? Number(tag.slice(1)) || 1 : undefined
  }
}

function ensureStableIds(root: ParentNode, selector: string): HTMLElement[] {
  const nodes = (Array.from(root.querySelectorAll(selector)) as HTMLElement[]).filter(isPickableElement)
  nodes.forEach((el, index) => {
    if (!el.dataset.blockId) el.dataset.blockId = `html-${index}`
    el.classList.add('office-pick-target', 'preview-select-region')
  })
  return nodes
}

function syncSelected(root: ParentNode, selectedIds: string[]): void {
  const selected = new Set(selectedIds)
  root.querySelectorAll<HTMLElement>('.office-pick-target[data-block-id]').forEach((el) => {
    const id = el.dataset.blockId
    if (!id) return
    el.classList.toggle('selected', selected.has(id))
  })
}

export function HtmlNativeView({
  path,
  html,
  revision = 0,
  selecting,
  selectedIds,
  onPick
}: {
  path: string
  /** Live working source (Agent edits update this; Save writes it back). */
  html: string
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
}): React.JSX.Element {
  const t = useT()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const sourceRef = useRef(html)
  sourceRef.current = html
  const selectingRef = useRef(selecting)
  selectingRef.current = selecting
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Write srcdoc when source / path / revision changes.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    setLoading(true)
    setError(null)
    try {
      iframe.srcdoc = prepareHtmlSrcDoc(html, path)
    } catch (err) {
      setError((err as Error).message || t('preview.loadFailed'))
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, path, revision])

  // Wire pick + selection chrome after each document load.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const onLoad = (): void => {
      setLoading(false)
      const doc = iframe.contentDocument
      const body = doc?.body
      if (!doc || !body) {
        setError(t('preview.loadFailed'))
        return
      }

      ensureStableIds(doc, HTML_PICK_SELECTOR)
      syncSelected(doc, selectedIdsRef.current)

      const onDown = (event: MouseEvent): void => {
        if (!selectingRef.current) return
        if (event.button !== 0) return
        const raw = event.target as HTMLElement | null
        if (!raw || !body.contains(raw)) return

        const matches = (
          Array.from(doc.querySelectorAll(HTML_PICK_SELECTOR)) as HTMLElement[]
        ).filter((el) => el.dataset.blockId && isPickableElement(el))
        let best: HTMLElement | null = null
        for (const el of matches) {
          if (el === raw || el.contains(raw)) {
            if (!best || best.contains(el)) best = el
          }
        }
        if (!best?.dataset.blockId) return

        // Keep text select/copy; only isolate nested picks.
        event.stopPropagation()

        const id = best.dataset.blockId
        const win = doc.defaultView ?? window
        scheduleClickPick(
          { button: event.button, clientX: event.clientX, clientY: event.clientY },
          () => {
            const block = blockFromElement(best!, sourceRef.current, id)
            if (!block) return
            onPickRef.current(block, event)
          },
          { win }
        )
      }

      const blockNav = (event: Event): void => {
        // Always block hyperlink navigation in HTML previews (Read and Edit).
        // Still allow drag-select: only act on real anchor clicks.
        const target = event.target
        if (!(target instanceof Element)) return
        const anchor = target.closest('a[href]')
        if (!anchor) {
          // Pick mode: also swallow bare click navigations when selecting.
          if (!selectingRef.current) return
          const sel = doc.getSelection()
          if (sel && !sel.isCollapsed && (sel.toString() || '').trim()) return
          event.preventDefault()
          return
        }
        // Stylesheet/link[rel] are not anchors.
        if (anchor.tagName !== 'A') return
        event.preventDefault()
        event.stopPropagation()
      }

      doc.addEventListener('mousedown', onDown, true)
      doc.addEventListener('click', blockNav, true)
      doc.addEventListener('auxclick', blockNav, true)
      // Keep ref for cleanup of this document only.
      ;(iframe as HTMLIFrameElement & { __htmlPickCleanup?: () => void }).__htmlPickCleanup = () => {
        doc.removeEventListener('mousedown', onDown, true)
        doc.removeEventListener('click', blockNav, true)
        doc.removeEventListener('auxclick', blockNav, true)
      }
    }

    iframe.addEventListener('load', onLoad)
    // srcdoc may fire load before we attach; re-run if already complete.
    if (iframe.contentDocument?.readyState === 'complete') {
      onLoad()
    }

    return () => {
      iframe.removeEventListener('load', onLoad)
      ;(iframe as HTMLIFrameElement & { __htmlPickCleanup?: () => void }).__htmlPickCleanup?.()
    }
  }, [html, path, revision, t])

  // Selection chrome without reloading srcdoc.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body) return
    syncSelected(doc, selectedIds)
  }, [selectedIds])

  return (
    <div className={`office-native-root html-root${selecting ? ' selecting' : ''}`}>
      {loading && <div className="office-native-status muted">{t('common.loading')}</div>}
      {error && (
        <div className="office-native-status error">
          <strong>{t('preview.loadFailed')}</strong>
          <div className="muted tiny">{error}</div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        className="html-native-frame"
        title={path}
        // No allow-scripts: static view only. allow-same-origin so we can pick DOM.
        sandbox="allow-same-origin"
        // Isolation hint for modern Chromium.
        referrerPolicy="no-referrer"
      />
    </div>
  )
}
