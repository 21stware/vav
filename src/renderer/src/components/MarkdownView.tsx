import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  extractBlockPlainText,
  highlightMatches,
  renderMarkdown,
  renderMarkdownUncached
} from '../lib/markdown'
import type { DiagramSlotState } from '../lib/diagramCache'
import { renderDiagramBlocks } from '../lib/diagramRender'
import { resolveMentionedPath } from '../lib/filePathLinks'
import { onHljsReady } from '../lib/hljsLazy'
import { renderPreviewMarkdown } from '../lib/previewMarkdown'
import { TAIL_PLAIN_TEXT_THRESHOLD } from '../lib/segmenter'
import { suppressHyperlinkClick } from '../lib/suppressHyperlinks'
import { useSessionStore } from '../state/sessionStore'
import { tt } from '../i18n/useT'

/** Resolved light/dark for diagram re-paint (follows settings + OS when system). */
function useResolvedTheme(): 'light' | 'dark' {
  const theme = useSessionStore((s) => s.settings.theme)
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light'
  )
  useEffect(() => {
    const read = (): void => {
      setResolved(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    }
    read()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', read)
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', read)
      obs.disconnect()
    }
  }, [theme])
  return resolved
}

/**
 * One rendered markdown region.
 *
 * Sealed chunks pass `cached` (the default). The open stream tail passes
 * `cached={false}` and re-parses each tick.
 *
 * Pass `fragment` when several views share one outer `.markdown` (streaming):
 * each chunk must not be its own `.markdown` root, or first/last-child margin
 * resets make heading/paragraph spacing diverge from the finished message.
 *
 * Diagram fences use a progressive visual host: once detected, the UI stays
 * in image mode and updates the last good SVG — it does not bounce back to
 * a syntax-highlighted source block between frames.
 */
export const MarkdownView = memo(function MarkdownView({
  source,
  highlight,
  cached = true,
  filePath,
  fragment = false
}: {
  source: string
  highlight?: string
  cached?: boolean
  /** Absolute path of the previewed file — switches to preview markdown. */
  filePath?: string
  /**
   * Render as a chunk inside a parent `.markdown` (no nested root). Used by
   * the live stream so sealed + tail share one typography context.
   */
  fragment?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  /** Slot-aligned last good diagram frames for this view instance. */
  const diagramSlotsRef = useRef<DiagramSlotState[]>([])
  const paintGenRef = useRef(0)
  const lastThemeRef = useRef<'light' | 'dark' | null>(null)
  // Theme drives mermaid/vega palette; include so dark↔light re-paints diagrams.
  const resolvedTheme = useResolvedTheme()
  // highlight.js loads async — bump so sealed rows re-render with real spans.
  const [hljsEpoch, setHljsEpoch] = useState(0)
  useEffect(() => onHljsReady(() => setHljsEpoch((n) => n + 1)), [])

  const plain = !cached && !filePath && source.length > TAIL_PLAIN_TEXT_THRESHOLD
  void hljsEpoch
  const html = plain
    ? ''
    : filePath
      ? renderPreviewMarkdown(source, filePath)
      : cached
        ? renderMarkdown(source)
        : renderMarkdownUncached(source)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || plain) return

    const gen = ++paintGenRef.current
    element.innerHTML = html
    if (highlight) highlightMatches(element, highlight)

    const hasDiagram =
      html.includes('md-mermaid') ||
      html.includes('md-diagram') ||
      html.includes('md-graphviz') ||
      html.includes('md-vegalite') ||
      html.includes('md-erd')
    if (!hasDiagram) {
      diagramSlotsRef.current = []
      return
    }

    // Progressive paint: keep last-good SVG per slot; never flash source text.
    // On theme flip, drop slot cache so we don't paste the opposite-theme SVG.
    if (lastThemeRef.current !== null && lastThemeRef.current !== resolvedTheme) {
      diagramSlotsRef.current = []
    }
    lastThemeRef.current = resolvedTheme

    void renderDiagramBlocks(element, {
      hard: cached,
      slots: diagramSlotsRef.current
    }).then(() => {
      if (gen !== paintGenRef.current) return
    })
  }, [html, highlight, plain, cached, resolvedTheme])

  const onMarkdownClick = (event: React.MouseEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const fileLink = target.closest<HTMLAnchorElement>('a.md-file-link')
    if (fileLink) {
      event.preventDefault()
      event.stopPropagation()
      const raw = fileLink.dataset.path || fileLink.textContent || ''
      if (!raw.trim()) return
      const state = useSessionStore.getState()
      const conv = state.conversations.find((c) => c.id === state.activeId)
      const resolved = resolveMentionedPath(
        raw,
        conv?.workingDirectory ?? null,
        state.home || ''
      )
      void window.vav.window.openFilePreview(resolved, {
        origin: 'session',
        conversationId: state.activeId || undefined
      })
      return
    }

    // File preview only: inert hyperlinks (no navigate / no system browser).
    // Chat / agent log Markdown keeps normal link behaviour (open externally).
    if (filePath && suppressHyperlinkClick(event)) return

    const button = target.closest<HTMLButtonElement>('[data-md-action]')
    if (!button) return
    const block = button.closest<HTMLElement>('.md-block')
    if (!block) return
    event.preventDefault()
    void handleBlockAction(button.dataset.mdAction, block, button)
  }

  if (plain) {
    // Do not mark as `.markdown-chunk` — that class uses `display: contents`,
    // which would dissolve a <pre> and drop the text from the box tree.
    return (
      <pre className="plain-tail" ref={ref as React.RefObject<HTMLPreElement>}>
        {source}
      </pre>
    )
  }

  return (
    <div
      className={
        fragment
          ? 'markdown-chunk'
          : `markdown${filePath ? ' preview-markdown' : ''}`
      }
      ref={ref as React.RefObject<HTMLDivElement>}
      onClick={onMarkdownClick}
    />
  )
})

async function handleBlockAction(
  action: string | undefined,
  block: HTMLElement,
  button: HTMLButtonElement
): Promise<void> {
  const text = extractBlockPlainText(block)
  const filename = block.dataset.filename || 'snippet.txt'
  if (action === 'copy') {
    await window.vav.conversations.copyToClipboard(text)
    const previous = button.textContent
    button.textContent = tt('common.copied')
    button.dataset.copied = 'true'
    window.setTimeout(() => {
      button.textContent = previous
      delete button.dataset.copied
    }, 1200)
    return
  }
  if (action === 'save') {
    await window.vav.files.saveAs(filename, text)
    return
  }
  if (action === 'copy-image') {
    const previous = button.textContent
    button.disabled = true
    try {
      const base64 = await diagramBlockToPngBase64(block)
      if (!base64) {
        flashBlockButton(button, previous, 'Failed', 1400)
        return
      }
      const ok = await copyPngBase64ToClipboard(base64)
      if (!ok) {
        flashBlockButton(button, previous, 'Failed', 1400)
        return
      }
      flashBlockButton(button, previous, tt('common.copied'), 1200, true)
    } catch (err) {
      console.warn('[copy-image]', err)
      flashBlockButton(button, previous, 'Failed', 1400)
    }
    return
  }
  if (action === 'download-png') {
    const previous = button.textContent
    button.disabled = true
    try {
      const pngName = (filename || 'diagram').replace(/\.[^.]+$/, '') + '.png'
      const base64 = await diagramBlockToPngBase64(block)
      if (!base64) {
        flashBlockButton(button, previous, 'Failed', 1400)
        return
      }
      // Reuse save dialog (writes empty text first), then overwrite with PNG bytes.
      const result = await window.vav.files.saveAs(pngName, '')
      if (!result.ok) {
        button.disabled = false
        return
      }
      const written = await window.vav.files.writeBinary(result.path, base64)
      if (!written.ok) {
        flashBlockButton(button, previous, 'Failed', 1400)
        return
      }
      flashBlockButton(button, previous, 'Saved', 1200, true)
    } catch {
      flashBlockButton(button, previous, 'Failed', 1400)
    }
  }
}

function flashBlockButton(
  button: HTMLButtonElement,
  previous: string | null,
  label: string,
  ms: number,
  copied = false
): void {
  button.textContent = label
  if (copied) button.dataset.copied = 'true'
  window.setTimeout(() => {
    button.textContent = previous
    delete button.dataset.copied
    button.disabled = false
  }, ms)
}

/** Put a PNG (base64, no data-URL prefix) on the system clipboard. */
async function copyPngBase64ToClipboard(base64: string): Promise<boolean> {
  const api = window.vav?.conversations?.copyImageToClipboard
  if (typeof api === 'function') {
    try {
      const result = await api(base64)
      if (result?.ok) return true
      console.warn('[copy-image] ipc failed', result)
    } catch (err) {
      console.warn('[copy-image] ipc threw', err)
    }
  } else {
    console.warn('[copy-image] copyImageToClipboard missing — restart app to load preload')
  }

  // Fallback when main/preload is stale (dev session started before the IPC landed).
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'image/png' })
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return true
    }
  } catch (err) {
    console.warn('[copy-image] ClipboardItem fallback failed', err)
  }
  return false
}

function parseSvgLength(raw: string | null, fallback: number): number {
  if (!raw) return fallback
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function measureSvg(svg: SVGSVGElement): { w: number; h: number } {
  const rect = svg.getBoundingClientRect()
  if (rect.width >= 8 && rect.height >= 8) {
    return { w: rect.width, h: rect.height }
  }
  const vb = svg.viewBox?.baseVal
  if (vb && vb.width > 0 && vb.height > 0) {
    return { w: vb.width, h: vb.height }
  }
  try {
    const box = svg.getBBox()
    if (box.width >= 8 && box.height >= 8) return { w: box.width, h: box.height }
  } catch {
    // getBBox throws if SVG is not in the DOM / not rendered
  }
  return {
    w: parseSvgLength(svg.getAttribute('width'), 640),
    h: parseSvgLength(svg.getAttribute('height'), 360)
  }
}

/** Rasterize the first SVG inside a diagram block to PNG (2× retina). */
async function diagramBlockToPngBase64(block: HTMLElement): Promise<string | null> {
  const host = block.querySelector<HTMLElement>('.md-diagram, .md-mermaid, .md-vegalite')
  if (!host) return null

  // Prefer live SVG; also accept already-rasterized img fallbacks.
  const svg = host.querySelector('svg')
  if (!svg) {
    const img = host.querySelector('img')
    if (img?.src) {
      try {
        return await rasterizeImageElement(img)
      } catch {
        return null
      }
    }
    return null
  }

  const { w: rawW, h: rawH } = measureSvg(svg)
  let w = rawW
  let h = rawH
  if (!Number.isFinite(w) || w < 8) w = 640
  if (!Number.isFinite(h) || h < 8) h = 360

  // Cap huge charts; keep at least 1× CSS pixels for crisp paste.
  const scale = Math.min(2, 2400 / Math.max(w, h))
  const outW = Math.max(1, Math.round(w * scale))
  const outH = Math.max(1, Math.round(h * scale))

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('width', String(outW))
  clone.setAttribute('height', String(outH))
  if (!clone.getAttribute('viewBox')) {
    // Keep geometry when author only set CSS size / bbox.
    try {
      const box = svg.getBBox()
      if (box.width > 0 && box.height > 0) {
        clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`)
      } else {
        clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
      }
    } catch {
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
  }
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  // Mermaid sometimes relies on xlink for markers.
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
  }

  const xml = new XMLSerializer().serializeToString(clone)
  // data: URL is more reliable than blob: for SVG→Image in Chromium.
  const dataUrl =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(xml).replace(/'/g, '%27').replace(/"/g, '%22')

  try {
    const img = await loadImage(dataUrl)
    return canvasFromImage(img, outW, outH)
  } catch (err) {
    console.warn('[copy-image] svg data-url raster failed, trying blob', err)
  }

  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
  const blobUrl = URL.createObjectURL(blob)
  try {
    const img = await loadImage(blobUrl)
    return canvasFromImage(img, outW, outH)
  } catch (err) {
    console.warn('[copy-image] svg blob raster failed', err)
    return null
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

function canvasFromImage(img: HTMLImageElement, outW: number, outH: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dark =
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  ctx.fillStyle = dark ? '#1b1b1d' : '#fcfcfc'
  ctx.fillRect(0, 0, outW, outH)
  ctx.drawImage(img, 0, 0, outW, outH)
  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : null
}

async function rasterizeImageElement(img: HTMLImageElement): Promise<string | null> {
  const w = img.naturalWidth || img.width || 640
  const h = img.naturalHeight || img.height || 360
  const scale = Math.min(2, 2400 / Math.max(w, h))
  return canvasFromImage(img, Math.round(w * scale), Math.round(h * scale))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}
