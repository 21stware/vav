/**
 * Lightweight draw.io / diagrams.net mxfile reader (uncompressed cells).
 * Read-only model for canvas pick + agent context — no write-back.
 */

export interface DrawioCell {
  id: string
  /** Display label (decoded HTML entities, tags stripped). */
  label: string
  valueRaw: string
  style: string
  parent?: string
  vertex: boolean
  edge: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  source?: string
  target?: string
}

export interface DrawioDoc {
  cells: DrawioCell[]
  /** True when file used compressed diagrams we could not expand. */
  compressedSkipped: boolean
  warning?: string
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
}

function stripHtml(s: string): string {
  return decodeEntities(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const m = tag.match(re)
  if (!m) return null
  return decodeEntities(m[2] ?? m[3] ?? '')
}

function parseGeometry(tag: string): Pick<DrawioCell, 'x' | 'y' | 'width' | 'height'> {
  // Prefer nested mxGeometry in surrounding slice — handled by caller passing full block.
  const x = attr(tag, 'x')
  const y = attr(tag, 'y')
  const w = attr(tag, 'width')
  const h = attr(tag, 'height')
  return {
    x: x != null ? Number(x) : undefined,
    y: y != null ? Number(y) : undefined,
    width: w != null ? Number(w) : undefined,
    height: h != null ? Number(h) : undefined
  }
}

/** Parse uncompressed mxGraphModel cells from mxfile / plain mxGraphModel XML. */
export function parseDrawioXml(xml: string): DrawioDoc {
  const compressedSkipped = /compressed\s*=\s*["']1["']/i.test(xml) || /compressed\s*=\s*["']true["']/i.test(xml)
  const cells: DrawioCell[] = []
  // Match mxCell open tags; geometry may be nested until </mxCell> or self-close.
  const cellRe = /<mxCell\b([^>]*)(\/>|>)/gi
  let m: RegExpExecArray | null
  while ((m = cellRe.exec(xml))) {
    const head = m[0]
    const attrs = m[1] ?? ''
    const selfClose = m[2] === '/>' || /\/>$/.test(head)
    let block = head
    if (!selfClose) {
      const end = xml.indexOf('</mxCell>', m.index)
      if (end !== -1) {
        block = xml.slice(m.index, end + '</mxCell>'.length)
        cellRe.lastIndex = end + '</mxCell>'.length
      }
    }
    const id = attr(attrs, 'id') ?? attr(block, 'id')
    if (!id || id === '0' || id === '1') continue // root scaffolding
    const valueRaw = attr(attrs, 'value') ?? attr(block, 'value') ?? ''
    const style = attr(attrs, 'style') ?? attr(block, 'style') ?? ''
    const parent = attr(attrs, 'parent') ?? attr(block, 'parent') ?? undefined
    const vertex = /\bvertex\s*=\s*["']1["']/.test(attrs) || /\bvertex\s*=\s*["']1["']/.test(block)
    const edge = /\bedge\s*=\s*["']1["']/.test(attrs) || /\bedge\s*=\s*["']1["']/.test(block)
    const source = attr(attrs, 'source') ?? attr(block, 'source') ?? undefined
    const target = attr(attrs, 'target') ?? attr(block, 'target') ?? undefined
    const geoTag = block.match(/<mxGeometry\b[^/]*\/?>/i)?.[0] ?? block
    const geo = parseGeometry(geoTag)
    const label = stripHtml(valueRaw)
    // Keep labeled vertices and edges; skip empty style-only helpers unless vertex with size.
    if (!label && !vertex && !edge) continue
    if (!label && edge) continue
    cells.push({
      id,
      label: label || (edge ? 'edge' : `cell ${id}`),
      valueRaw,
      style,
      parent,
      vertex: vertex || (!edge && geo.width != null),
      edge,
      ...geo,
      source,
      target
    })
  }

  return {
    cells,
    compressedSkipped: compressedSkipped && cells.length === 0,
    warning:
      compressedSkipped && cells.length === 0
        ? 'This draw.io file uses compressed diagrams. Re-save uncompressed in diagrams.net for in-app preview, or open as text.'
        : undefined
  }
}

export function drawioVertices(doc: DrawioDoc): DrawioCell[] {
  return doc.cells.filter((c) => c.vertex && !c.edge)
}
