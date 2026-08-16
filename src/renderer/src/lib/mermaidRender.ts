/**
 * Lazy mermaid rendering for markdown fences.
 * Prefers beautiful-mermaid (flowchart / state / sequence / class / ER / XY).
 * Falls back to mermaid.js for types it does not cover (gantt, pie, timeline, …).
 */

import {
  getCachedDiagramSvg,
  resolvedDiagramTheme,
  setCachedDiagramSvg,
  type DiagramTheme
} from './diagramCache'
import { normalizeDiagramSvgSize } from './diagramSvgPick'
import { stripMermaidPreamble } from './mermaidSource'

export { stripMermaidPreamble }

export type MermaidEngine = 'beautiful' | 'mermaid'

let beautifulReady: Promise<typeof import('beautiful-mermaid')> | null = null
let mermaidReady: Promise<typeof import('mermaid').default> | null = null
let diagramSeq = 0
let lastTheme: DiagramTheme | null = null

function loadBeautiful(): Promise<typeof import('beautiful-mermaid')> {
  if (!beautifulReady) beautifulReady = import('beautiful-mermaid')
  return beautifulReady
}

/** Theme variables tuned for our card surfaces (timeline needs explicit scales). */
function mermaidInitConfig(theme: DiagramTheme): Parameters<
  typeof import('mermaid').default.initialize
>[0] {
  if (theme === 'dark') {
    // Grayscale-friendly cScale so timeline boxes stay dark with light labels.
    const scales = ['#3a3a42', '#4a4a54', '#32323a', '#45454f', '#2e2e36', '#3f3f48']
    const labels = Object.fromEntries(
      scales.flatMap((_, i) => [
        [`cScale${i}`, scales[i]!],
        [`cScaleLabel${i}`, '#efeff1'],
        [`cScaleInv${i}`, '#a2a2a9']
      ])
    )
    return {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: 'var(--font-ui, system-ui, sans-serif)',
      themeVariables: {
        darkMode: true,
        background: 'transparent',
        primaryColor: '#3a3a42',
        primaryTextColor: '#efeff1',
        primaryBorderColor: '#6a6a74',
        secondaryColor: '#2a2a2e',
        secondaryTextColor: '#efeff1',
        tertiaryColor: '#242427',
        tertiaryTextColor: '#efeff1',
        lineColor: '#a2a2a9',
        textColor: '#efeff1',
        mainBkg: '#3a3a42',
        nodeBorder: '#6a6a74',
        clusterBkg: '#2a2a2e',
        titleColor: '#efeff1',
        actorTextColor: '#efeff1',
        ...labels
      }
    }
  }
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'neutral',
    fontFamily: 'var(--font-ui, system-ui, sans-serif)',
    themeVariables: {
      darkMode: false,
      background: 'transparent',
      primaryTextColor: '#141416',
      textColor: '#141416',
      lineColor: '#5c5c66',
      titleColor: '#141416'
    }
  }
}

async function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      const mermaid = mod.default
      lastTheme = resolvedDiagramTheme()
      mermaid.initialize(mermaidInitConfig(lastTheme))
      return mermaid
    })
  }
  return mermaidReady
}

function decodeB64(b64: string): string {
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

function cssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function beautifulOptions(theme: DiagramTheme): {
  bg: string
  fg: string
  muted: string
  surface: string
  border: string
  accent: string
  transparent: true
  font: string
  padding: number
} {
  const dark = theme === 'dark'
  return {
    bg: cssToken('--bg-content', dark ? '#1b1b1d' : '#fcfcfc'),
    fg: cssToken('--text', dark ? '#efeff1' : '#141416'),
    muted: cssToken('--text-secondary', dark ? '#a2a2a9' : '#5c5c66'),
    surface: cssToken('--bg-raised', dark ? '#242427' : '#ffffff'),
    border: cssToken('--border-strong', dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(20, 20, 28, 0.16)'),
    accent: cssToken('--accent', dark ? '#c8c8d0' : '#3a3a42'),
    transparent: true,
    // Single family name: beautiful-mermaid always @import's Google Fonts for
    // this string. We strip that import after render and keep the local stack.
    font: '-apple-system',
    padding: 24
  }
}

function stripGoogleFontImports(svg: string): string {
  return svg.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^']*'\);\s*/gi, '')
}

function looksLikeSvg(markup: string): boolean {
  return /<svg[\s>]/i.test(markup)
}

/**
 * Render mermaid source to SVG markup.
 * beautiful-mermaid first; mermaid.js if the type or syntax is unsupported.
 */
export async function renderMermaidSvgMarkup(
  source: string,
  theme: DiagramTheme = resolvedDiagramTheme()
): Promise<{ svg: string; engine: MermaidEngine }> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('Empty mermaid diagram')

  try {
    const { renderMermaidSVG } = await loadBeautiful()
    const svg = stripGoogleFontImports(
      renderMermaidSVG(stripMermaidPreamble(trimmed), beautifulOptions(theme))
    )
    if (looksLikeSvg(svg)) return { svg, engine: 'beautiful' }
  } catch {
    // Unsupported type or parser gap — mermaid.js still covers gantt/pie/timeline/…
  }

  const mermaid = await loadMermaid()
  if (theme !== lastTheme) {
    lastTheme = theme
    mermaid.initialize(mermaidInitConfig(theme))
  }
  const id = `vav-mmd-${++diagramSeq}`
  const { svg } = await mermaid.render(id, trimmed)
  return { svg, engine: 'mermaid' }
}

export function finishMermaidHost(
  host: HTMLElement,
  theme: DiagramTheme,
  engine: MermaidEngine
): void {
  if (engine === 'mermaid') {
    adaptMermaidSvgForTheme(host, theme)
    return
  }
  const svg = host.querySelector('svg')
  if (svg) normalizeDiagramSvgSize(svg as SVGSVGElement)
  host.dataset.themeRendered = theme
}

/**
 * Timeline (and some other diagrams) hardcode black strokes / bare titles with
 * no fill. Patch after render so dark chrome stays readable.
 */
export function adaptMermaidSvgForTheme(host: HTMLElement, theme: DiagramTheme): void {
  const svg = host.querySelector('svg')
  if (!svg) return
  // Intrinsic px size from the viewBox: mermaid's `width="100%"` + inline
  // max-width renders at an arbitrary size and clips in narrow columns.
  normalizeDiagramSvgSize(svg as SVGSVGElement)

  const ink = theme === 'dark' ? '#efeff1' : '#141416'
  const stroke = theme === 'dark' ? '#a2a2a9' : '#5c5c66'
  const isBlack = (v: string | null): boolean => {
    if (!v) return false
    const s = v.trim().toLowerCase()
    return s === 'black' || s === '#000' || s === '#000000' || s === 'rgb(0,0,0)' || s === 'rgb(0, 0, 0)'
  }

  svg.querySelectorAll('text').forEach((node) => {
    const el = node as SVGTextElement
    const fill = el.getAttribute('fill')
    // Bare titles (timeline) omit fill → browser default black.
    if (!fill || fill === 'currentColor' || isBlack(fill)) {
      el.setAttribute('fill', ink)
    }
  })

  svg.querySelectorAll('line, path, polyline, polygon').forEach((node) => {
    const el = node as SVGElement
    if (isBlack(el.getAttribute('stroke'))) {
      el.setAttribute('stroke', stroke)
    }
    if (isBlack(el.getAttribute('fill')) && el.tagName.toLowerCase() !== 'text') {
      // Arrowhead markers often fill black.
      if (el.closest('marker')) el.setAttribute('fill', stroke)
    }
  })

  svg.querySelectorAll('marker path, marker polygon, marker circle').forEach((node) => {
    const el = node as SVGElement
    if (!el.getAttribute('fill') || isBlack(el.getAttribute('fill'))) {
      el.setAttribute('fill', stroke)
    }
  })

  host.dataset.themeRendered = theme
}

/**
 * Paint `.md-mermaid` nodes that are not already ok for the current theme.
 * On failure leaves the node untouched (caller restores last visual / pending).
 * Does not write error text into the node during stream (hard=false).
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  options?: { hard?: boolean }
): Promise<void> {
  const hard = options?.hard !== false
  const theme = resolvedDiagramTheme()
  const list = [...root.querySelectorAll<HTMLElement>('.md-mermaid')].filter((el) => {
    if (el.dataset.rendered === 'ok' && el.dataset.themeRendered === theme) return false
    // Theme flipped under a finished paint — force a new render.
    if (el.dataset.rendered === 'ok') delete el.dataset.rendered
    return true
  })
  if (list.length === 0) return

  for (const el of list) {
    if (el.dataset.rendered === 'ok' && el.dataset.themeRendered === theme) continue

    let source = ''
    const b64 =
      el.dataset.b64 ||
      el.closest('.md-mermaid-wrap')?.getAttribute('data-mermaid-b64') ||
      el.closest('[data-diagram-b64]')?.getAttribute('data-diagram-b64') ||
      ''
    const kind = el.dataset.kind || 'mermaid'

    if (b64) {
      const cacheKind = `bm:${kind}`
      const hit = getCachedDiagramSvg(cacheKind, b64, theme)
      if (hit) {
        el.innerHTML = hit
        el.dataset.rendered = 'ok'
        el.classList.add('md-mermaid-ready', 'md-diagram-ready', 'md-diagram-live')
        el.classList.remove('md-mermaid-error', 'md-diagram-error', 'md-diagram-pending-host')
        const engine = (el.querySelector('svg')?.dataset.engine as MermaidEngine | undefined) || 'beautiful'
        finishMermaidHost(el, theme, engine)
        continue
      }
      source = decodeB64(b64)
    }
    if (!source.trim()) {
      source = el.querySelector('.md-mermaid-fallback')?.textContent ?? ''
    }
    if (!source.trim()) {
      el.dataset.rendered = 'empty'
      continue
    }

    try {
      const { svg, engine } = await renderMermaidSvgMarkup(source, theme)
      el.innerHTML = svg
      const painted = el.querySelector('svg')
      if (painted) painted.dataset.engine = engine
      finishMermaidHost(el, theme, engine)
      const finalHtml = el.innerHTML
      if (b64) setCachedDiagramSvg(`bm:${kind}`, b64, finalHtml, theme)
      el.dataset.rendered = 'ok'
      el.classList.add('md-mermaid-ready', 'md-diagram-ready', 'md-diagram-live')
      el.classList.remove('md-mermaid-error', 'md-diagram-error', 'md-diagram-pending-host')
    } catch (err) {
      // Leave node as-is (pending shell or previous visual). Caller decides.
      if (hard) {
        el.dataset.rendered = 'error'
        el.classList.add('md-mermaid-error', 'md-diagram-error')
        el.textContent =
          err instanceof Error && /failed to load/i.test(err.message)
            ? `Mermaid failed to load: ${err.message}`
            : 'Invalid mermaid diagram'
      } else {
        // Mark not-ok without wiping — progressive layer keeps last SVG.
        delete el.dataset.rendered
      }
    }
  }
}
