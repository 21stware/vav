/**
 * Post-process Mermaid / Graphviz SVG for full-bleed preview:
 * transparent bg, whole-node pick targets (not text glyphs).
 */

export type DiagramSvgKind = 'mermaid' | 'graphviz'

function isLightFill(fill: string | null): boolean {
  if (!fill) return false
  const f = fill.trim().toLowerCase()
  return (
    f === 'white' ||
    f === '#fff' ||
    f === '#ffffff' ||
    f === '#f9f9f9' ||
    f === '#ffffff00' ||
    f === 'rgb(255,255,255)' ||
    f === 'rgb(255, 255, 255)'
  )
}

/** Strip paper-white graph backgrounds so dark UI shows through. */
export function clearDiagramPaperBackground(svg: SVGSVGElement): void {
  svg.style.background = 'transparent'
  svg.setAttribute('style', (svg.getAttribute('style') || '').replace(/background[^;]*;?/gi, ''))
  // Graphviz: large white polygon / rect behind the graph. Skip shapes inside
  // nodes/edges so connector lines (edges are paths/polygons) are never stripped.
  const candidates = svg.querySelectorAll('polygon, rect, ellipse, path')
  for (const el of Array.from(candidates)) {
    const inNodeOrEdge = el.closest('.node, .edge, g.node, g.edge')
    if (inNodeOrEdge) continue
    const fill = el.getAttribute('fill')
    if (!isLightFill(fill)) continue
    // Background poly usually has no stroke or covers full viewBox
    const stroke = el.getAttribute('stroke')
    if (!stroke || stroke === 'none' || isLightFill(stroke)) {
      // Only strip very large shapes (canvas fill), not node bodies with white fill in light theme
      const bb = (el as SVGGraphicsElement).getBBox?.()
      if (!bb) continue
      const vb = svg.viewBox?.baseVal
      if (vb && vb.width > 0 && vb.height > 0) {
        const covers =
          bb.width * bb.height > vb.width * vb.height * 0.5 ||
          (bb.x <= vb.x + 1 &&
            bb.y <= vb.y + 1 &&
            bb.width >= vb.width * 0.9 &&
            bb.height >= vb.height * 0.9)
        if (covers) {
          el.setAttribute('fill', 'none')
          el.setAttribute('stroke', 'none')
        }
      }
      // Non-node/edge stray polygon with no vb: leave edges (already skipped).
    }
  }
}

/**
 * Mark selectable node *groups* only. Clicks on text inside bubble to the group.
 */
export function annotateDiagramPickTargets(root: HTMLElement, kind: DiagramSvgKind): void {
  const svg = root.querySelector('svg')
  if (!svg) return
  clearDiagramPaperBackground(svg as SVGSVGElement)

  // Clear previous
  root.querySelectorAll('.diagram-pick-target').forEach((el) => {
    el.classList.remove('diagram-pick-target', 'preview-select-region', 'office-pick-target', 'selected')
    delete (el as HTMLElement).dataset.diagramId
    delete (el as HTMLElement).dataset.diagramLabel
    delete (el as HTMLElement).dataset.blockId
  })
  root.querySelectorAll('.diagram-select-overlay').forEach((el) => el.remove())

  let groups: Element[] = []
  if (kind === 'graphviz') {
    groups = Array.from(svg.querySelectorAll('g.node'))
  } else {
    // Mermaid: flowchart/state/class use g.node; sequence uses g.actor
    groups = Array.from(
      svg.querySelectorAll(
        'g.node, g[class*="node"], g.actor, g.section, g.pieTitleText, g.mindmap-node, g.mind'
      )
    )
    // Dedupe nested
    groups = groups.filter((g) => !groups.some((o) => o !== g && o.contains(g)))
    if (groups.length === 0) {
      // Fallback: top-level groups with an id that look like nodes
      groups = Array.from(svg.querySelectorAll('g[id]')).filter((g) => {
        const id = g.getAttribute('id') || ''
        if (/^flowchart-|^state-|^class-|^actor|^pie-|^mindmap/i.test(id)) return true
        return !!g.querySelector('rect, polygon, circle, ellipse, path.basic')
      })
      groups = groups.filter((g) => !groups.some((o) => o !== g && o.contains(g)))
    }
  }

  groups.forEach((g, i) => {
    const he = g as HTMLElement
    // Text/title never own the pick — whole node does.
    he.querySelectorAll('text, tspan, title').forEach((t) => {
      ;(t as HTMLElement).style.pointerEvents = 'none'
    })
    he.classList.add('diagram-pick-target', 'preview-select-region', 'office-pick-target')
    const label =
      Array.from(he.querySelectorAll('text'))
        .map((t) => t.textContent?.trim() || '')
        .filter(Boolean)
        .join(' ')
        .slice(0, 200) ||
      he.getAttribute('id') ||
      `node-${i}`
    // Stable id: keep explicit node ids; otherwise derive from content so
    // re-renders re-target the same node (mermaid regenerates ephemeral ids).
    const rawId = he.getAttribute('id') || `c${i}-${label.slice(0, 24).replace(/\s+/g, '_')}`
    he.dataset.diagramLabel = label
    he.dataset.diagramId = rawId
    he.dataset.blockId = `diag-${rawId}`
  })

  // Selection outline: a dedicated overlay rect per node, kept in sync with the
  // node's live bounding box. Stroke-on-the-shape leaks onto adjacent edges in
  // many diagrams (one node "selects" the whole graph) — overlay is isolated.
  const NS = 'http://www.w3.org/2000/svg'
  const overlay = document.createElementNS(NS, 'g')
  overlay.setAttribute('class', 'diagram-select-overlay')
  overlay.setAttribute('aria-hidden', 'true')
  groups.forEach((g) => {
    const he = g as HTMLElement
    try {
      const bb = (g as SVGGraphicsElement).getBBox()
      if (bb.width < 2 || bb.height < 2) return
      const rect = document.createElementNS(NS, 'rect')
      rect.setAttribute('class', 'diagram-select-rect')
      rect.setAttribute('x', String(bb.x - 3))
      rect.setAttribute('y', String(bb.y - 3))
      rect.setAttribute('width', String(bb.width + 6))
      rect.setAttribute('height', String(bb.height + 6))
      rect.setAttribute('rx', '6')
      rect.setAttribute('ry', '6')
      const id = he.dataset.blockId || `diag-${he.dataset.diagramId ?? ''}`
      rect.setAttribute('data-select-for', id)
      rect.setAttribute('fill', 'none')
      overlay.appendChild(rect)
    } catch {
      // getBBox throws if not in DOM yet
    }
  })
  svg.appendChild(overlay)
}

/** Apply selected class from id set (`diag-…` or raw). */
export function syncDiagramSelection(root: HTMLElement, selectedIds: string[]): void {
  const set = new Set(selectedIds)
  root.querySelectorAll<HTMLElement>('.diagram-pick-target').forEach((el) => {
    const id = el.dataset.blockId || `diag-${el.dataset.diagramId ?? ''}`
    const on = set.has(id) || set.has(el.dataset.diagramId || '')
    el.classList.toggle('selected', on)
    el.classList.toggle('is-selected', on)
  })
  root.querySelectorAll<HTMLElement>('.diagram-select-rect').forEach((ov) => {
    const forId = ov.dataset.selectFor || ''
    const on = set.has(forId) || set.has(forId.replace(/^diag-/, ''))
    ov.classList.toggle('on', on)
  })
}

/**
 * For Graphviz on dark UI: inject transparent paper + readable nodes when source
 * has no explicit colors (prepend graph attrs once).
 */
export function themeGraphvizSource(source: string, dark: boolean): string {
  if (!dark) return source
  const trimmed = source.trim()
  // Already has bgcolor — leave alone
  if (/\bbgcolor\s*=/i.test(trimmed)) return source
  const inject =
    'bgcolor="transparent"; ' +
    'node [style="filled,rounded", fillcolor="#2a2a2e", fontcolor="#efeff1", color="#8a8a94"]; ' +
    'edge [color="#8a8a94", fontcolor="#c8c8d0"]; '
  // digraph G { ... } or graph {
  const m = trimmed.match(/^(strict\s+)?(di)?graph\s+([^{\s]+)?\s*\{/i)
  if (!m) return source
  const insertAt = (m.index ?? 0) + m[0].length
  return trimmed.slice(0, insertAt) + '\n  ' + inject + '\n' + trimmed.slice(insertAt)
}
