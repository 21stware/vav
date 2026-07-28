/**
 * Selectable preview blocks shared by renderer canvas and main-process AST parse.
 */

export type PreviewBlockKind =
  | 'heading'
  | 'heading-section'
  | 'paragraph'
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
}

const TS_JS_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'])

export function isTsJsPath(path: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return TS_JS_EXTS.has(ext)
}
