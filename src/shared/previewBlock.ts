/**
 * Selectable preview blocks shared by renderer canvas and main-process AST parse.
 */

export type PreviewBlockKind =
  | 'heading'
  | 'heading-section'
  | 'paragraph'
  /** Single log/source line (line-oriented canvas pick). */
  | 'line'
  | 'code'
  | 'list'
  | 'list-item'
  | 'frontmatter'
  | 'cell'
  | 'cell-input'
  | 'cell-output'
  | 'type'
  | 'func'
  | 'control'
  | 'stmt'
  | 'object'
  | 'kv'
  | 'array-item'
  | 'row'
  | 'col'
  | 'table'
  | 'cell-table'
  /** Structured office / PDF containers. */
  | 'page'
  | 'slide'
  | 'sheet'
  | 'section'
  /** Embedded picture / media surface (e.g. PPTX image frame). */
  | 'image'

export type PreviewBlockAlign = 'left' | 'center' | 'right' | 'justify'

/**
 * Presentation hint for structured docs (DOCX cover pages, form rows, …).
 * Parsers set this; canvas may also re-derive from text + align.
 */
export type PreviewBlockDisplay = 'title' | 'subtitle' | 'form' | 'body'

export interface PreviewBlock {
  id: string
  kind: PreviewBlockKind
  text: string
  language?: string
  level?: number
  startLine: number
  endLine: number
  label?: string
  children?: PreviewBlock[]
  /** Paragraph alignment from OOXML w:jc (DOCX) or equivalent. */
  align?: PreviewBlockAlign
  /** How the structured canvas should lay this block out. */
  display?: PreviewBlockDisplay
  /** Form rows: label cell (e.g. "专  业") when split from underlines / tabs. */
  formLabel?: string
  /** Form rows: value / blank underlines. */
  formValue?: string
}

const TS_JS_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'])

export function isTsJsPath(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return TS_JS_EXTS.has(ext)
}
