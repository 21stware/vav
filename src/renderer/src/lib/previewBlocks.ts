/**
 * Hierarchical selectable blocks for file-preview.rpml (release c945830a…).
 *
 * Click always hits the deepest block containing the line / region (DevTools-
 * style element pick). Nested children are independently selectable without
 * a drill-in mode.
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

/**
 * CommonMark-ish fenced code open line: 0–3 spaces, then 3+ backticks or tildes.
 * Returns marker char, fence length, and info string (language).
 */
function matchFenceOpen(
  line: string
): { char: '`' | '~'; len: number; info: string } | null {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
  if (!m) return null
  const fence = m[2]!
  const char = fence[0] as '`' | '~'
  // Info string must not contain the fence char (CM: backticks can't be in info for ` fences).
  const info = (m[3] || '').replace(/\s+$/, '')
  if (char === '`' && info.includes('`')) return null
  return { char, len: fence.length, info: info.trim() }
}

/** Closing fence: same char, length ≥ open, optional trailing spaces only. */
function isFenceClose(line: string, char: '`' | '~', openLen: number): boolean {
  const m = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line)
  if (!m) return false
  const fence = m[2]!
  if (fence[0] !== char) return false
  return fence.length >= openLen
}

/**
 * If `lines[i]` opens a fence, return exclusive end index after the closing line
 * (or EOF). Used so heading/paragraph scanners never treat `#` inside fences as ATX.
 */
function skipFencedRegion(lines: string[], i: number): number | null {
  const open = matchFenceOpen(lines[i]!)
  if (!open) return null
  let j = i + 1
  while (j < lines.length && !isFenceClose(lines[j]!, open.char, open.len)) j++
  if (j < lines.length) j++ // consume closing fence
  return j
}

/**
 * Markdown → hierarchical selectable blocks.
 *
 * `lineOffset` is the number of lines before this slice in the full document
 * (0 for the root call). Every id / startLine / endLine is absolute so nested
 * heading recursion never reuses `para-L1` / `list-0` across sections.
 */
export function parseMarkdownBlocks(source: string, lineOffset = 0): PreviewBlock[] {
  const lines = source.split(/\r?\n/)
  const blocks: PreviewBlock[] = []
  let i = 0

  // Frontmatter only at the document root.
  if (lineOffset === 0 && lines[0]?.trim() === '---') {
    let end = 1
    while (end < lines.length && lines[end]?.trim() !== '---') end++
    if (end < lines.length) {
      blocks.push({
        id: `frontmatter-L1`,
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
    const absStart = start + 1 + lineOffset
    const line = lines[i]!

    const fenceOpen = matchFenceOpen(line)
    if (fenceOpen) {
      const language = fenceOpen.info.split(/\s+/g)[0] || undefined
      i++
      while (i < lines.length && !isFenceClose(lines[i]!, fenceOpen.char, fenceOpen.len)) {
        i++
      }
      if (i < lines.length) i++
      const absEnd = i + lineOffset
      blocks.push({
        id: `codeblock-L${absStart}`,
        kind: 'code',
        text: sliceLines(lines, start, i),
        language,
        label: language
          ? `${language} · lines ${absStart}–${absEnd}`
          : `code · lines ${absStart}–${absEnd}`,
        startLine: absStart,
        endLine: absEnd
      })
      continue
    }

    // ATX headings must not match when indented as code (0–3 spaces only, CM).
    const heading = line.match(/^( {0,3})(#{1,6})\s+(.+?)(?:\s+#*\s*)?$/)
    if (heading) {
      const level = heading[2]!.length
      const title = heading[3]!.trim()
      // Line-anchored ids: same title in two places must not share an id.
      const headingId = `h${level}-L${absStart}-${slug(title)}`
      i++
      const sectionStart = start
      // Scan section body; skip fenced regions so `# comment` inside ```bash
      // is never treated as a section boundary (was breaking install fences).
      while (i < lines.length) {
        const fenceEnd = skipFencedRegion(lines, i)
        if (fenceEnd != null) {
          i = fenceEnd
          continue
        }
        const next = lines[i]!.match(/^( {0,3})(#{1,6})\s+/)
        if (next && next[2]!.length <= level) break
        i++
      }
      const absEnd = i + lineOffset
      const sectionText = sliceLines(lines, sectionStart, i)
      // Recurse with absolute offset so child ids/lines stay unique.
      const inner = parseMarkdownBlocks(
        sliceLines(lines, start + 1, i),
        lineOffset + start + 1
      )
      const section: PreviewBlock = {
        id: `h${level}-section-L${absStart}-${slug(title)}`,
        kind: 'heading-section',
        text: sectionText,
        level,
        label: `H${level} section · ${title}`,
        startLine: absStart,
        endLine: absEnd,
        children: inner.length ? inner : undefined
      }
      blocks.push({
        id: headingId,
        kind: 'heading',
        text: line,
        level,
        label: `H${level} ${title}`,
        startLine: absStart,
        endLine: absStart,
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
      const absListStart = listStart + 1 + lineOffset
      const absListEnd = i + lineOffset
      blocks.push({
        id: `list-L${absListStart}`,
        kind: 'list',
        text: sliceLines(lines, listStart, i),
        label: `list · ${itemLines.length} items`,
        startLine: absListStart,
        endLine: absListEnd,
        children: itemLines.map((item, sub) => {
          const absItemStart = item.start + 1 + lineOffset
          const absItemEnd = item.end + lineOffset
          return {
            id: `li-L${absItemStart}`,
            kind: 'list-item' as const,
            text: item.text,
            startLine: absItemStart,
            endLine: absItemEnd,
            label: `li ${sub + 1}`
          }
        })
      })
      continue
    }

    i++
    while (i < lines.length && lines[i]!.trim() !== '') {
      // Don't start a new block mid-paragraph on fence/heading.
      if (matchFenceOpen(lines[i]!)) break
      if (/^( {0,3})(#{1,6})\s+/.test(lines[i]!)) break
      if (/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)) break
      i++
    }
    const absEnd = i + lineOffset
    blocks.push({
      id: `para-L${absStart}`,
      kind: 'paragraph',
      text: sliceLines(lines, start, i),
      startLine: absStart,
      endLine: absEnd,
      label: `paragraph · lines ${absStart}–${absEnd}`
    })
  }

  return blocks
}

/**
 * Plain text → blank-line-separated paragraphs only.
 * No per-line children: drill-in is gone, and deepest-hit would otherwise make
 * every line in a LICENSE/README paragraph independently selectable.
 */
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
    blocks.push({
      id: `para-${index++}`,
      kind: 'paragraph',
      text,
      startLine: start + 1,
      endLine: i,
      label: `paragraph · lines ${start + 1}–${i}`
    })
  }
  return blocks
}

/** Notebook → cells with optional input / output children. */
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
 * Source code → functions (default). Types are L1 siblings.
 * Nested control-flow / stmts are available as children for deepest-hit pick.
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
        id: `type-L${i + 1}-${name}`,
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
        id: `func-L${i + 1}-${name}`,
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
  /** Lightweight: table + column stubs only. Rows/cells are built on pick. */
  blocks: PreviewBlock[]
}

/** Always include column index — two headers can slug to the same token. */
export function csvColId(name: string, col: number): string {
  return `col-${col}-${slug(name) || 'c'}`
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

/**
 * Max rows kept in the in-memory sheet model. Inspect already caps file bytes;
 * this is a second guard so a dense 512KB CSV cannot allocate millions of cells.
 */
export const CSV_ROW_PARSE_CAP = 20_000

/**
 * Max columns materialised for block pick / col headers. Extremely wide CSVs
 * still open; only the first N columns are selectable as whole-col blocks.
 */
export const CSV_COL_BLOCK_CAP = 64

/**
 * Legacy name: we no longer eagerly build per-row PreviewBlocks (that OOMed
 * large sheets). Rows/cells are built on pick via {@link csvRowBlock}.
 */
export const CSV_BLOCK_ROW_CAP = 0

/** Build a single CSV cell block on demand (pick path). */
export function csvCellBlock(
  headers: string[],
  row: string[],
  rowIndex0: number,
  col: number
): PreviewBlock {
  const cell = row[col] ?? ''
  const h = headers[col] ?? String(col)
  return {
    id: `cell-r${rowIndex0 + 1}-c${col}`,
    kind: 'cell-table',
    text: cell,
    label: `${h}${rowIndex0 + 1}`,
    startLine: rowIndex0 + 2,
    endLine: rowIndex0 + 2
  }
}

/** Build a single CSV row block on demand (pick path). */
export function csvRowBlock(headers: string[], row: string[], rowIndex0: number): PreviewBlock {
  // Cap pair text so a 200-col row cannot allocate a multi-MB selection string.
  const colCount = Math.min(Math.max(headers.length, row.length), 32)
  const pairs = Array.from({ length: colCount }, (_, c) => {
    const name = headers[c] || `col${c + 1}`
    const val = row[c] ?? ''
    return `${name}=${val.length > 80 ? `${val.slice(0, 80)}…` : val}`
  })
  const extra = Math.max(headers.length, row.length) - colCount
  return {
    id: `row-${rowIndex0 + 1}`,
    kind: 'row',
    text: extra > 0 ? `${pairs.join(' | ')} · +${extra} cols` : pairs.join(' | '),
    label: `row ${rowIndex0 + 1}`,
    startLine: rowIndex0 + 2,
    endLine: rowIndex0 + 2
  }
}

/** Cheap line split that keeps empty trailing lines out without filter(). */
function splitCsvLines(text: string): string[] {
  if (!text) return []
  // Normalise once; avoid double-scan filter.
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalised.split('\n')
  // Drop a single trailing empty line from final newline.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Parse CSV into a sheet model. Row/cell PreviewBlocks are **not** prebuilt —
 * only column + table stubs — so opening a multi-MB sheet stays O(rows) not
 * O(rows × cols) of React-bound objects.
 */
export function parseCsvModel(text: string): CsvSelectionModel {
  const lines = splitCsvLines(text)
  if (lines.length === 0) return { headers: [], rows: [], blocks: [] }

  const headerLine = lines[0] ?? ''
  const headers = parseCsvLine(headerLine)
  const bodyLimit = Math.min(lines.length - 1, CSV_ROW_PARSE_CAP)
  const body: string[][] = new Array(bodyLimit)
  for (let i = 0; i < bodyLimit; i++) {
    body[i] = parseCsvLine(lines[i + 1] ?? '')
  }

  const colCap = Math.min(headers.length, CSV_COL_BLOCK_CAP)
  // Column blocks only sample a few values — never join tens of thousands of cells.
  const colBlocks: PreviewBlock[] = []
  for (let col = 0; col < colCap; col++) {
    const name = headers[col] ?? `col${col + 1}`
    const sample: string[] = []
    const sampleN = Math.min(body.length, 40)
    for (let r = 0; r < sampleN; r++) {
      const v = body[r]?.[col] ?? ''
      sample.push(v.length > 60 ? `${v.slice(0, 60)}…` : v)
    }
    colBlocks.push({
      id: csvColId(name, col),
      kind: 'col',
      text: [name, ...sample].join('\n'),
      label: `col ${name}`,
      startLine: 1,
      endLine: body.length + 1
    })
  }

  const blocks: PreviewBlock[] = [
    {
      id: 'table',
      kind: 'table',
      text: `${body.length} rows × ${headers.length} cols`,
      label: `table · ${body.length}×${headers.length}`,
      startLine: 1,
      endLine: body.length + 1,
      // Cols only — row children used to explode memory on wide/tall sheets.
      children: colBlocks
    },
    ...colBlocks
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
/** Soft cap for structure indexing — large XML/JSON still scroll via virtualization. */
const STRUCTURE_LINE_CAP = 5000

const LINE_ORIENTED_EXTS = new Set([
  'log',
  'out',
  'err',
  'trace',
  'syslog',
  'logcat',
  'nfo'
])

/**
 * Line-oriented files (.log, dense logs): selection is per-line via the canvas
 * hit-test, not a prebuilt block tree (which would be O(n) memory and group
 * continuous logs into one giant paragraph).
 */
export function isLineOrientedPath(path: string, sampleText?: string): boolean {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  if (LINE_ORIENTED_EXTS.has(ext)) return true
  if (sampleText == null || sampleText.length < 200) return false
  // Dense logs: many short lines, almost no blank separators.
  let lines = 0
  let blank = 0
  for (let i = 0; i < sampleText.length && lines < 400; i++) {
    if (sampleText.charCodeAt(i) === 10) {
      lines++
      // crude blank-line count: previous char was also newline or start
    }
  }
  // Count blanks in first ~400 lines cheaply
  const head = sampleText.split(/\r?\n/, 400)
  if (head.length < 80) return false
  blank = head.filter((l) => !l.trim()).length
  return blank / head.length < 0.06
}

export function lineBlockAt(line: number, text: string): PreviewBlock | null {
  if (line < 1) return null
  // Avoid full split when possible: walk to line.
  let current = 1
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length
    const isNl = !atEnd && text.charCodeAt(i) === 10
    if (isNl || atEnd) {
      if (current === line) {
        const raw = text.slice(start, i)
        // strip trailing \r from CRLF
        const lineText = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        return {
          id: `line-L${line}`,
          kind: 'line',
          text: lineText,
          startLine: line,
          endLine: line,
          label: `L${line}`
        }
      }
      if (atEnd) break
      current++
      start = i + 1
    }
  }
  return null
}

export function parseBlocksForPath(path: string, text: string): PreviewBlock[] {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return parseMarkdownBlocks(text)
  if (ext === 'ipynb') return parseNotebookBlocks(text)

  // Log-like: no paragraph tree — canvas does per-line pick.
  if (isLineOrientedPath(path, text)) return []

  // Avoid freezing open on huge structured files: only index the head for
  // DevTools-style block selection; the rest is still viewable as text.
  let source = text
  if (countNewlines(text) + 1 > STRUCTURE_LINE_CAP) {
    source = takeFirstLines(text, STRUCTURE_LINE_CAP)
  }

  // JSON / YAML / XML: indent reflects nesting — use indent blocks for accurate
  // per-level selection (the old JSON walker had broken line numbers).
  if (STRUCTURED_EXTS.has(ext)) return parseIndentBlocks(source, 'json')
  if (INDENT_STRUCTURED_EXTS.has(ext)) return parseIndentBlocks(source, ext)
  // Code files: indent-based blocks (DevTools-style element selection).
  if (CODE_EXTS.has(ext)) return parseIndentBlocks(source, languageHint(ext))
  // TOML / plist / unknown: text paragraphs (not indent-driven structures).
  return parseTextBlocks(source)
}

function countNewlines(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  return n
}

function takeFirstLines(text: string, maxLines: number): string {
  let lines = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines++
      if (lines >= maxLines) return text.slice(0, i)
    }
  }
  return text
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
  if (kind === 'sqlite' || ext === 'db' || ext === 'sqlite' || ext === 'sqlite3' || ext === 'db3') {
    return 'SQLite'
  }
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'Markdown'
  if (ext === 'csv' || ext === 'tsv') return 'CSV'
  if (ext === 'pdf') return 'PDF'
  if (ext === 'ipynb') return 'Notebook'
  if (ext === 'docx') return 'DOCX'
  if (ext === 'xlsx' || ext === 'xls') return 'XLSX'
  if (ext === 'pptx') return 'PPTX'
  if (kind === 'html' || ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'HTML'
  if (kind === 'image') return 'Image'
  if (kind === 'audio') return 'Audio'
  if (kind === 'video') return 'Video'
  if (kind === 'binary') return 'Binary'
  if (kind === 'zip' || ext === 'zip') return 'ZIP'
  if (ext === 'txt' || !ext) return 'TXT'
  return ext.toUpperCase()
}

function coversLine(block: PreviewBlock, line: number): boolean {
  return line >= block.startLine && line <= block.endLine
}

/**
 * Resolve the selectable block for a 1-based line — DevTools-style: always
 * returns the deepest block containing the line, walking down through children.
 */
export function blockAtLine(roots: PreviewBlock[], line: number): PreviewBlock | null {
  for (const block of roots) {
    if (!coversLine(block, line)) continue
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
