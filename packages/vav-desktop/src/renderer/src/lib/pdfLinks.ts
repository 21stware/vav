/** PDF.js Link annotation (subset we actually follow). */
export type PdfLinkAnnot = {
  subtype?: string
  annotationType?: number
  rect?: number[]
  url?: string
  unsafeUrl?: string
  dest?: unknown
  action?: string
  newWindow?: boolean
}

export type PdfNamedAction = 'NextPage' | 'PrevPage' | 'FirstPage' | 'LastPage'

export type PdfLinkTarget =
  | { kind: 'uri'; url: string }
  | { kind: 'dest'; dest: unknown }
  | { kind: 'named'; action: PdfNamedAction }

export type PdfViewportLike = {
  convertToViewportRectangle?: (rect: number[]) => number[]
  convertToViewportPoint?: (x: number, y: number) => number[]
}

/** pdf.js AnnotationType.LINK */
const PDF_ANNOT_LINK = 2

export function isPdfLinkAnnotation(annot: PdfLinkAnnot | null | undefined): boolean {
  if (!annot) return false
  return annot.subtype === 'Link' || annot.annotationType === PDF_ANNOT_LINK
}

/** Safe http(s) only — never javascript: or relative file traps. */
export function safePdfExternalUrl(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

const NAMED_ACTIONS = new Set<PdfNamedAction>(['NextPage', 'PrevPage', 'FirstPage', 'LastPage'])

export function namedPdfAction(raw: string | null | undefined): PdfNamedAction | null {
  const name = (raw ?? '').trim()
  return NAMED_ACTIONS.has(name as PdfNamedAction) ? (name as PdfNamedAction) : null
}

export function pdfLinkTarget(annot: PdfLinkAnnot): PdfLinkTarget | null {
  if (!isPdfLinkAnnotation(annot)) return null
  const url = safePdfExternalUrl(annot.url) ?? safePdfExternalUrl(annot.unsafeUrl)
  if (url) return { kind: 'uri', url }
  if (annot.dest != null && annot.dest !== '') return { kind: 'dest', dest: annot.dest }
  const action = namedPdfAction(annot.action)
  if (action) return { kind: 'named', action }
  return null
}

/** Map a PDF user-space rect through the page viewport (handles Y-flip / rotation). */
export function convertPdfRectToViewport(
  rect: number[],
  viewport: PdfViewportLike
): number[] | null {
  try {
    if (typeof viewport.convertToViewportRectangle === 'function') {
      const box = viewport.convertToViewportRectangle(rect)
      return box.length >= 4 ? box : null
    }
    if (typeof viewport.convertToViewportPoint === 'function') {
      const a = viewport.convertToViewportPoint(rect[0]!, rect[1]!)
      const b = viewport.convertToViewportPoint(rect[2]!, rect[3]!)
      if (!a || a.length < 2 || !b || b.length < 2) return null
      return [a[0]!, a[1]!, b[0]!, b[1]!]
    }
  } catch {
    return null
  }
  return null
}

export function pdfLinkRectCss(
  rect: number[] | undefined,
  convert: ((r: number[]) => number[]) | PdfViewportLike
): { left: number; top: number; width: number; height: number } | null {
  if (!rect || rect.length < 4) return null
  let box: number[] | null
  try {
    box = typeof convert === 'function' ? convert(rect) : convertPdfRectToViewport(rect, convert)
  } catch {
    return null
  }
  if (!box || box.length < 4) return null
  const left = Math.min(box[0]!, box[2]!)
  const top = Math.min(box[1]!, box[3]!)
  const width = Math.abs(box[2]! - box[0]!)
  const height = Math.abs(box[3]! - box[1]!)
  if (!(width > 1) || !(height > 1)) return null
  return { left, top, width, height }
}

/**
 * Resolve a PDF dest (name or explicit array) to a 1-based page number.
 */
export async function resolvePdfDestPage(
  dest: unknown,
  api: {
    getDestination: (name: string) => Promise<unknown>
    getPageIndex: (ref: never) => Promise<number>
  }
): Promise<number | null> {
  let explicit: unknown = dest
  if (typeof dest === 'string') {
    try {
      explicit = await api.getDestination(dest)
    } catch {
      return null
    }
  }
  if (!Array.isArray(explicit) || explicit.length === 0) return null
  const ref = explicit[0]
  if (typeof ref === 'number' && Number.isFinite(ref)) {
    return Math.max(1, Math.floor(ref) + 1)
  }
  try {
    const index = await api.getPageIndex(ref as never)
    if (!Number.isFinite(index) || index < 0) return null
    return index + 1
  } catch {
    return null
  }
}
