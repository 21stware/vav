/**
 * HTML preview: live render of the file source + DevTools-style element pick.
 *
 * Product flow (not a visual editor): view → select block for comment → Agent
 * edits the HTML source on disk → user confirms Save. Author scripts run so
 * the page can paint; pick listeners re-bind after the document mutates.
 */

import { useEffect, useRef, useState } from 'react'
import type { PreviewBlock, PreviewBlockKind } from '@shared/previewBlock'
import { scheduleClickPick } from '../../lib/clickPick'
import { prepareHtmlSrcDoc } from '../../lib/htmlPreviewDoc'
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

function stableBlockId(el: HTMLElement, index: number): string {
  const id = el.getAttribute('id')?.trim()
  if (id) return `html-id-${id}`
  return `html-${index}`
}

function ensureStableIds(root: ParentNode, selector: string): HTMLElement[] {
  const nodes = (Array.from(root.querySelectorAll(selector)) as HTMLElement[]).filter(isPickableElement)
  nodes.forEach((el, index) => {
    if (!el.dataset.blockId) el.dataset.blockId = stableBlockId(el, index)
    el.classList.add('office-pick-target', 'preview-select-region')
  })
  return nodes
}

function pickBestTarget(doc: Document, raw: HTMLElement): HTMLElement | null {
  const matches = (Array.from(doc.querySelectorAll(HTML_PICK_SELECTOR)) as HTMLElement[]).filter(
    (el) => el.dataset.blockId && isPickableElement(el)
  )
  let best: HTMLElement | null = null
  for (const el of matches) {
    if (el === raw || el.contains(raw)) {
      if (!best || best.contains(el)) best = el
    }
  }
  return best
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

      const restamp = (): void => {
        ensureStableIds(doc, HTML_PICK_SELECTOR)
        syncSelected(doc, selectedIdsRef.current)
      }
      restamp()

      const onDown = (event: MouseEvent): void => {
        if (!selectingRef.current) return
        if (event.button !== 0) return
        const raw = event.target as HTMLElement | null
        if (!raw || !doc.documentElement.contains(raw)) return

        // JS may have just painted this node — stamp ids before hit-testing.
        restamp()
        const best = pickBestTarget(doc, raw)
        if (!best?.dataset.blockId) return

        // Capture-phase isolate: page handlers must not steal the pick.
        // Do not preventDefault on mousedown — that kills text select/copy.
        event.stopPropagation()
        event.stopImmediatePropagation()

        const id = best.dataset.blockId
        const win = doc.defaultView ?? window
        scheduleClickPick(
          { button: event.button, clientX: event.clientX, clientY: event.clientY },
          () => {
            const block = blockFromElement(best, sourceRef.current, id)
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
          if (!selectingRef.current) return
          const sel = doc.getSelection()
          if (sel && !sel.isCollapsed && (sel.toString() || '').trim()) return
          event.preventDefault()
          event.stopImmediatePropagation()
          return
        }
        if (anchor.tagName !== 'A') return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }

      const blockSubmit = (event: Event): void => {
        event.preventDefault()
        event.stopImmediatePropagation()
      }

      let raf = 0
      const mo = new MutationObserver(() => {
        if (raf) return
        raf = (doc.defaultView ?? window).requestAnimationFrame(() => {
          raf = 0
          restamp()
        })
      })
      mo.observe(doc.documentElement, { childList: true, subtree: true })

      doc.addEventListener('mousedown', onDown, true)
      doc.addEventListener('click', blockNav, true)
      doc.addEventListener('auxclick', blockNav, true)
      doc.addEventListener('submit', blockSubmit, true)
      ;(iframe as HTMLIFrameElement & { __htmlPickCleanup?: () => void }).__htmlPickCleanup = () => {
        mo.disconnect()
        if (raf) (doc.defaultView ?? window).cancelAnimationFrame(raf)
        doc.removeEventListener('mousedown', onDown, true)
        doc.removeEventListener('click', blockNav, true)
        doc.removeEventListener('auxclick', blockNav, true)
        doc.removeEventListener('submit', blockSubmit, true)
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
        // Scripts run so the page can paint. same-origin keeps DOM pick / HUD.
        // Guest frames cannot call privileged IPC (ipcTrust).
        sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
        // Isolation hint for modern Chromium.
        referrerPolicy="no-referrer"
      />
    </div>
  )
}
