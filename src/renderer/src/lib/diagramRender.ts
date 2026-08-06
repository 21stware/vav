/**
 * Stream-friendly diagram rendering for agent markdown fences:
 * Mermaid, Graphviz (DOT), Vega-Lite, ERD (via Mermaid).
 *
 * Progressive model:
 * - As soon as a diagram fence is detected, UI is visual (canvas), not a code block.
 * - Source lives only in data-b64 (for Copy). Never flash syntax-highlighted source
 *   once a visual frame exists.
 * - Each stream tick re-renders on top of the last good SVG; failures keep the
 *   previous frame until a new frame succeeds.
 */

import {
  applyPendingShell,
  applyVisual,
  getCachedDiagramSvg,
  setCachedDiagramSvg,
  type DiagramSlotState
} from './diagramCache'
import { renderMermaidBlocks } from './mermaidRender'

export type DiagramKind = 'mermaid' | 'graphviz' | 'vegalite' | 'erd'

const DIAGRAM_LANGS: Record<string, DiagramKind> = {
  mermaid: 'mermaid',
  graphviz: 'graphviz',
  dot: 'graphviz',
  gv: 'graphviz',
  'vega-lite': 'vegalite',
  vegalite: 'vegalite',
  vega: 'vegalite',
  vl: 'vegalite',
  erd: 'erd',
  er: 'erd',
  erdiagram: 'erd'
}

export function diagramKindForLang(language: string): DiagramKind | null {
  const key = language.trim().toLowerCase()
  return DIAGRAM_LANGS[key] ?? null
}

export function diagramFilename(kind: DiagramKind): string {
  switch (kind) {
    case 'mermaid':
    case 'erd':
      return 'diagram.mmd'
    case 'graphviz':
      return 'diagram.dot'
    case 'vegalite':
      return 'diagram.vl.json'
  }
}

export function encodeDiagramSource(source: string): string {
  const raw = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(raw)))
  }
  return Buffer.from(raw, 'utf8').toString('base64')
}

export function decodeDiagramSource(b64: string): string {
  try {
    return decodeURIComponent(escape(atob(b64)))
  } catch {
    try {
      return atob(b64)
    } catch {
      return ''
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Placeholder HTML for a diagram fence.
 * Body is a live canvas host — source is only in data attributes (Copy uses it).
 * No visible source `<pre>` so streaming never “looks like a code block first”.
 */
export function renderDiagramFence(kind: DiagramKind, source: string): string {
  const raw = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const b64 = encodeDiagramSource(raw)
  const name = diagramFilename(kind)
  const label =
    kind === 'vegalite'
      ? 'vega-lite'
      : kind === 'graphviz'
        ? 'graphviz'
        : kind === 'erd'
          ? 'erd'
          : kind
  return (
    `<div class="md-block md-diagram-wrap md-${kind}-wrap" data-kind="${kind}" data-filename="${escapeHtml(name)}" data-diagram-b64="${b64}">` +
    `<div class="md-block-bar">` +
    `<span class="md-block-name">${escapeHtml(label)}</span>` +
    `<span class="md-block-actions">` +
    `<button type="button" class="md-block-btn" data-md-action="copy" title="Copy source">Copy</button>` +
    `<button type="button" class="md-block-btn" data-md-action="copy-image" title="Copy image">Copy image</button>` +
    `<button type="button" class="md-block-btn" data-md-action="download-png" title="Download PNG">Download</button>` +
    `</span></div>` +
    `<div class="md-diagram md-${kind} md-diagram-live md-diagram-pending-host" data-kind="${kind}" data-b64="${b64}">` +
    pendingShellHtml(kind) +
    `</div></div>`
  )
}

/** Inline pending markup (same structure as applyPendingShell). */
function pendingShellHtml(kind: DiagramKind): string {
  const label =
    kind === 'vegalite'
      ? 'Rendering chart'
      : kind === 'graphviz'
        ? 'Rendering graph'
        : kind === 'erd'
          ? 'Rendering ERD'
          : 'Rendering diagram'
  return (
    `<div class="md-diagram-pending" role="status" aria-live="polite" aria-label="${label}">` +
    `<span class="md-diagram-pending-label">${label}</span>` +
    `<span class="md-diagram-pending-dots" aria-hidden="true">` +
    `<span class="md-diagram-pending-dot"></span>` +
    `<span class="md-diagram-pending-dot"></span>` +
    `<span class="md-diagram-pending-dot"></span>` +
    `</span></div>`
  )
}

/** @deprecated */
export function renderMermaidFence(source: string): string {
  return renderDiagramFence('mermaid', source)
}

export function sourceOf(el: HTMLElement): string {
  const b64 =
    el.dataset.b64 ||
    el.closest('.md-diagram-wrap, .md-mermaid-wrap')?.getAttribute('data-diagram-b64') ||
    el.closest('.md-mermaid-wrap')?.getAttribute('data-mermaid-b64') ||
    ''
  if (b64) {
    const decoded = decodeDiagramSource(b64)
    if (decoded.trim()) return decoded
  }
  return (
    el.querySelector('.md-diagram-fallback, .md-mermaid-fallback')?.textContent ??
    el.textContent ??
    ''
  )
}

function paintOk(el: HTMLElement, html: string, kind?: string, b64?: string): void {
  applyVisual(el, html)
  if (kind && b64) setCachedDiagramSvg(kind, b64, html)
}

function paintHardError(el: HTMLElement, message: string): void {
  el.dataset.rendered = 'error'
  el.classList.add('md-diagram-error', 'md-mermaid-error')
  el.classList.remove('md-diagram-ready', 'md-mermaid-ready', 'md-diagram-pending-host')
  el.innerHTML = `<div class="md-diagram-error-msg">${escapeHtml(message)}</div>`
}

// —— Graphviz ——
let vizReady: Promise<import('@viz-js/viz').Viz> | null = null

async function loadViz(): Promise<import('@viz-js/viz').Viz> {
  if (!vizReady) {
    vizReady = import('@viz-js/viz').then((mod) => mod.instance())
  }
  return vizReady
}

async function renderGraphvizSvg(source: string): Promise<string> {
  const viz = await loadViz()
  return viz.renderString(source.trim(), { format: 'svg' })
}

// —— Vega-Lite ——
/**
 * Paint into a sized host. Pass `widthPx` from the on-page card so charts fill
 * the column. Avoid `autosize: fit` and never strip SVG dimensions — those
 * collapse bar charts (plot empty / x labels clipped).
 */
async function renderVegaLiteHtml(
  source: string,
  host: HTMLElement,
  widthPx?: number
): Promise<string> {
  const parsed = normalizeVegaSpec(JSON.parse(source) as Record<string, unknown>)
  const embed = (await import('vega-embed')).default
  const dark =
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'

  const targetW = Math.max(280, Math.min(920, Math.floor(widthPx ?? 560) - 24))
  const authorW = typeof parsed.width === 'number' ? (parsed.width as number) : null
  const width = authorW != null && authorW > targetW ? authorW : targetW
  const authorH = typeof parsed.height === 'number' ? (parsed.height as number) : null
  const categoricalX = vegaHasCategoricalAxis(parsed, 'x')
  const categoricalY = vegaHasCategoricalAxis(parsed, 'y')
  const isBar = vegaIsBarLike(parsed)
  /**
   * Plot-area height only (VL `height`). Keep bar charts compact so tall bars
   * don't dominate the message card — author-set height always wins.
   */
  const height =
    authorH ??
    (isBar
      ? Math.min(220, Math.max(160, Math.round(width * 0.28)))
      : categoricalX || categoricalY
        ? Math.min(240, Math.max(180, Math.round(width * 0.32)))
        : undefined)

  // Enough for tilted category labels, without a huge empty skirt.
  const padding =
    parsed.padding ??
    (categoricalX
      ? { left: 8, right: 12, top: 8, bottom: 52 }
      : categoricalY
        ? { left: 88, right: 12, top: 8, bottom: 20 }
        : { left: 8, right: 12, top: 6, bottom: 20 })

  const spec: Record<string, unknown> = {
    ...parsed,
    width,
    background: parsed.background ?? 'transparent',
    padding,
    // pad = stable; never force fit (breaks bar + nominal axes).
    autosize: parsed.autosize ?? { type: 'pad', contains: 'padding' }
  }
  if (height != null) spec.height = height

  host.innerHTML = ''
  host.style.width = '100%'
  host.style.maxWidth = '100%'
  host.style.boxSizing = 'border-box'
  host.style.overflow = 'visible'

  /**
   * Theme tokens: light mode needs explicit ink — VL defaults on transparent
   * wash out against our soft card surface (labels + line nearly invisible).
   */
  const axisBase = {
    labelColor: dark ? '#a2a2a9' : '#4a4a55',
    titleColor: dark ? '#efeff1' : '#2c2c34',
    gridColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,15,25,0.08)',
    domainColor: dark ? 'rgba(255,255,255,0.22)' : 'rgba(15,15,25,0.22)',
    tickColor: dark ? 'rgba(255,255,255,0.22)' : 'rgba(15,15,25,0.22)',
    labelFontSize: 11,
    titleFontSize: 12,
    labelLimit: 120,
    labelOverlap: true as const,
    // Compact tilt for multi-char category labels under bars.
    ...(categoricalX
      ? { labelAngle: -28, labelAlign: 'right' as const, labelPadding: 4, labelFontSize: 11 }
      : {})
  }

  const markColor = dark ? '#8ab4ff' : '#1d4ed8'
  const categoryRange = dark
    ? ['#8ab4ff', '#f0a0b0', '#7dcea0', '#e0c070', '#c0a0ff', '#70d0d8']
    : ['#1d4ed8', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2']

  await embed(host, spec as never, {
    actions: false,
    renderer: 'svg',
    theme: dark ? 'dark' : undefined,
    config: {
      background: 'transparent',
      view: { stroke: null },
      axis: axisBase,
      legend: {
        labelColor: dark ? '#a2a2a9' : '#4a4a55',
        titleColor: dark ? '#efeff1' : '#2c2c34',
        labelFontSize: 11,
        titleFontSize: 12
      },
      title: {
        color: dark ? '#efeff1' : '#1a1a22',
        fontSize: 14,
        subtitleColor: dark ? '#a2a2a9' : '#5a5a66',
        offset: 8
      },
      // Default stroke/fill when the author omits a color encoding.
      mark: { color: markColor },
      line: { stroke: markColor, strokeWidth: 2.25 },
      point: { fill: markColor, size: 48 },
      area: { color: markColor },
      bar: { color: markColor },
      arc: { color: markColor },
      range: { category: categoryRange, heatmap: categoryRange }
    }
  })

  // Keep baked width/height on SVG so labels stay inside the viewBox.
  // Only soft-cap max-width for narrow panes — do NOT force height:auto alone.
  host.querySelectorAll('svg').forEach((svg) => {
    const w = Number(svg.getAttribute('width')) || 0
    const h = Number(svg.getAttribute('height')) || 0
    if (w > 0 && h > 0 && !svg.getAttribute('viewBox')) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
    svg.style.maxWidth = '100%'
    svg.style.width = '100%'
    svg.style.height = 'auto'
    svg.style.display = 'block'
    svg.style.margin = '0 auto'
    svg.style.overflow = 'visible'
  })
  return host.innerHTML
}

function vegaDomainExcludesZero(domain: unknown): boolean {
  if (!Array.isArray(domain)) return false
  const nums = domain.filter((v): v is number => typeof v === 'number')
  if (nums.length < 2) return false
  return Math.min(...nums) > 0 || Math.max(...nums) < 0
}

/**
 * vega-schema-url-parser (a vega-embed dep) crashes on `$schema` URLs that
 * lack a version segment — e.g. `https://vega-lite.github.io/schema/vega-lite.json`
 * — because its regex `schema/<lib>/<ver>.json$` returns null and it then calls
 * `.slice(1,3)` on null. Rewrite any unparseable URL to the canonical versioned
 * vega-lite v5 schema (v6 runtime accepts it; only a benign version warning).
 */
const VEGA_LITE_V5_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json'
const SCHEMA_URL_RE = /schema\/[\w-]+\/[\w.\-]+\.json$/i

function normalizeVegaSchema(spec: Record<string, unknown>): Record<string, unknown> {
  const schema = spec.$schema
  if (typeof schema !== 'string') return spec
  if (SCHEMA_URL_RE.test(schema)) return spec
  return { ...spec, $schema: VEGA_LITE_V5_SCHEMA }
}

/**
 * Bars are anchored at 0. A zoomed continuous scale (`zero: false`, or a domain
 * that excludes 0) puts that anchor outside the plot area, and Vega does not clip
 * marks by default — so the bars run past the axis and cover the category labels.
 *
 * Re-baseline at zero rather than clipping: `mark.clip` on a `cornerRadius` bar
 * makes Vega-Lite emit a clip rect of height 0, which erases the bars.
 */
function normalizeVegaSpec(spec: Record<string, unknown>): Record<string, unknown> {
  let next = normalizeVegaSchema(spec)

  for (const key of ['layer', 'hconcat', 'vconcat'] as const) {
    const children = next[key]
    if (!Array.isArray(children)) continue
    next = {
      ...next,
      [key]: children.map((child) =>
        child && typeof child === 'object'
          ? normalizeVegaSpec(child as Record<string, unknown>)
          : child
      )
    }
  }
  const inner = next.spec
  if (inner && typeof inner === 'object') {
    next = { ...next, spec: normalizeVegaSpec(inner as Record<string, unknown>) }
  }

  if (!vegaIsBarLike(next)) return next
  const enc = next.encoding
  if (!enc || typeof enc !== 'object') return next

  let encoding = enc as Record<string, unknown>
  for (const channel of ['x', 'y'] as const) {
    const def = encoding[channel]
    if (!def || typeof def !== 'object') continue
    const field = def as Record<string, unknown>
    if (field.type !== 'quantitative') continue
    const scale = (field.scale ?? {}) as Record<string, unknown>
    if (scale.zero !== false && !vegaDomainExcludesZero(scale.domain)) continue
    const nextScale: Record<string, unknown> = { ...scale, zero: true }
    if (vegaDomainExcludesZero(nextScale.domain)) delete nextScale.domain
    encoding = { ...encoding, [channel]: { ...field, scale: nextScale } }
  }

  return encoding === enc ? next : { ...next, encoding }
}

function vegaIsBarLike(spec: Record<string, unknown>): boolean {
  const mark = spec.mark
  const markType =
    typeof mark === 'string'
      ? mark
      : mark && typeof mark === 'object' && 'type' in mark
        ? String((mark as { type?: string }).type ?? '')
        : ''
  return markType === 'bar' || markType === 'rect' || markType === 'tick'
}

function vegaHasCategoricalAxis(
  spec: Record<string, unknown>,
  channel: 'x' | 'y'
): boolean {
  const enc = spec.encoding as Record<string, { type?: string } | undefined> | undefined
  const t = enc?.[channel]?.type
  return t === 'nominal' || t === 'ordinal'
}

// —— ERD via Mermaid ——
function normalizeErdSource(source: string): string {
  const trimmed = source.trim()
  if (/^erDiagram\b/i.test(trimmed)) return trimmed
  return `erDiagram\n${trimmed}`
}

export type DiagramPaintResult =
  | { ok: true; html: string }
  | { ok: false; error?: string }

/**
 * Render one diagram source to HTML (SVG). Does not touch the live node until
 * the caller decides to swap (keeps previous frame on failure).
 */
export async function paintDiagramSource(
  kind: string,
  source: string,
  options?: { widthPx?: number }
): Promise<DiagramPaintResult> {
  const trimmed = source.trim()
  if (!trimmed) return { ok: false }

  try {
    if (kind === 'graphviz') {
      const svg = await renderGraphvizSvg(trimmed)
      return { ok: true, html: svg }
    }
    if (kind === 'vegalite') {
      const host = document.createElement('div')
      host.className = 'md-diagram md-vegalite'
      // Size the off-DOM host so Vega measures a real width (not ~0/300).
      const w = Math.max(280, options?.widthPx ?? 560)
      host.style.width = `${w}px`
      host.style.maxWidth = `${w}px`
      const html = await renderVegaLiteHtml(trimmed, host, w)
      return { ok: true, html }
    }
    // mermaid + erd → handled by mermaidRender path below
    return { ok: false, error: 'use-mermaid' }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Bucket width so cache hits stay valid across tiny reflows. */
function vegaWidthBucket(px: number): number {
  return Math.max(280, Math.round(px / 40) * 40)
}

/**
 * Progressive update for all diagram nodes under `root`.
 *
 * @param slots optional per-slot last-good frames (index-aligned). Mutated in place.
 * @param hard sealed message: final errors allowed; stream: never drop last visual.
 */
export async function renderDiagramBlocks(
  root: HTMLElement,
  options?: { hard?: boolean; slots?: DiagramSlotState[] }
): Promise<void> {
  const hard = options?.hard !== false
  const slots = options?.slots

  const nodes = [
    ...root.querySelectorAll<HTMLElement>('.md-diagram, .md-mermaid')
  ]

  const mermaidEls: HTMLElement[] = []

  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!
    const kind = (el.dataset.kind ||
      el.closest('[data-kind]')?.getAttribute('data-kind') ||
      'mermaid') as string
    const b64 = el.dataset.b64 || ''
    let source = sourceOf(el)

    // Always visual chrome for diagram fences.
    el.classList.add('md-diagram-live')

    // Exact cache hit for this source.
    // Vega-Lite is width-dependent — handled below with a bucketed key.
    if (b64 && kind !== 'vegalite') {
      const hit =
        getCachedDiagramSvg(kind, b64) ||
        (kind === 'erd' ? getCachedDiagramSvg('mermaid', b64) : undefined)
      if (hit) {
        applyVisual(el, hit)
        if (slots) {
          slots[i] = { kind, source, visualHtml: hit }
        }
        continue
      }
    }

    // Immediately show last good frame for this slot (no text flash).
    const slot = slots?.[i]
    if (slot?.visualHtml) {
      applyVisual(el, slot.visualHtml)
    } else {
      applyPendingShell(el)
    }

    if (!source.trim()) continue

    if (kind === 'graphviz') {
      const result = await paintDiagramSource('graphviz', source)
      if (result.ok) {
        paintOk(el, result.html, 'graphviz', b64)
        if (slots) slots[i] = { kind, source, visualHtml: result.html }
      } else if (!slot?.visualHtml && hard) {
        paintHardError(el, result.error || 'Invalid Graphviz diagram')
      }
      // else keep previous visual / pending shell
      continue
    }

    if (kind === 'vegalite') {
      // Prefer live card width so charts fill the message column (not a 300px island).
      const measureEl = (el.closest('.md-block') as HTMLElement | null) ?? el
      const widthPx = vegaWidthBucket(
        measureEl.clientWidth || el.parentElement?.clientWidth || 560
      )
      // Width-bucketed cache key (same JSON at different widths needs re-paint).
      const cacheKind = `vegalite@${widthPx}`
      if (b64) {
        const hit = getCachedDiagramSvg(cacheKind, b64)
        if (hit) {
          applyVisual(el, hit)
          if (slots) slots[i] = { kind, source, visualHtml: hit }
          continue
        }
      }
      const result = await paintDiagramSource('vegalite', source, { widthPx })
      if (result.ok) {
        paintOk(el, result.html, cacheKind, b64)
        if (slots) slots[i] = { kind, source, visualHtml: result.html }
      } else if (!slot?.visualHtml && hard) {
        paintHardError(el, result.error || 'Invalid Vega-Lite JSON')
      }
      continue
    }

    if (kind === 'erd' || kind === 'mermaid') {
      const paintKind = kind === 'erd' ? 'erd' : 'mermaid'
      const paintSource = kind === 'erd' ? normalizeErdSource(source) : source
      const paintB64 = encodeDiagramSource(paintSource)
      el.classList.add('md-mermaid')
      el.dataset.kind = paintKind
      el.dataset.b64 = paintB64

      // Same source + same theme as last good frame → keep visual.
      const themeNow =
        typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
          ? 'dark'
          : 'light'
      if (
        slot?.visualHtml &&
        slot.source === paintSource &&
        el.dataset.themeRendered === themeNow
      ) {
        applyVisual(el, slot.visualHtml, themeNow)
        continue
      }

      // Source advanced: keep last frame visible while we try the next.
      if (slot?.visualHtml) applyVisual(el, slot.visualHtml)
      else applyPendingShell(el)

      // Must clear ok so mermaid attempts this new source.
      delete el.dataset.rendered
      mermaidEls.push(el)
      continue
    }
  }

  if (mermaidEls.length > 0) {
    const prev = mermaidEls.map((el) => {
      const i = nodes.indexOf(el)
      return (i >= 0 && slots?.[i]?.visualHtml) || ''
    })

    await renderMermaidBlocks(root, { hard: false })

    mermaidEls.forEach((el, idx) => {
      const i = nodes.indexOf(el)
      const kind = el.dataset.kind || 'mermaid'
      const b64 = el.dataset.b64 || ''
      const src = sourceOf(el)

      if (el.dataset.rendered === 'ok' && el.querySelector('svg')) {
        const html = el.innerHTML
        if (b64) setCachedDiagramSvg(kind, b64, html)
        if (slots && i >= 0) slots[i] = { kind, source: src, visualHtml: html }
        return
      }

      // Incomplete / invalid: stay on last visual (or pending). Never source text.
      const keep = (i >= 0 && slots?.[i]?.visualHtml) || prev[idx]
      if (keep) {
        applyVisual(el, keep)
        return
      }
      if (hard) {
        paintHardError(el, 'Invalid diagram')
      } else {
        applyPendingShell(el)
      }
    })
  }
}
