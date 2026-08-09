/**
 * Post-process Mermaid / Graphviz SVG for full-bleed preview:
 * intrinsic sizing, transparent bg, whole-node pick targets (not text glyphs).
 */

export type DiagramSvgKind = 'mermaid' | 'graphviz'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Layer groups Mermaid wraps around the whole graph
 * (`<g class="root"><g class="nodes">…`). They are never pick targets.
 */
const LAYER_CLASSES = new Set([
  'root',
  'nodes',
  'clusters',
  'edges',
  'edgePath',
  'edgePaths',
  'edgeLabels',
  'labels',
  'graph'
])

/** A node keeps its own identity even if the author gave it a colliding class. */
const NODE_CLASSES = ['node', 'rough-node', 'actor', 'mindmap-node']

function isLayerGroup(el: Element): boolean {
  if (NODE_CLASSES.some((c) => el.classList.contains(c))) return false
  return Array.from(el.classList).some((c) => LAYER_CLASSES.has(c))
}

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

/**
 * Give the SVG a real intrinsic pixel size taken from its viewBox.
 *
 * Mermaid ships `width="100%"` plus an inline `max-width`, and Graphviz uses
 * `pt` units. Both leave the browser resolving a percentage against a
 * shrink-to-fit canvas host — the diagram ended up at an arbitrary size, was
 * never measurable for fit-to-view, and non-integer scaling softened every
 * hairline. Baking the viewBox size into the width/height *attributes* gives it
 * a real intrinsic size and aspect ratio, so the canvas host box equals the
 * diagram box (exact centring) while flow layouts can still scale it down with
 * `max-width: 100%; height: auto`.
 */
export function normalizeDiagramSvgSize(svg: SVGSVGElement): void {
  let vb = svg.getAttribute('viewBox')
  if (!vb) {
    const w = parseFloat(svg.getAttribute('width') || '')
    const h = parseFloat(svg.getAttribute('height') || '')
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      vb = `0 0 ${w} ${h}`
      svg.setAttribute('viewBox', vb)
    }
  }
  const parts = (vb || '').split(/[\s,]+/).map(Number)
  const vw = parts[2]
  const vh = parts[3]
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || !vw || !vh) return

  svg.setAttribute('width', String(Math.ceil(vw)))
  svg.setAttribute('height', String(Math.ceil(vh)))
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  // Mermaid's inline max-width clamps the canvas below its own viewBox, and an
  // inline width/height would defeat responsive `height: auto` in flow layouts.
  svg.style.removeProperty('max-width')
  svg.style.removeProperty('max-height')
  svg.style.removeProperty('width')
  svg.style.removeProperty('height')
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
 * Readable label for a node.
 *
 * Mermaid puts HTML labels in `<foreignObject><span class="nodeLabel"><p>…`, so
 * a flat query over every text-bearing descendant counted the same words twice
 * ("Start here Start here"). Read one level per label container instead.
 */
function nodeLabelText(node: Element): string {
  const containers = Array.from(node.querySelectorAll('foreignObject'))
  const parts = containers.length
    ? containers.map((el) => {
        const paras = Array.from(el.querySelectorAll('p'))
        return paras.length
          ? paras.map((p) => p.textContent?.trim() ?? '').filter(Boolean).join(' ')
          : (el.textContent?.trim() ?? '')
      })
    : Array.from(node.querySelectorAll('text')).map((el) => el.textContent?.trim() ?? '')
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 200)
}

const NON_RENDERED = new Set(['title', 'desc', 'metadata'])

/** First child that actually paints — `<title>`/`<desc>` must stay in front. */
function firstPaintedChild(g: Element): Element | null {
  for (const child of Array.from(g.children)) {
    if (!NON_RENDERED.has(child.tagName.toLowerCase())) return child
  }
  return null
}

/** Collect node-ish groups, keeping the innermost match of each nest. */
function collectNodeGroups(svg: SVGSVGElement, kind: DiagramSvgKind): Element[] {
  let groups: Element[]
  if (kind === 'graphviz') {
    groups = Array.from(svg.querySelectorAll('g.node'))
  } else {
    // Mermaid: flowchart/state/class use g.node; sequence uses g.actor.
    groups = Array.from(
      svg.querySelectorAll(
        'g.node, g[class*="node"], g.actor, g.section, g.pieTitleText, g.mindmap-node, g.statediagram-state'
      )
    ).filter((g) => !isLayerGroup(g))
    if (groups.length === 0) {
      groups = Array.from(svg.querySelectorAll('g[id]')).filter((g) => {
        const id = g.getAttribute('id') || ''
        if (/^flowchart-|^state-|^class-|^actor|^pie-|^mindmap/i.test(id)) return true
        return !!g.querySelector('rect, polygon, circle, ellipse, path.basic')
      })
    }
  }
  /*
   * Keep the innermost candidates. The previous filter dropped any group that
   * was *contained by* another, which inverted the intent: Mermaid wraps every
   * node in `<g class="nodes">`, that wrapper matched `[class*="node"]`, and so
   * every real node was discarded — leaving one page-sized pick target. Hence
   * "can't select a node" plus a selection box around the whole graph.
   */
  return groups.filter((g) => !groups.some((other) => other !== g && g.contains(other)))
}

/**
 * Mark selectable node *groups* only. Clicks on labels bubble to the group.
 *
 * Each target gets two synthetic children **inside its own coordinate space**:
 * a transparent hit rect (so the whole node body is clickable, not just the
 * painted glyphs) and a selection outline rect. Keeping them inside the group
 * is what fixes the drifting highlight — `getBBox()` is expressed in the
 * group's local space, so appending the rect to the `<svg>` root ignored every
 * ancestor transform (Graphviz always has one, hence a wildly offset box).
 */
export function annotateDiagramPickTargets(root: HTMLElement, kind: DiagramSvgKind): void {
  const svg = root.querySelector('svg')
  if (!svg) return
  normalizeDiagramSvgSize(svg as SVGSVGElement)
  clearDiagramPaperBackground(svg as SVGSVGElement)

  // Clear previous annotation.
  root.querySelectorAll('.diagram-pick-target').forEach((el) => {
    el.classList.remove(
      'diagram-pick-target',
      'preview-select-region',
      'office-pick-target',
      'selected',
      'is-selected'
    )
    delete (el as HTMLElement).dataset.diagramId
    delete (el as HTMLElement).dataset.diagramLabel
    delete (el as HTMLElement).dataset.blockId
  })
  root
    .querySelectorAll('.diagram-select-overlay, .diagram-select-rect, .diagram-hit-rect')
    .forEach((el) => el.remove())

  const groups = collectNodeGroups(svg as SVGSVGElement, kind)

  groups.forEach((g, i) => {
    const he = g as HTMLElement
    let bb: DOMRect
    try {
      bb = (g as SVGGraphicsElement).getBBox()
    } catch {
      return
    }
    if (bb.width < 2 || bb.height < 2) return

    // Labels never own the pick — the whole node does. Mermaid renders labels in
    // <foreignObject>, so cover HTML content as well as SVG glyphs.
    he.querySelectorAll('text, tspan, title, foreignObject').forEach((el) => {
      ;(el as HTMLElement).style.pointerEvents = 'none'
    })

    he.classList.add('diagram-pick-target', 'preview-select-region', 'office-pick-target')
    const label = nodeLabelText(he) || he.getAttribute('id') || `node-${i}`
    // Stable id: keep explicit node ids; otherwise derive from content so
    // re-renders re-target the same node (mermaid regenerates ephemeral ids).
    const rawId = he.getAttribute('id') || `c${i}-${label.slice(0, 24).replace(/\s+/g, '_')}`
    he.dataset.diagramLabel = label
    he.dataset.diagramId = rawId
    he.dataset.blockId = `diag-${rawId}`

    // Behind the artwork: full-bbox hit area so gaps inside a node still pick.
    // Inline !important beats Mermaid's `.section-root rect { fill: … }` so the
    // hit plate never paints over the node's own shapes / label.
    const hit = document.createElementNS(SVG_NS, 'rect')
    hit.setAttribute('class', 'diagram-hit-rect')
    hit.setAttribute('x', String(bb.x))
    hit.setAttribute('y', String(bb.y))
    hit.setAttribute('width', String(bb.width))
    hit.setAttribute('height', String(bb.height))
    hit.style.setProperty('fill', 'transparent', 'important')
    hit.style.setProperty('stroke', 'none', 'important')
    hit.style.setProperty('pointer-events', 'all', 'important')
    // Behind the artwork but after <title>/<desc>, which must stay first to keep
    // working as the node's native tooltip (Graphviz emits one per node).
    g.insertBefore(hit, firstPaintedChild(g))

    // On top: hover / selected outline. Fill/stroke live in CSS with !important
    // (see index.css) so Mermaid's `.section-root rect { fill }` cannot paint
    // over the label — and so hover/selected rules can still win.
    const outline = document.createElementNS(SVG_NS, 'rect')
    outline.setAttribute('class', 'diagram-select-rect')
    outline.setAttribute('x', String(bb.x - 3))
    outline.setAttribute('y', String(bb.y - 3))
    outline.setAttribute('width', String(bb.width + 6))
    outline.setAttribute('height', String(bb.height + 6))
    outline.setAttribute('rx', '6')
    outline.setAttribute('ry', '6')
    outline.setAttribute('fill', 'none')
    outline.setAttribute('pointer-events', 'none')
    // Constant on-screen weight at any canvas zoom.
    outline.setAttribute('vector-effect', 'non-scaling-stroke')
    g.appendChild(outline)
  })
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
