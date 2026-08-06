/**
 * Cache successful diagram SVG by source hash + theme, and track last-good SVG
 * per stream slot so progressive re-renders never fall back to source text.
 */

const bySource = new Map<string, string>()
const MAX = 256

export type DiagramTheme = 'light' | 'dark'

export function resolvedDiagramTheme(): DiagramTheme {
  return typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'light'
}

export function diagramCacheKey(
  kind: string,
  b64: string,
  theme: DiagramTheme = resolvedDiagramTheme()
): string {
  return `${theme}:${kind}:${b64}`
}

export function getCachedDiagramSvg(
  kind: string,
  b64: string,
  theme: DiagramTheme = resolvedDiagramTheme()
): string | undefined {
  if (!b64) return undefined
  return bySource.get(diagramCacheKey(kind, b64, theme))
}

export function setCachedDiagramSvg(
  kind: string,
  b64: string,
  svg: string,
  theme: DiagramTheme = resolvedDiagramTheme()
): void {
  if (!b64 || !svg) return
  if (bySource.size >= MAX) {
    const drop = Math.floor(MAX / 2)
    let i = 0
    for (const key of bySource.keys()) {
      bySource.delete(key)
      if (++i >= drop) break
    }
  }
  bySource.set(diagramCacheKey(kind, b64, theme), svg)
}

/** Per MarkdownView instance: last successful visual for diagram slot index. */
export type DiagramSlotState = {
  kind: string
  /** Last source that painted successfully. */
  source: string
  /** SVG / embed HTML for the last good frame. */
  visualHtml: string
}

export function restoreCachedDiagram(el: HTMLElement): boolean {
  const kind = el.dataset.kind || 'mermaid'
  const theme = resolvedDiagramTheme()
  const b64 =
    el.dataset.b64 ||
    el.closest('[data-diagram-b64]')?.getAttribute('data-diagram-b64') ||
    el.closest('[data-mermaid-b64]')?.getAttribute('data-mermaid-b64') ||
    ''
  if (!b64) return false
  const svg = getCachedDiagramSvg(kind, b64, theme) || getCachedDiagramSvg('mermaid', b64, theme)
  if (!svg) return false
  applyVisual(el, svg, theme)
  return true
}

export function applyVisual(
  el: HTMLElement,
  html: string,
  theme: DiagramTheme = resolvedDiagramTheme()
): void {
  el.innerHTML = html
  el.dataset.rendered = 'ok'
  el.dataset.themeRendered = theme
  el.classList.add('md-diagram-ready', 'md-mermaid-ready', 'md-diagram-live')
  el.classList.remove('md-diagram-error', 'md-mermaid-error', 'md-diagram-pending-host')
}

/** Three-dot pulse while the first visual frame is cooking (not a skeleton bar). */
export function applyPendingShell(el: HTMLElement): void {
  const kind = el.dataset.kind || el.closest('[data-kind]')?.getAttribute('data-kind') || ''
  const label =
    kind === 'vegalite'
      ? 'Rendering chart'
      : kind === 'graphviz'
        ? 'Rendering graph'
        : kind === 'erd'
          ? 'Rendering ERD'
          : 'Rendering diagram'
  el.innerHTML =
    `<div class="md-diagram-pending" role="status" aria-live="polite" aria-label="${label}">` +
    `<span class="md-diagram-pending-label">${label}</span>` +
    `<span class="md-diagram-pending-dots" aria-hidden="true">` +
    `<span class="md-diagram-pending-dot"></span>` +
    `<span class="md-diagram-pending-dot"></span>` +
    `<span class="md-diagram-pending-dot"></span>` +
    `</span></div>`
  el.dataset.rendered = 'pending'
  el.classList.add('md-diagram-live', 'md-diagram-pending-host')
  el.classList.remove('md-diagram-ready', 'md-mermaid-ready', 'md-diagram-error', 'md-mermaid-error')
}
