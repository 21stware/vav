import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  extractBlockPlainText,
  highlightMatches,
  renderMarkdown,
  renderMarkdownUncached
} from '../lib/markdown'
import {
  diagramFilename,
  normalizeErdSource,
  renderDiagramBlocks,
  restoreDiagramSlots
} from '../lib/diagramRender'
import { sourceHasOpenDiagramFence } from '../lib/diagramFence'
import type { DiagramSlotState } from '../lib/diagramCache'
import {
  detachHtmlClips,
  hydrateHtmlClips,
  preparedClipDocument,
  sourceOfHtmlClip,
  type HtmlClipSlot
} from '../lib/htmlClipRender'
import {
  disposeDiagramViewportZoom,
  syncDiagramViewportZoom
} from '../lib/diagramViewportZoom'
import { resolveMentionedPath } from '../lib/filePathLinks'
import { revealCitation } from '../lib/mdMarks'
import { joinPath } from '../lib/path'
import { openConversationFile, revealSessionFileInFinder } from '../lib/openSessionFile'
import { onHljsReady } from '../lib/hljsLazy'
import { tt } from '../i18n/useT'
import {
  renderPreviewMarkdown,
  renderPreviewMarkdownProgressive,
  type ProgressivePreviewSeal
} from '../lib/previewMarkdown'
import { TAIL_PLAIN_TEXT_THRESHOLD } from '../lib/segmenter'
import { suppressHyperlinkClick } from '../lib/suppressHyperlinks'
import { useSessionStore } from '../state/sessionStore'

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
 * in image mode. An open fence keeps the pending shell (and any last-good
 * SVG) until the fence closes — mermaid/vega are not parsed every stream tick.
 */
export const MarkdownView = memo(function MarkdownView({
  source,
  highlight,
  cached = true,
  filePath,
  fragment = false,
  progressive = false
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
  /**
   * File preview windowed fill: seal completed blocks as HTML and only
   * re-parse the open tail as bytes append.
   */
  progressive?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  /** Slot-aligned last good diagram frames for this view instance. */
  const diagramSlotsRef = useRef<DiagramSlotState[]>([])
  const htmlClipSlotsRef = useRef<HtmlClipSlot[]>([])
  const paintGenRef = useRef(0)
  const lastThemeRef = useRef<'light' | 'dark' | null>(null)
  const progressiveSealRef = useRef<ProgressivePreviewSeal | null>(null)
  // Theme drives mermaid/vega palette; include so dark↔light re-paints diagrams.
  const resolvedTheme = useResolvedTheme()
  // highlight.js loads async — bump so sealed rows re-render with real spans.
  const [hljsEpoch, setHljsEpoch] = useState(0)
  useEffect(() => onHljsReady(() => setHljsEpoch((n) => n + 1)), [])

  const plain = !cached && !filePath && source.length > TAIL_PLAIN_TEXT_THRESHOLD
  void hljsEpoch

  const progressiveParts =
    progressive && filePath && !plain
      ? renderPreviewMarkdownProgressive(source, filePath, progressiveSealRef.current)
      : null
  if (progressiveParts) progressiveSealRef.current = progressiveParts.seal

  // Progressive mode paints via sealed fragment views — no single root HTML.
  const html = plain
    ? ''
    : progressiveParts
      ? ''
      : filePath
        ? renderPreviewMarkdown(source, filePath)
        : cached
          ? renderMarkdown(source)
          : renderMarkdownUncached(source)
  const progressiveTail = progressiveParts?.tail ?? ''
  const progressiveSealed = progressiveParts?.sealedChunks ?? []

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || plain || progressive) return

    const gen = ++paintGenRef.current
    disposeDiagramViewportZoom(element)
    detachHtmlClips(element, htmlClipSlotsRef.current)
    element.innerHTML = html
    void hydrateHtmlClips(element, htmlClipSlotsRef.current)
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

    syncDiagramViewportZoom(element)
    // Open diagram fences live in the stream tail. Re-parsing incomplete
    // mermaid/vega every tick is the hitch; wait until the fence closes.
    if (!cached && sourceHasOpenDiagramFence(source)) {
      restoreDiagramSlots(element, diagramSlotsRef.current)
      return
    }
    void renderDiagramBlocks(element, {
      hard: cached,
      slots: diagramSlotsRef.current
    }).then(() => {
      if (gen !== paintGenRef.current) return
      syncDiagramViewportZoom(element)
    })
  }, [html, highlight, plain, cached, resolvedTheme, progressive, source])

  const onMarkdownClick = (event: React.MouseEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const cite = target.closest<HTMLButtonElement>('button.md-cite')
    if (cite) {
      event.preventDefault()
      event.stopPropagation()
      const kind = cite.dataset.citeKind
      const id = cite.dataset.citeId
      if ((kind === 'web' || kind === 'doc') && id) revealCitation(cite, kind, id)
      return
    }

    // Finder/Explorer control after the path link.
    const revealBtn = target.closest<HTMLButtonElement>('button.md-file-reveal')
    if (revealBtn) {
      event.preventDefault()
      event.stopPropagation()
      const raw = revealBtn.dataset.path || ''
      if (!raw.trim()) return
      revealSessionFileInFinder(raw)
      return
    }

    const fileLink = target.closest<HTMLAnchorElement>('a.md-file-link')
    if (fileLink) {
      event.preventDefault()
      event.stopPropagation()
      const raw = fileLink.dataset.path || fileLink.textContent || ''
      if (!raw.trim()) return
      // Chat / agent log: open in the session right drawer. Previewed .md files
      // keep standalone open so nested docs stay a separate window.
      if (filePath) {
        const resolved = resolveMentionedPath(
          raw,
          useSessionStore.getState().conversations.find(
            (c) => c.id === useSessionStore.getState().activeId
          )?.workingDirectory ?? null,
          useSessionStore.getState().home || ''
        )
        void window.vav.window.openFilePreview(resolved, {
          origin: 'session',
          conversationId: useSessionStore.getState().activeId || undefined
        })
      } else {
        openConversationFile(raw)
      }
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

  const onMarkdownDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
    handleMarkdownOverlayDoubleClick(event)
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

  if (progressive && filePath) {
    // Sealed chunks are append-only (index keys stable). Only the open tail
    // re-parses — same streaming model as agent chat.
    return (
      <div
        className={`markdown${filePath ? ' preview-markdown' : ''}`}
        onClick={onMarkdownClick}
        onDoubleClick={onMarkdownDoubleClick}
      >
        {progressiveSealed.map((chunk, index) => (
          <MarkdownView
            key={`seal-${index}`}
            source={chunk}
            filePath={filePath}
            fragment
          />
        ))}
        {progressiveTail ? (
          <MarkdownView source={progressiveTail} filePath={filePath} fragment cached={false} />
        ) : null}
      </div>
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
      onDoubleClick={onMarkdownDoubleClick}
    />
  )
})

const OVERLAY_BLOCK_KINDS = new Set([
  'image',
  'mermaid',
  'graphviz',
  'vegalite',
  'erd',
  'html-clip',
  'xstate'
])

function overlayBlockFromTarget(target: Element): HTMLElement | null {
  if (target.closest('[data-md-action], .md-diagram-zoom-reset, .md-block-bar')) return null
  const block = target.closest<HTMLElement>('.md-block')
  if (!block) return null
  const kind = block.dataset.kind || ''
  if (!OVERLAY_BLOCK_KINDS.has(kind)) return null
  if (kind === 'image') {
    return target.closest('.md-image-stage, img.md-output-image') ? block : null
  }
  if (target.closest('.md-diagram-viewport, .md-html-clip-host')) return block
  return null
}

/** Double-click the visual (chart / image / clip) — same as 在窗口中查看. */
export function handleMarkdownOverlayDoubleClick(event: { target: EventTarget | null; preventDefault(): void; stopPropagation(): void }): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const block = overlayBlockFromTarget(target)
  if (!block) return false
  event.preventDefault()
  event.stopPropagation()
  void openBlockAsFile(block, block.dataset.filename || 'preview')
  return true
}

async function handleBlockAction(
  action: string | undefined,
  block: HTMLElement,
  button: HTMLButtonElement
): Promise<void> {
  const text = extractBlockPlainText(block)
  const filename = block.dataset.filename || 'snippet.txt'
  if (action === 'copy') {
    await window.vav.conversations.copyToClipboard(text)
    flashBlockButton(button, true)
    return
  }
  if (action === 'save' || action === 'download' || action === 'download-png') {
    const ok = await downloadBlock(block, filename, text)
    if (ok === 'cancel') return
    flashBlockButton(button, ok === true)
    return
  }
  if (action === 'copy-image') {
    button.disabled = true
    try {
      const base64 = await rasterizeBlock(block)
      if (!base64 || !(await copyPngBase64ToClipboard(base64))) {
        flashBlockButton(button, false)
        return
      }
      flashBlockButton(button, true)
    } catch (err) {
      console.warn('[copy-image]', err)
      flashBlockButton(button, false)
    }
    return
  }
  if (action === 'open-file' || action === 'view-window') {
    button.disabled = true
    try {
      const opened = await openBlockAsFile(block, filename)
      flashBlockButton(button, opened)
    } catch (err) {
      console.warn('[open-file]', err)
      flashBlockButton(button, false)
    }
  }
}

async function openBlockAsFile(block: HTMLElement, filename: string): Promise<boolean> {
  const kind = block.dataset.kind || ''
  const openOverlay = window.vav.window.openOverlay

  if (kind === 'html-clip' || kind === 'xstate') {
    const text = sourceOfHtmlClip(block)
    if (!text.trim()) return false
    if (typeof openOverlay === 'function') {
      await openOverlay({
        kind: 'app',
        filename: kind === 'xstate' ? 'xstate.html' : filename || 'app.html',
        text
      })
      return true
    }
  }

  if (kind === 'image') {
    const img = block.querySelector<HTMLImageElement>('img.md-output-image')
    if (!img?.src) return false
    if (typeof openOverlay === 'function') {
      await openOverlay({
        kind: 'image',
        filename: filename || 'image.png',
        mediaSrc: img.src
      })
      return true
    }
  }

  if (kind === 'mermaid' || kind === 'graphviz' || kind === 'vegalite' || kind === 'erd') {
    const source = extractBlockPlainText(block)
    if (!source.trim()) return false
    const text = kind === 'erd' ? normalizeErdSource(source) : source
    if (typeof openOverlay === 'function') {
      await openOverlay({
        kind: 'diagram',
        diagramKind: kind === 'graphviz' ? 'graphviz' : kind === 'vegalite' ? 'vegalite' : 'mermaid',
        filename: kind === 'erd' ? 'diagram.mmd' : diagramFilename(kind),
        text
      })
      return true
    }
  }

  const writeClip = window.vav.files.writeClip
  if (typeof writeClip !== 'function') return false

  if (kind === 'html-clip' || kind === 'xstate') {
    const text = sourceOfHtmlClip(block)
    if (!text.trim()) return false
    const body = kind === 'xstate' ? preparedClipDocument(text, 'xstate') : text
    const result = await writeClip({
      filename: kind === 'xstate' ? 'xstate.html' : filename || 'app.html',
      text: body
    })
    if (!result.ok) return false
    await window.vav.window.openFilePreview(result.path, { origin: 'session', surface: 'app' })
    return true
  }

  if (kind === 'image') {
    const img = block.querySelector<HTMLImageElement>('img.md-output-image')
    if (!img?.src) return false
    const packed = await bytesFromUrl(img.src)
    if (!packed) return false
    const result = await writeClip({
      filename: filename || packed.filename,
      base64: packed.base64
    })
    if (!result.ok) return false
    await window.vav.window.openFilePreview(result.path, { origin: 'session', surface: 'app' })
    return true
  }

  if (kind === 'mermaid' || kind === 'graphviz' || kind === 'vegalite' || kind === 'erd') {
    const source = extractBlockPlainText(block)
    if (!source.trim()) return false
    const text = kind === 'erd' ? normalizeErdSource(source) : source
    const result = await writeClip({
      filename: kind === 'erd' ? 'diagram.mmd' : diagramFilename(kind),
      text
    })
    if (!result.ok) return false
    await window.vav.window.openFilePreview(result.path, { origin: 'session', surface: 'app' })
    return true
  }

  const source = extractBlockPlainText(block)
  if (!source.trim()) return false
  const result = await writeClip({ filename: filename || 'snippet.txt', text: source })
  if (!result.ok) return false
  const htmlPage = kind === 'code' && /\.html?$/i.test(filename || '')
  if (htmlPage && typeof openOverlay === 'function') {
    await openOverlay({ kind: 'app', filename, text: source })
    return true
  }
  await window.vav.window.openFilePreview(result.path, {
    origin: 'session',
    surface: htmlPage ? 'app' : 'file'
  })
  return true
}

async function rasterizeBlock(block: HTMLElement): Promise<string | null> {
  const kind = block.dataset.kind || ''
  if (kind === 'image') {
    const img = block.querySelector<HTMLImageElement>('img.md-output-image')
    if (!img?.src) return null
    const packed = await bytesFromUrl(img.src)
    return packed?.base64 ?? null
  }
  return diagramBlockToPngBase64(block)
}

async function downloadBlock(
  block: HTMLElement,
  filename: string,
  text: string
): Promise<boolean | 'cancel'> {
  const kind = block.dataset.kind || ''
  if (kind === 'mermaid' || kind === 'graphviz' || kind === 'vegalite' || kind === 'erd') {
    const pngName = (filename || 'diagram').replace(/\.[^.]+$/, '') + '.png'
    const base64 = await diagramBlockToPngBase64(block)
    if (!base64) return false
    return writeDownloadedBinary(pngName, base64)
  }
  if (kind === 'image') {
    const img = block.querySelector<HTMLImageElement>('img.md-output-image')
    if (!img?.src) return false
    const packed = await bytesFromUrl(img.src)
    if (!packed) return false
    return writeDownloadedBinary(filename || packed.filename, packed.base64)
  }
  const result = await window.vav.files.saveAs(filename || 'snippet.txt', text)
  if (!result.ok) return result.cancelled ? 'cancel' : false
  return true
}

function sessionWorkspaceDir(): string | null {
  const state = useSessionStore.getState()
  const conv = state.conversations.find((c) => c.id === state.activeId)
  const dir = conv?.workingDirectory?.trim()
  return dir && !dir.startsWith('__') ? dir : null
}

function safeDownloadName(name: string): string {
  const cleaned = name.replace(/[/\\]+/g, '-').replace(/^\.+/g, '').trim()
  return cleaned || 'image.png'
}

function inspectLooksMissing(error: string | undefined): boolean {
  if (!error) return false
  return /enoent|no such file|not found|does not exist/i.test(error)
}

async function uniqueWorkspaceFile(dir: string, name: string): Promise<string> {
  const safe = safeDownloadName(name)
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  for (let i = 0; i < 80; i++) {
    const candidate = joinPath(dir, i === 0 ? safe : `${stem}-${i}${ext}`)
    const info = await window.vav.files.inspect(candidate)
    if (inspectLooksMissing(info.error)) return candidate
    if (info.error) continue
  }
  return joinPath(dir, `${stem}-${Date.now()}${ext}`)
}

async function writeDownloadedBinary(name: string, base64: string): Promise<boolean | 'cancel'> {
  const dir = sessionWorkspaceDir()
  if (!dir) {
    useSessionStore.getState().showToast({
      kind: 'error',
      title: tt('md.download.noWorkspace')
    })
    return false
  }
  const dest = await uniqueWorkspaceFile(dir, name)
  const written = await window.vav.files.writeBinary(dest, base64)
  if (!written.ok) {
    useSessionStore.getState().showToast({
      kind: 'error',
      title: tt('md.download.failed'),
      description: written.error
    })
    return false
  }
  useSessionStore.getState().showToast({
    kind: 'success',
    title: tt('md.download.saved'),
    description: dest.slice(dir.length).replace(/^[/\\]/, '') || safeDownloadName(name)
  })
  return true
}

async function bytesFromUrl(src: string): Promise<{ base64: string; filename: string } | null> {
  try {
    if (src.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/i.exec(src)
      if (!match) return null
      const ext = mimeToExt(match[1] || '')
      return { base64: match[2]!, filename: `image.${ext}` }
    }
    const res = await fetch(src)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    const type = res.headers.get('content-type') || ''
    const ext = mimeToExt(type)
    return { base64: btoa(binary), filename: `image.${ext}` }
  } catch {
    return null
  }
}

function mimeToExt(mime: string): string {
  const type = mime.toLowerCase()
  if (type.includes('jpeg')) return 'jpg'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  if (type.includes('svg')) return 'svg'
  if (type.includes('avif')) return 'avif'
  return 'png'
}

type AckButton = HTMLButtonElement & { __ackTimers?: number[] }

function clearBlockAck(button: AckButton): void {
  for (const id of button.__ackTimers ?? []) window.clearTimeout(id)
  button.__ackTimers = []
  button.classList.remove('is-ack-out', 'is-ack-done')
  delete button.dataset.copied
  delete button.dataset.failed
  const idle = button.dataset.titleIdle
  if (idle) {
    button.title = idle
    button.setAttribute('aria-label', idle)
  }
}

/** Same 100 / 980 / 1100 Morph as MessageActionButton (blur → check → restore). */
function flashBlockButton(button: HTMLButtonElement, ok: boolean): void {
  const btn = button as AckButton
  btn.disabled = false
  clearBlockAck(btn)
  if (!ok) {
    btn.dataset.failed = 'true'
    btn.__ackTimers = [
      window.setTimeout(() => {
        delete btn.dataset.failed
      }, 1200)
    ]
    return
  }
  const done = btn.dataset.titleDone
  btn.classList.add('is-ack-out')
  btn.__ackTimers = [
    window.setTimeout(() => {
      btn.dataset.copied = 'true'
      btn.classList.remove('is-ack-out')
      btn.classList.add('is-ack-done')
      if (done) {
        btn.title = done
        btn.setAttribute('aria-label', done)
      }
    }, 100),
    window.setTimeout(() => {
      btn.classList.add('is-ack-out')
      btn.classList.remove('is-ack-done')
    }, 980),
    window.setTimeout(() => {
      clearBlockAck(btn)
    }, 1100)
  ]
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
