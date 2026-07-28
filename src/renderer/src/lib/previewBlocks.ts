/**
 * Hierarchical selectable blocks for file-preview.rpml (release c945830a…).
 *
 * Default click = primary granularity (e.g. L2 function / L2 paragraph).
 * Double-click a selected block drills into children (L3+); Esc pops out.
 *
 * TS/JS AST parsing runs in the main process (see files.parseBlocks); this
 * module keeps sync parsers + hit-test helpers for the renderer canvas.
 */
export type { PreviewBlock, PreviewBlockKind } from '@shared/previewBlock'
export { isTsJsPath } from '@shared/previewBlock'
import type { PreviewBlock } from '@shared/previewBlock'

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'block'
}

function sliceLines(lines: string[], start: number, end: number): string {
  return lines.slice(start, end).join('\n')
}

/** Markdown → L2 defaults; heading sections available as children of headings. */
export function parseMarkdownBlocks(source: string): PreviewBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: PreviewBlock[] = []
  let i = 0

  if (lines[0]?.trim() === '---') {
    let end = 1
    while (end < lines.length && lines[end]?.trim() !== '---') end++
    if (end < lines.length) {
      blocks.push({
        id: `frontmatter-0`,
        kind: 'frontmatter',
        text: sliceLines(lines, 0, end + 1),
        label: `YAML frontmatter · lines 1–${end + 1}`,
        startLine: 1,
        endLine: end + 1
      })
      i = end + 1
    }
  }

  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === '') i++
    if (i >= lines.length) break

    const start = i
    const line = lines[i]!

    const fence = line.match(/^(`{3,}|~{3,})(.*)$/)
    if (fence) {
      const marker = fence[1]!
      const language = (fence[2] || '').trim() || undefined
      i++
      while (i < lines.length && !lines[i]!.startsWith(marker)) i++
      if (i < lines.length) i++
      blocks.push({
        id: `codeblock-L${start + 1}`,
        kind: 'code',
        text: sliceLines(lines, start, i),
        language,
        label: language ? `${language} · lines ${start + 1}–${i}` : `code · lines ${start + 1}–${i}`,
        startLine: start + 1,
        endLine: i
      })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1]!.length
      const title = heading[2]!.trim()
      const headingId = `h${level}-${slug(title)}`
      i++
      const sectionStart = start
      while (i < lines.length) {
        const next = lines[i]!.match(/^(#{1,6})\s+/)
        if (next && next[1]!.length <= level) break
        i++
      }
      const sectionText = sliceLines(lines, sectionStart, i)
      const headingOnly: PreviewBlock = {
        id: headingId,
        kind: 'heading',
        text: line,
        level,
        label: `H${level} ${title}`,
        startLine: start + 1,
        endLine: start + 1
      }
      // Default selectable unit for a heading click = heading line.
      // Children: full section (via double-click drill) + inner L2/L3 blocks.
      const inner = parseMarkdownBlocks(sliceLines(lines, start + 1, i)).map((b) => ({
        ...b,
        startLine: b.startLine + start + 1,
        endLine: b.endLine + start + 1
      }))
      const section: PreviewBlock = {
        id: `h${level}-section-${slug(title)}`,
        kind: 'heading-section',
        text: sectionText,
        level,
        label: `H${level} section · ${title}`,
        startLine: start + 1,
        endLine: i,
        children: inner.length ? inner : undefined
      }
      blocks.push({
        ...headingOnly,
        children: [section, ...(inner.length ? inner : [])]
      })
      continue
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const listStart = i
      i++
      while (
        i < lines.length &&
        (lines[i]!.trim() === '' ||
          /^\s*([-*+]|\d+\.)\s+/.test(lines[i]!) ||
          /^\s{2,}\S/.test(lines[i]!))
      ) {
        if (
          lines[i]!.trim() === '' &&
          i + 1 < lines.length &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[i + 1]!)
        ) {
          break
        }
        i++
      }
      const itemLines: { start: number; end: number; text: string }[] = []
      let j = listStart
      while (j < i) {
        if (/^\s*([-*+]|\d+\.)\s+/.test(lines[j]!)) {
          const itemStart = j
          j++
          while (
            j < i &&
            lines[j]!.trim() !== '' &&
            !/^\s*([-*+]|\d+\.)\s+/.test(lines[j]!)
          ) {
            j++
          }
          itemLines.push({
            start: itemStart,
            end: j,
            text: sliceLines(lines, itemStart, j)
          })
        } else {
          j++
        }
      }
      const listIdx = blocks.filter((b) => b.kind === 'list').length
      blocks.push({
        id: `list-${listIdx}`,
        kind: 'list',
        text: sliceLines(lines, listStart, i),
        label: `list · ${itemLines.length} items`,
        startLine: listStart + 1,
        endLine: i,
        children: itemLines.map((item, sub) => ({
          id: `li-${listIdx}-${sub}`,
          kind: 'list-item' as const,
          text: item.text,
          startLine: item.start + 1,
          endLine: item.end,
          label: `li ${sub + 1}`
        }))
      })
      continue
    }

    i++
    while (i < lines.length && lines[i]!.trim() !== '') {
      if (/^#{1,6}\s+/.test(lines[i]!) || /^(`{3,}|~{3,})/.test(lines[i]!)) break
      if (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)) break
      i++
    }
    blocks.push({
      id: `para-L${start + 1}`,
      kind: 'paragraph',
      text: sliceLines(lines, start, i),
      startLine: start + 1,
      endLine: i,
      label: `paragraph · lines ${start + 1}–${i}`
    })
  }

  return blocks
}

/** Plain text → L2 paragraphs; drill-in exposes L3 lines. */
export function parseTextBlocks(source: string): PreviewBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: PreviewBlock[] = []
  let i = 0
  let index = 0
  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === '') i++
    if (i >= lines.length) break
    const start = i
    while (i < lines.length && lines[i]!.trim() !== '') i++
    const text = sliceLines(lines, start, i)
    const lineChildren: PreviewBlock[] = []
    for (let row = start; row < i; row++) {
      lineChildren.push({
        id: `stmt-L${row + 1}`,
        kind: 'stmt',
        text: lines[row]!,
        startLine: row + 1,
        endLine: row + 1,
        label: `line ${row + 1}`
      })
    }
    blocks.push({
      id: `para-${index++}`,
      kind: 'paragraph',
      text,
      startLine: start + 1,
      endLine: i,
      label: `paragraph · lines ${start + 1}–${i}`,
      children: lineChildren.length > 1 ? lineChildren : undefined
    })
  }
  return blocks
}

/** Notebook → L1 cells; drill-in → input / output. */
export function parseNotebookBlocks(source: string): PreviewBlock[] {
  try {
    const nb = JSON.parse(source) as {
      cells?: {
        cell_type?: string
        source?: string | string[]
        outputs?: unknown[]
        execution_count?: number | null
      }[]
    }
    const cells = nb.cells ?? []
    return cells.map((cell, index) => {
      const raw = Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')
      const isMd = cell.cell_type === 'markdown'
      const children: PreviewBlock[] = [
        {
          id: `cell-${index}-input`,
          kind: 'cell-input',
          text: raw,
          language: isMd ? undefined : 'python',
          startLine: index + 1,
          endLine: index + 1,
          label: `cell ${index} input`
        }
      ]
      if (!isMd && cell.outputs && cell.outputs.length > 0) {
        children.push({
          id: `cell-${index}-output`,
          kind: 'cell-output',
          text: JSON.stringify(cell.outputs, null, 2),
          startLine: index + 1,
          endLine: index + 1,
          label: `cell ${index} output`
        })
      }
      return {
        id: `cell-${index}`,
        kind: 'cell' as const,
        text: raw,
        language: isMd ? undefined : 'python',
        startLine: index + 1,
        endLine: index + 1,
        label:
          cell.execution_count != null ? `In [${cell.execution_count}]` : `cell ${index}`,
        children
      }
    })
  } catch {
    return parseTextBlocks(source)
  }
}

const TYPE_RE =
  /^(export\s+)?(default\s+)?(abstract\s+)?(class|interface|struct|enum|type|extension|actor|protocol|namespace|module)\s+([A-Za-z_][\w]*)/
/** Modifiers + classic function / method / arrow forms (non-TS heuristic path). */
const FUNC_RE =
  /^(?:(?:export|default|public|private|protected|internal|open|override|static|async|mutating|nonmutating|required|convenience|final|fileprivate|package|open)\s+)*(?:(?:function\*?|func|fn|def|fun)\s+([A-Za-z_][\w]*)|(?:get|set)\s+([A-Za-z_][\w]*)|([A-Za-z_][\w]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?:(?::\s*[^{]+)|(?:->\s*[^{]+))?\s*\{|(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?(?:\(|[A-Za-z_][\w]*\s*=>)|([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/
const CONTROL_RE =
  /^\s*(if|else\s+if|else|for|while|switch|match|try|catch|except|finally|guard|defer|do)\b/

function funcNameFromMatch(match: RegExpMatchArray): string {
  return match[1] || match[2] || match[3] || match[4] || match[5] || 'anonymous'
}

function findMatchingBrace(lines: string[], openLine: number): number {
  let depth = 0
  let seen = false
  for (let i = openLine; i < lines.length; i++) {
    const line = lines[i]!
    for (const ch of line) {
      if (ch === '{') {
        depth++
        seen = true
      } else if (ch === '}') {
        depth--
        if (seen && depth === 0) return i
      }
    }
  }
  return openLine
}

function parseControlBlocks(lines: string[], from: number, to: number): PreviewBlock[] {
  const out: PreviewBlock[] = []
  let i = from
  while (i < to) {
    const line = lines[i]!
    if (CONTROL_RE.test(line) && line.includes('{')) {
      const end = findMatchingBrace(lines, i)
      const kind = (line.match(CONTROL_RE)?.[1] || 'block').replace(/\s+/g, '-')
      const stmts: PreviewBlock[] = []
      for (let row = i + 1; row < end; row++) {
        if (lines[row]!.trim() && !CONTROL_RE.test(lines[row]!)) {
          stmts.push({
            id: `stmt-L${row + 1}`,
            kind: 'stmt',
            text: lines[row]!,
            startLine: row + 1,
            endLine: row + 1,
            label: `line ${row + 1}`
          })
        }
      }
      out.push({
        id: `block-${kind}-L${i + 1}`,
        kind: 'control',
        text: sliceLines(lines, i, end + 1),
        startLine: i + 1,
        endLine: end + 1,
        label: `${kind} · lines ${i + 1}–${end + 1}`,
        children: stmts.length ? stmts : undefined
      })
      i = end + 1
      continue
    }
    i++
  }
  return out
}

/**
 * Source code → L2 functions (default). Types are L1 siblings.
 * Drill-in on a function exposes L3 control-flow (then L4 stmts).
 */
export function parseCodeBlocks(source: string, language?: string): PreviewBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: PreviewBlock[] = []
  let i = 0

  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === '') i++
    if (i >= lines.length) break
    const line = lines[i]!
    const trimmed = line.trim()

    const typeMatch = trimmed.match(TYPE_RE)
    if (typeMatch && (line.includes('{') || lines[i + 1]?.includes('{'))) {
      const name = typeMatch[5]!
      const open = line.includes('{') ? i : i + 1
      const end = findMatchingBrace(lines, open)
      const innerFuncs = parseCodeBlocks(sliceLines(lines, i + 1, end), language).map((b) => ({
        ...b,
        startLine: b.startLine + i + 1,
        endLine: b.endLine + i + 1
      }))
      blocks.push({
        id: `type-${name}`,
        kind: 'type',
        text: sliceLines(lines, i, end + 1),
        language,
        label: `${typeMatch[4]} ${name}`,
        startLine: i + 1,
        endLine: end + 1,
        children: innerFuncs.length ? innerFuncs : parseControlBlocks(lines, i + 1, end)
      })
      i = end + 1
      continue
    }

    const funcMatch = trimmed.match(FUNC_RE)
    if (funcMatch) {
      const name = funcNameFromMatch(funcMatch)
      let open = i
      if (!line.includes('{')) {
        let j = i
        while (j < lines.length && !lines[j]!.includes('{')) j++
        open = j < lines.length ? j : i
      }
      const end = line.includes('{') || open !== i ? findMatchingBrace(lines, open) : i
      // Python / indent-based: extend until dedent
      let endLine = end
      if (!line.includes('{') && open === i && /:\s*$/.test(trimmed)) {
        const indent = line.match(/^\s*/)?.[0].length ?? 0
        endLine = i
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j]!.trim() === '') {
            endLine = j
            continue
          }
          const ind = lines[j]!.match(/^\s*/)?.[0].length ?? 0
          if (ind <= indent) break
          endLine = j
        }
      }
      const controls = parseControlBlocks(lines, i + 1, endLine)
      blocks.push({
        id: `func-${name}`,
        kind: 'func',
        text: sliceLines(lines, i, endLine + 1),
        language,
        label: `func ${name} · lines ${i + 1}–${endLine + 1}`,
        startLine: i + 1,
        endLine: endLine + 1,
        children: controls.length ? controls : undefined
      })
      i = endLine + 1
      continue
    }

    // Skip unmatched lines (imports, comments) as loose paragraphs only if long run
    const start = i
    i++
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !TYPE_RE.test(lines[i]!.trim()) &&
      !FUNC_RE.test(lines[i]!.trim())
    ) {
      i++
    }
    if (i - start >= 1) {
      const text = sliceLines(lines, start, i)
      // Don't create noise blocks for tiny import runs — group as paragraph
      if (text.trim()) {
        blocks.push({
          id: `para-L${start + 1}`,
          kind: 'paragraph',
          text,
          language,
          startLine: start + 1,
          endLine: i,
          label: `lines ${start + 1}–${i}`
        })
      }
    }
  }

  // Fallback: whole file as one block if nothing matched
  if (blocks.length === 0 && source.trim()) {
    return parseTextBlocks(source)
  }
  return blocks
}

/**
 * Indent-based block parser — DevTools-style element selection for code.
 *
 * Every non-blank line at the current scope's minimum indent is a block head;
 * it owns all following lines indented deeper (blank lines never break a
 * block). Recurses so every indent level is independently selectable: hover a
 * line highlights the innermost block containing it, Esc pops out to the
 * enclosing indent level.
 */
export function parseIndentBlocks(source: string, language?: string): PreviewBlock[] {
  const lines = source.split(/\r?\n/)
  return parseIndentRange(lines, 0, lines.length, language, 0)
}

function indentOf(line: string): number {
  const m = line.match(/^[ \t]*/)
  if (!m) return 0
  let n = 0
  for (const ch of m[0]!) n += ch === '\t' ? 4 : 1
  return n
}

/** A line that is purely a closing delimiter (}, ], )) — belongs to the preceding block, not a new one. */
function isClosingLine(line: string): boolean {
  const trimmed = line.trim()
  if (!/^[}\])]/.test(trimmed)) return false
  // Reject lines that also open a new scope, e.g. `} else {` or `} while (x);`
  return !/[{\([]/.test(trimmed)
}

function parseIndentRange(
  lines: string[],
  from: number,
  to: number,
  language: string | undefined,
  depth: number
): PreviewBlock[] {
  let minIndent = Infinity
  for (let i = from; i < to; i++) {
    if (lines[i]!.trim() === '') continue
    minIndent = Math.min(minIndent, indentOf(lines[i]!))
  }
  if (minIndent === Infinity) return []

  const blocks: PreviewBlock[] = []
  let i = from
  while (i < to) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    const ind = indentOf(line)
    if (ind < minIndent) break
    if (ind > minIndent) {
      // Dangling deeper line with no head at this level — skip (rare in real code).
      i++
      continue
    }

    const headStart = i
    i++
    let closedWithBrace = false
    while (i < to) {
      const l = lines[i]!
      if (l.trim() === '') {
        i++
        continue
      }
      const li = indentOf(l)
      if (li <= minIndent) {
        // Closing brace at the block's own indent belongs to this block.
        if (li === minIndent && isClosingLine(l)) {
          i++
          closedWithBrace = true
        }
        break
      }
      i++
    }
    let blockEnd = i
    while (blockEnd > headStart + 1 && lines[blockEnd - 1]!.trim() === '') blockEnd--
    // The absorbed closing line is part of this block, not its children —
    // exclude it from the children range so it can't drag down minIndent.
    const childEnd = closedWithBrace ? blockEnd - 1 : blockEnd
    const children = parseIndentRange(lines, headStart + 1, childEnd, language, depth + 1)
    const headText = lines[headStart]!.trim()
    const range =
      blockEnd > headStart + 1 ? `L${headStart + 1}–${blockEnd}` : `L${headStart + 1}`
    blocks.push({
      id: `indent-d${depth}-L${headStart + 1}`,
      kind: 'paragraph',
      text: sliceLines(lines, headStart, blockEnd),
      language,
      startLine: headStart + 1,
      endLine: blockEnd,
      label: `${range} · ${headText.slice(0, 60)}`,
      children: children.length ? children : undefined
    })
  }
  return blocks
}

export interface CsvSelectionModel {
  headers: string[]
  rows: string[][]
  /** Default L2 blocks: columns + rows (table is parent). */
  blocks: PreviewBlock[]
}

export function csvColId(name: string, col: number): string {
  return `col-${slug(name) || String(col)}`
}

/** Serialize a CSV model back to text (quotes fields that need it). */
export function serializeCsv(headers: string[], rows: string[][]): string {
  const escape = (cell: string): string => {
    if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`
    return cell
  }
  const lines = [headers, ...rows].map((row) => row.map(escape).join(','))
  return `${lines.join('\n')}\n`
}

/** Replace one notebook cell's source; returns updated `.ipynb` JSON text. */
export function updateNotebookCellSource(
  source: string,
  cellIndex: number,
  nextSource: string
): string | null {
  try {
    const nb = JSON.parse(source) as {
      cells?: { source?: string | string[]; [key: string]: unknown }[]
      [key: string]: unknown
    }
    const cell = nb.cells?.[cellIndex]
    if (!cell) return null
    if (Array.isArray(cell.source)) {
      const parts = nextSource.match(/[^\n]*\n|[^\n]+/g)
      cell.source = parts && parts.length > 0 ? parts : ['']
    } else {
      cell.source = nextSource
    }
    return `${JSON.stringify(nb, null, 1)}\n`
  } catch {
    return null
  }
}

export function parseCsvModel(text: string): CsvSelectionModel {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(parseCsvLine)
  if (rows.length === 0) return { headers: [], rows: [], blocks: [] }
  const [header, ...body] = rows
  const headers = header
  const tableText = text
  const colBlocks: PreviewBlock[] = headers.map((name, col) => ({
    id: csvColId(name, col),
    kind: 'col' as const,
    text: [name, ...body.map((r) => r[col] ?? '')].join('\n'),
    label: `col ${name}`,
    startLine: 1,
    endLine: rows.length
  }))
  const rowBlocks: PreviewBlock[] = body.map((row, idx) => ({
    id: `row-${idx + 1}`,
    kind: 'row' as const,
    text: row.join(','),
    label: `row ${idx + 1}`,
    startLine: idx + 2,
    endLine: idx + 2,
    children: row.map((cell, col) => ({
      id: `cell-${headers[col] || col}${idx + 1}`,
      kind: 'cell-table' as const,
      text: cell,
      label: `${headers[col] || col}${idx + 1}`,
      startLine: idx + 2,
      endLine: idx + 2
    }))
  }))
  const blocks: PreviewBlock[] = [
    {
      id: 'table',
      kind: 'table',
      text: tableText,
      label: `table · ${body.length}×${headers.length}`,
      startLine: 1,
      endLine: rows.length,
      children: [...colBlocks, ...rowBlocks]
    },
    ...colBlocks,
    ...rowBlocks
  ]
  return { headers, rows: body, blocks }
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}

const CODE_EXTS = new Set([
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'php',
  'lua',
  'r',
  'scala',
  'dart',
  'zig'
])

const STRUCTURED_EXTS = new Set(['json', 'jsonc', 'json5'])
const INDENT_STRUCTURED_EXTS = new Set(['yml', 'yaml', 'xml'])

/** Pick the right block parser for a path. */
export function parseBlocksForPath(path: string, text: string): PreviewBlock[] {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return parseMarkdownBlocks(text)
  if (ext === 'ipynb') return parseNotebookBlocks(text)
  // JSON / YAML / XML: indent reflects nesting — use indent blocks for accurate
  // per-level selection (the old JSON walker had broken line numbers).
  if (STRUCTURED_EXTS.has(ext)) return parseIndentBlocks(text, 'json')
  if (INDENT_STRUCTURED_EXTS.has(ext)) return parseIndentBlocks(text, ext)
  // Code files: indent-based blocks (DevTools-style element selection).
  if (CODE_EXTS.has(ext)) return parseIndentBlocks(text, languageHint(ext))
  // TOML / plist / unknown: text paragraphs (not indent-driven structures).
  return parseTextBlocks(text)
}

function languageHint(ext: string): string | undefined {
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cs: 'csharp'
  }
  return map[ext]
}

export function formatBadge(path: string, kind: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'Markdown'
  if (ext === 'csv' || ext === 'tsv') return 'CSV'
  if (ext === 'pdf') return 'PDF'
  if (ext === 'ipynb') return 'Notebook'
  if (ext === 'docx') return 'DOCX'
  if (ext === 'xlsx' || ext === 'xls') return 'XLSX'
  if (ext === 'pptx') return 'PPTX'
  if (kind === 'image') return 'Image'
  if (kind === 'audio') return 'Audio'
  if (kind === 'video') return 'Video'
  if (kind === 'binary') return 'Binary'
  if (ext === 'txt' || !ext) return 'TXT'
  return ext.toUpperCase()
}

/** Flatten visible blocks for the current drill stack. */
export function visibleBlocks(
  roots: PreviewBlock[],
  drillStack: PreviewBlock[]
): PreviewBlock[] {
  if (drillStack.length === 0) return roots
  const top = drillStack[drillStack.length - 1]!
  return top.children ?? []
}

function coversLine(block: PreviewBlock, line: number): boolean {
  return line >= block.startLine && line <= block.endLine
}

/**
 * Resolve the selectable block for a 1-based line — DevTools-style: always
 * returns the deepest block containing the line, walking down through children.
 * The drill stack, when set, restricts the search to the drilled block's subtree.
 */
export function blockAtLine(
  roots: PreviewBlock[],
  line: number,
  drillStack: readonly PreviewBlock[] = []
): PreviewBlock | null {
  const layer =
    drillStack.length > 0 ? (drillStack[drillStack.length - 1]!.children ?? []) : roots

  for (const block of layer) {
    if (!coversLine(block, line)) continue
    // Walk down to the deepest child containing this line.
    let current = block
    while (current.children) {
      const child = current.children.find((c) => coversLine(c, line))
      if (!child) break
      current = child
    }
    return current
  }
  return null
}

/** Find a block by id anywhere in the tree. */
export function findBlockById(
  roots: readonly PreviewBlock[],
  id: string
): PreviewBlock | null {
  for (const block of roots) {
    if (block.id === id) return block
    if (block.children) {
      const hit = findBlockById(block.children, id)
      if (hit) return hit
    }
  }
  return null
}

/** Parent of `id`, or null if root. */
export function parentBlockOf(
  roots: readonly PreviewBlock[],
  id: string
): PreviewBlock | null {
  let found: PreviewBlock | null = null
  const walk = (list: readonly PreviewBlock[], parent: PreviewBlock | null): void => {
    for (const b of list) {
      if (b.id === id) {
        found = parent
        return
      }
      if (b.children) walk(b.children, b)
      if (found) return
    }
  }
  walk(roots, null)
  return found
}
