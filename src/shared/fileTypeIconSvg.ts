/**
 * Document icon artwork for file associations, as plain SVG markup.
 *
 * One source for both surfaces: the renderer inlines it (`FileTypeIcon`) and
 * `scripts/generate-file-type-icons.mjs` rasterizes it into the .icns / .ico
 * Finder and Explorer show. Two layouts:
 *
 * - full (≥ 32px): white folded page, tinted pictogram, extension label band
 *   that overhangs the page so four or five letters stay legible.
 * - mini (< 32px): solid accent page with a heavy pictogram — at list-view
 *   sizes letters turn to noise, while hue + shape still read.
 */

export type FileTypeGlyph =
  | 'markdown'
  | 'text'
  | 'log'
  | 'globe'
  | 'code'
  | 'tags'
  | 'hash'
  | 'terminal'
  | 'braces'
  | 'tree'
  | 'table'
  | 'cells'
  | 'brackets'
  | 'sliders'
  | 'query'
  | 'database'
  | 'columns'
  | 'image'
  | 'pen'
  | 'music'
  | 'play'
  | 'book'
  | 'pilcrow'
  | 'grid'
  | 'slides'
  | 'package'
  | 'vav'

export interface FileTypeIconArt {
  glyph: FileTypeGlyph
  color: string
  ink?: string
  badge?: string
}

/** Stroke pictograms on a 24-unit box (Lucide-compatible geometry). */
const GLYPHS: Record<FileTypeGlyph, string> = {
  markdown: '<path d="M3 17V7l4.5 5L12 7v10"/><path d="M18 7v10m-3.5-3.5L18 17l3.5-3.5"/>',
  text: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>',
  log: '<path d="M4 6h.01M4 12h.01M4 18h.01M9 6h11M9 12h11M9 18h7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5M13.5 4l-3 16"/>',
  tags: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M9.5 12h.01M12 12h.01M14.5 12h.01"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  terminal: '<path d="m4 17 6-5-6-5m8 12h8"/>',
  braces:
    '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1m8-18h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  tree: '<path d="M21 6H8m13 6h-8m8 6h-8M3 6v4a2 2 0 0 0 2 2h3m-5-2v6a2 2 0 0 0 2 2h3"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>',
  cells: '<rect x="3" y="3" width="18" height="7.5" rx="2"/><rect x="3" y="13.5" width="18" height="7.5" rx="2"/><path d="M7 6.75h6M7 17.25h9"/>',
  brackets: '<path d="M8 3H5v18h3m8-18h3v18h-3M9.5 12h5"/>',
  sliders: '<path d="M21 5h-7m-4 0H3m18 7h-9m-4 0H3m18 7h-5m-4 0H3M14 3v4m-6 3v4m8 3v4"/>',
  query: '<path d="M3 5h14M3 10h8M3 15h5"/><circle cx="15.5" cy="15.5" r="4"/><path d="m21 21-2.6-2.6"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13a8 3 0 0 0 16 0v-13M4 12a8 3 0 0 0 16 0"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m6-18v18"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  pen:
    '<path d="M15.7 21.3a1 1 0 0 1-1.4 0l-1.6-1.6a1 1 0 0 1 0-1.4l5.6-5.6a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4z"/><path d="m18 13-1.4-6.9a1 1 0 0 0-.7-.8L3.2 2a1 1 0 0 0-1.2 1.2l3.3 12.7a1 1 0 0 0 .8.7L13 18M2.3 2.3l7.3 7.3"/><circle cx="11" cy="11" r="2"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z" fill="currentColor"/>',
  book: '<path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  pilcrow: '<path d="M13 4v16m4-16v16m2-16H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18m6-18v18"/>',
  slides: '<path d="M2 3h20m-1 0v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3m4 18 5-5 5 5"/>',
  package:
    '<path d="M11 21.7a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7zM12 22V12"/><path d="m3.3 7 7.7 4.7a2 2 0 0 0 2 0L20.7 7M7.5 4.3l9 5.1"/>',
  vav: '<path d="M6.3 10.6 8.2 4.4l2.5 4.3m2.6 0 2.5-4.3 1.9 6.2"/><circle cx="11" cy="14.2" r="4.3"/><path d="M15.3 10v6.4c0 1.3.8 2.1 2 2.1M1.5 11.5l3.3.9m-3.6 2h3.4m-3.1 2.9 3.3-.9m17.7-4.9-3.3.9m3.6 2h-3.4m3.1 2.9-3.3-.9"/>'
}

const FULL_PAGE = 'M8.5 2H20l6 6v19.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 6 27.5v-23A2.5 2.5 0 0 1 8.5 2z'
const FULL_FOLD = 'M20 2v4.5A1.5 1.5 0 0 0 21.5 8H26z'
const MINI_PAGE = 'M7.5 1.5h13l6.5 6.5v20a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 5 28V4a2.5 2.5 0 0 1 2.5-2.5z'
const MINI_FOLD = 'M20.5 1.5V6a2 2 0 0 0 2 2H27z'

const LABEL_FONT = "'SF Pro Display','SF Pro Text',-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif"

function glyph(name: FileTypeGlyph, cx: number, cy: number, box: number, color: string, stroke: number): string {
  const s = box / 24
  const x = cx - box / 2
  const y = cy - box / 2
  return (
    `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s)})" color="${color}" fill="none" stroke="${color}" ` +
    `stroke-width="${r(stroke)}" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`
  )
}

/** Blend `hex` toward black; keeps light accents (yellow) readable on the white page. */
function shade(hex: string, amount: number): string {
  const v = hex.replace('#', '')
  const channel = (i: number): string =>
    Math.round(parseInt(v.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(0)}${channel(2)}${channel(4)}`
}

function r(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}

function labelFontSize(badge: string): number {
  if (badge.length <= 2) return 5.6
  if (badge.length === 3) return 5.2
  if (badge.length === 4) return 4.6
  return 3.9
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * SVG markup for one document icon at `size` px (viewBox is always 32).
 * `standalone` adds the soft drop shadow + page shading used for OS assets;
 * inline copies skip it so repeated `id`s never collide in the DOM.
 */
export function fileTypeIconSvg(
  art: FileTypeIconArt,
  size: number,
  opts: { standalone?: boolean } = {}
): string {
  const ink = art.ink ?? '#FFFFFF'
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">`

  if (size < 32) {
    return (
      head +
      `<path d="${MINI_PAGE}" fill="${art.color}"/>` +
      `<path d="${MINI_FOLD}" fill="${ink}" fill-opacity="0.42"/>` +
      glyph(art.glyph, 16, 17.25, 16, ink, size <= 16 ? 3 : 2.6) +
      '</svg>'
    )
  }

  const borderPx = Math.min(4, Math.max(0.6, size / 256))
  const border = (borderPx * 32) / size
  const glyphStroke = (size <= 32 ? 2.4 : size <= 64 ? 2.2 : 2) * (art.glyph === 'vav' ? 0.8 : 1)
  const glyphColor = art.ink ? shade(art.color, 0.42) : art.color
  const standalone = opts.standalone === true
  const defs = standalone
    ? '<defs>' +
      '<filter id="ds" x="-30%" y="-20%" width="160%" height="150%">' +
      '<feGaussianBlur in="SourceAlpha" stdDeviation="0.55"/><feOffset dy="0.45" result="b"/>' +
      '<feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>' +
      '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '<linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F1F1F4"/></linearGradient>' +
      '</defs>'
    : ''
  const pageFill = standalone ? 'url(#pg)' : '#FFFFFF'

  let body =
    `<path d="${FULL_PAGE}" fill="${pageFill}" stroke="#000" stroke-opacity="0.16" stroke-width="${r(border)}"/>` +
    `<path d="${FULL_FOLD}" fill="${art.color}" fill-opacity="0.3" stroke="#000" stroke-opacity="0.12" ` +
    `stroke-width="${r(border)}" stroke-linejoin="round"/>`

  const badge = art.badge?.trim()
  if (badge) {
    // At 32px the label carries the icon: taller band, bigger type, smaller pictogram.
    const compact = size <= 32
    const band = compact ? { y: 17.5, h: 9.5 } : { y: 20, h: 7 }
    const fontSize = labelFontSize(badge) * (compact ? 1.3 : 1)
    const midY = band.y + band.h / 2
    body +=
      (compact
        ? glyph(art.glyph, 16, 10.5, 8.5, glyphColor, 2.8)
        : glyph(art.glyph, 16, 12.75, 11, glyphColor, glyphStroke)) +
      `<rect x="3.25" y="${band.y}" width="25.5" height="${band.h}" rx="1.75" fill="${art.color}"/>` +
      `<text x="16" y="${r(midY + fontSize * 0.36)}" text-anchor="middle" fill="${ink}" font-family="${LABEL_FONT}" ` +
      `font-size="${r(fontSize)}" font-weight="700" letter-spacing="${badge.length >= 5 ? 0 : 0.2}">` +
      `${escapeText(badge)}</text>`
  } else {
    body += glyph(art.glyph, 16, 17, 15, glyphColor, glyphStroke)
  }

  return head + defs + (standalone ? `<g filter="url(#ds)">${body}</g>` : body) + '</svg>'
}
