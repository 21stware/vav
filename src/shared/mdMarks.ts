/**
 * Inline marks in agent markdown: TeX math and `[web:N]` / `[doc:id]` cites.
 *
 * Models (especially Chinese ones) emit display math as `[ 364 \times … ]`
 * after CommonMark turns `\[…\]` into brackets. Cites are the ids the
 * system prompt tells the model to use for web_search / doc_search hits.
 */

export type MdMathMark = {
  kind: 'math'
  display: boolean
  tex: string
  start: number
  end: number
}

export type MdCiteMark = {
  kind: 'cite'
  cite: 'web' | 'doc'
  id: string
  start: number
  end: number
}

export type MdMark = MdMathMark | MdCiteMark

/** Backslash command, or a braced superscript/subscript. */
export function looksLikeLatex(src: string): boolean {
  const s = src.trim()
  if (!s) return false
  if (/^(web|doc):/i.test(s)) return false
  if (/\\[a-zA-Z]+/.test(s)) return true
  if (/\^{|_[{\d]|\{[0-9]/.test(s)) return true
  return false
}

function findBalanced(text: string, start: number, open: string, close: string): number {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (isEscaped(text, i)) continue
    if (text[i] === open) depth++
    else if (text[i] === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function isEscaped(text: string, index: number): boolean {
  let n = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) n++
  return n % 2 === 1
}

function looksLikeInlineDollarMath(content: string): boolean {
  const t = content.trim()
  if (!t || t.includes('\n\n')) return false
  // `$100` / `$1,000.00` — currency, not math.
  if (/^[\d.,]+$/.test(t)) return false
  if (/\\[a-zA-Z]+/.test(t) || /[\^_{}]/.test(t) || /[+\-*/=<>]/.test(t)) return true
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(t)) return true
  return false
}

const CITE_WEB = /^\[web:(\d+)\]/i
const CITE_DOC = /^\[doc:([^\]|]+?)(?:\s*\|[^\]]*)?\]/i

export function findMdMarks(text: string): MdMark[] {
  const marks: MdMark[] = []
  const n = text.length
  let i = 0

  const push = (mark: MdMark): void => {
    marks.push(mark)
    i = mark.end
  }

  while (i < n) {
    if (text.startsWith('$$', i) && !isEscaped(text, i)) {
      const close = text.indexOf('$$', i + 2)
      if (close !== -1) {
        push({
          kind: 'math',
          display: true,
          tex: text.slice(i + 2, close),
          start: i,
          end: close + 2
        })
        continue
      }
    }

    if (text.startsWith('\\[', i) && !isEscaped(text, i)) {
      const close = text.indexOf('\\]', i + 2)
      if (close !== -1) {
        push({
          kind: 'math',
          display: true,
          tex: text.slice(i + 2, close),
          start: i,
          end: close + 2
        })
        continue
      }
    }

    if (text.startsWith('\\(', i) && !isEscaped(text, i)) {
      const close = text.indexOf('\\)', i + 2)
      if (close !== -1) {
        push({
          kind: 'math',
          display: false,
          tex: text.slice(i + 2, close),
          start: i,
          end: close + 2
        })
        continue
      }
    }

    if (text[i] === '$' && text[i + 1] !== '$' && !isEscaped(text, i)) {
      let j = i + 1
      while (j < n) {
        if (text[j] === '$' && !isEscaped(text, j)) break
        if (text[j] === '\n' && text[j + 1] === '\n') {
          j = -1
          break
        }
        j++
      }
      if (j > i + 1 && text[j] === '$') {
        const tex = text.slice(i + 1, j)
        if (looksLikeInlineDollarMath(tex)) {
          push({ kind: 'math', display: false, tex, start: i, end: j + 1 })
          continue
        }
      }
    }

    if (text[i] === '[' && !isEscaped(text, i)) {
      const web = CITE_WEB.exec(text.slice(i))
      if (web) {
        push({
          kind: 'cite',
          cite: 'web',
          id: web[1]!,
          start: i,
          end: i + web[0].length
        })
        continue
      }
      const doc = CITE_DOC.exec(text.slice(i))
      if (doc) {
        push({
          kind: 'cite',
          cite: 'doc',
          id: doc[1]!.trim(),
          start: i,
          end: i + doc[0].length
        })
        continue
      }
      const close = text.indexOf(']', i + 1)
      if (close > i + 1 && text[close + 1] !== '(') {
        const inner = text.slice(i + 1, close)
        if (looksLikeLatex(inner)) {
          push({
            kind: 'math',
            display: true,
            tex: inner.trim(),
            start: i,
            end: close + 1
          })
          continue
        }
      }
    }

    // After CommonMark, `\(...\)` is just `(…)`. Recover only when it is TeX.
    if (text[i] === '(' && !isEscaped(text, i)) {
      const close = findBalanced(text, i, '(', ')')
      if (close > i + 1) {
        const inner = text.slice(i + 1, close)
        if (looksLikeLatex(inner) && !inner.includes('\n\n')) {
          push({
            kind: 'math',
            display: false,
            tex: inner.trim(),
            start: i,
            end: close + 1
          })
          continue
        }
      }
    }

    i++
  }

  return marks
}

export function extractCiteKeys(text: string): string[] {
  const keys: string[] = []
  for (const mark of findMdMarks(text)) {
    if (mark.kind === 'cite') keys.push(`${mark.cite}:${mark.id}`)
  }
  return [...new Set(keys)]
}

export type DocHit = {
  id: string
  path: string
  loc: string
  body: string
}

const DOC_HEAD =
  /^(?:(\d+)\.\s+)?\[doc:([^\]|]+?)(?:\s*\|\s*([^\]|]*?)(?:\s*\|\s*([^\]]*?))?)?\](.*)$/i

export function parseDocHits(text: string): { header: string; hits: DocHit[] } {
  const lines = text.replace(/\n+$/, '').split('\n')
  const first = lines[0] ?? ''
  const header =
    first.startsWith('Found ') || first.startsWith('Fetched ') || first.startsWith('No ')
      ? first
      : ''
  const hits: DocHit[] = []
  let current: DocHit | null = null
  const body: string[] = []

  const flush = (): void => {
    if (!current) return
    current.body = body.join('\n').trim()
    hits.push(current)
    current = null
    body.length = 0
  }

  for (const line of lines) {
    if (header && line === header) continue
    const head = DOC_HEAD.exec(line)
    if (head) {
      flush()
      current = {
        id: head[2]!.trim(),
        path: (head[3] ?? '').trim(),
        loc: (head[4] ?? '').trim(),
        body: ''
      }
      const rest = (head[5] ?? '').trim()
      if (rest && !/^score=/.test(rest)) body.push(rest)
      continue
    }
    if (current) body.push(line)
  }
  flush()
  return { header, hits }
}
