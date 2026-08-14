import type { PreviewBlock, PreviewBlockKind } from '../../../shared/previewBlock.ts'

/**
 * Indent-sensitive block tree for Python.
 *
 * The generic indent walker treats `):` as a brace closer and splits
 * `if` / `elif` / `else` (same indent) into unrelated siblings — both wrong
 * for Python suites. This parser:
 *   - consumes a logical line (implicit continuation + triple quotes)
 *   - takes an indented suite only when that line ends with `:`
 *   - attaches elif / else / except / finally to the opening compound
 *   - folds decorators into the following def / class
 */

function sliceLines(lines: string[], start: number, end: number): string {
  return lines.slice(start, end).join('\n')
}

function indentOf(line: string): number {
  const m = line.match(/^[ \t]*/)
  if (!m) return 0
  let n = 0
  for (const ch of m[0]!) n += ch === '\t' ? 4 : 1
  return n
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function isComment(line: string): boolean {
  return /^\s*#/.test(line)
}

function isDecorator(line: string): boolean {
  return /^\s*@/.test(line)
}

function isDefOrClass(line: string): boolean {
  return /^\s*(async\s+)?(def|class)\b/.test(line)
}

type CompoundKind = 'if' | 'try' | 'loop'

function compoundKind(line: string): CompoundKind | null {
  const t = line.trim()
  if (/^(async\s+)?if\b/.test(t)) return 'if'
  if (/^try\b/.test(t)) return 'try'
  if (/^(async\s+)?(for|while)\b/.test(t)) return 'loop'
  return null
}

type ClauseKind = 'elif' | 'else' | 'except' | 'finally'

function clauseKind(line: string): ClauseKind | null {
  const t = line.trim()
  if (/^elif\b/.test(t)) return 'elif'
  if (/^else\b/.test(t)) return 'else'
  if (/^except\b/.test(t)) return 'except'
  if (/^finally\b/.test(t)) return 'finally'
  return null
}

function canAttachClause(compound: CompoundKind, clause: ClauseKind): boolean {
  if (compound === 'if') return clause === 'elif' || clause === 'else'
  if (compound === 'try') return clause === 'except' || clause === 'else' || clause === 'finally'
  return clause === 'else'
}

type ScanState = {
  depth: number
  quote: string | null
  triple: boolean
}

function scanPythonLine(line: string, start: ScanState): ScanState {
  let { depth, quote, triple } = start
  let i = 0
  while (i < line.length) {
    if (quote) {
      if (triple) {
        const closer = quote + quote + quote
        if (line.startsWith(closer, i)) {
          quote = null
          triple = false
          i += 3
          continue
        }
        i += 1
        continue
      }
      if (line[i] === '\\') {
        i += 2
        continue
      }
      if (line[i] === quote) {
        quote = null
        i += 1
        continue
      }
      i += 1
      continue
    }

    const ch = line[i]!
    if (ch === '#') break
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
      i += 1
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1)
      i += 1
      continue
    }

    const rest = line.slice(i)
    const open = /^(?:[rR][fFbB]|[fFbB][rR]|[rRuUfFbB])?('''|"""|'|")/.exec(rest)
    if (open) {
      const q = open[1]!
      i += open[0].length
      quote = q[0]!
      triple = q.length === 3
      continue
    }
    i += 1
  }
  return { depth, quote, triple }
}

/** Exclusive end of one logical line (backslash / brackets / open string). */
function consumeLogical(lines: string[], from: number, to: number): number {
  let state: ScanState = { depth: 0, quote: null, triple: false }
  let j = from
  while (j < to) {
    const line = lines[j]!
    state = scanPythonLine(line, state)
    const continued = /\\\s*$/.test(line)
    j += 1
    if (state.depth <= 0 && !state.quote && !continued) break
  }
  return Math.max(j, from + 1)
}

function stripLineComment(line: string): string {
  let quote: string | null = null
  let triple = false
  for (let i = 0; i < line.length; i++) {
    if (quote) {
      if (triple) {
        if (line.startsWith(quote + quote + quote, i)) {
          quote = null
          triple = false
          i += 2
        }
        continue
      }
      if (line[i] === '\\') {
        i += 1
        continue
      }
      if (line[i] === quote) quote = null
      continue
    }
    if (line[i] === '#') return line.slice(0, i)
    const rest = line.slice(i)
    const open = /^(?:[rR][fFbB]|[fFbB][rR]|[rRuUfFbB])?('''|"""|'|")/.exec(rest)
    if (open) {
      const q = open[1]!
      quote = q[0]!
      triple = q.length === 3
      i += open[0].length - 1
    }
  }
  return line
}

function logicalEndsWithColon(lines: string[], from: number, end: number): boolean {
  for (let k = end - 1; k >= from; k--) {
    const t = stripLineComment(lines[k]!).trim()
    if (!t) continue
    return t.endsWith(':')
  }
  return false
}

function consumeSuite(lines: string[], from: number, to: number, parentIndent: number): number {
  let i = from
  let end = from
  while (i < to) {
    if (isBlank(lines[i]!)) {
      i += 1
      continue
    }
    if (indentOf(lines[i]!) <= parentIndent) break
    i += 1
    end = i
  }
  return end
}

function skipBlanks(lines: string[], i: number, to: number): number {
  while (i < to && isBlank(lines[i]!)) i += 1
  return i
}

/** Blanks + full-line comments at `parentIndent` — do not consume other code. */
function skipInert(lines: string[], i: number, to: number, parentIndent: number): number {
  while (i < to) {
    const line = lines[i]!
    if (isBlank(line)) {
      i += 1
      continue
    }
    if (isComment(line) && indentOf(line) === parentIndent) {
      i += 1
      continue
    }
    break
  }
  return i
}

function trimBlockEnd(lines: string[], start: number, end: number): number {
  let e = end
  while (e > start + 1 && isBlank(lines[e - 1]!)) e -= 1
  return e
}

function headKind(line: string): PreviewBlockKind {
  const t = line.trim()
  if (/^(async\s+)?def\b/.test(t) || t.startsWith('@')) return 'func'
  if (/^class\b/.test(t)) return 'type'
  if (compoundKind(t) || clauseKind(t) || /^(async\s+)?(with|match)\b/.test(t)) return 'control'
  return 'paragraph'
}

function parseRange(
  lines: string[],
  from: number,
  to: number,
  depth: number
): PreviewBlock[] {
  let minIndent = Infinity
  for (let i = from; i < to; i++) {
    if (isBlank(lines[i]!)) continue
    minIndent = Math.min(minIndent, indentOf(lines[i]!))
  }
  if (minIndent === Infinity) return []

  const blocks: PreviewBlock[] = []
  let i = from
  while (i < to) {
    i = skipBlanks(lines, i, to)
    if (i >= to) break
    const ind = indentOf(lines[i]!)
    if (ind < minIndent) break
    if (ind > minIndent) {
      i += 1
      continue
    }

    const headStart = i

    while (i < to && isDecorator(lines[i]!) && indentOf(lines[i]!) === minIndent) {
      i = consumeLogical(lines, i, to)
      i = skipInert(lines, i, to, minIndent)
    }

    if (
      headStart < i &&
      (i >= to || indentOf(lines[i]!) !== minIndent || !isDefOrClass(lines[i]!))
    ) {
      const decoEnd = trimBlockEnd(lines, headStart, i)
      blocks.push(makeBlock(lines, headStart, decoEnd, depth, []))
      continue
    }

    const stmtStart = i
    const headerEnd = consumeLogical(lines, i, to)
    const headerLine = lines[stmtStart]!
    i = headerEnd

    const hasSuite = logicalEndsWithColon(lines, stmtStart, headerEnd)
    const suiteStart = i
    const suiteEnd = hasSuite ? consumeSuite(lines, i, to, minIndent) : i
    i = suiteEnd

    const compound = compoundKind(headerLine)
    const clauseChildren: PreviewBlock[] = []
    if (compound && hasSuite) {
      for (;;) {
        const look = skipInert(lines, i, to, minIndent)
        if (look >= to) break
        if (indentOf(lines[look]!) !== minIndent) break
        const clause = clauseKind(lines[look]!)
        if (!clause || !canAttachClause(compound, clause)) break
        const clauseStart = look
        const clauseHeaderEnd = consumeLogical(lines, look, to)
        const clauseSuiteEnd = logicalEndsWithColon(lines, clauseStart, clauseHeaderEnd)
          ? consumeSuite(lines, clauseHeaderEnd, to, minIndent)
          : clauseHeaderEnd
        const clauseEnd = trimBlockEnd(lines, clauseStart, clauseSuiteEnd)
        const inner = parseRange(lines, clauseHeaderEnd, clauseEnd, depth + 1)
        clauseChildren.push(makeBlock(lines, clauseStart, clauseEnd, depth + 1, inner))
        i = clauseSuiteEnd
      }
    }

    const blockEnd = trimBlockEnd(lines, headStart, i)
    const inner = hasSuite ? parseRange(lines, suiteStart, suiteEnd, depth + 1) : []
    blocks.push(makeBlock(lines, headStart, blockEnd, depth, [...inner, ...clauseChildren]))
  }
  return blocks
}

function makeBlock(
  lines: string[],
  start: number,
  end: number,
  depth: number,
  children: PreviewBlock[]
): PreviewBlock {
  const headText = lines[start]!.trim()
  const range = end > start + 1 ? `L${start + 1}–${end}` : `L${start + 1}`
  return {
    id: `indent-d${depth}-L${start + 1}`,
    kind: headKind(headText),
    text: sliceLines(lines, start, end),
    language: 'python',
    startLine: start + 1,
    endLine: end,
    label: `${range} · ${headText.slice(0, 60)}`,
    children: children.length ? children : undefined
  }
}

export function parsePythonIndentBlocks(source: string): PreviewBlock[] {
  const lines = source.split(/\r?\n/)
  return parseRange(lines, 0, lines.length, 0)
}
