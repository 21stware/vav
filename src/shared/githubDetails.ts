/**
 * GitHub review bots (Devin, OriginAI, Copilot, Dependabot) wrap extra
 * analysis and "Prompt for agents" in `<details>`. CommonMark HTML-block
 * rules end those tags at the first blank line, so markdown-it leaks the
 * inner markdown *outside* the disclosure — the toggle and the body both
 * show, which reads as duplicate content.
 *
 * Peel every `<details>` out, render its inner markdown, then splice the
 * finished element back in after the surrounding markdown has been rendered.
 */

const OPEN = /<details\b([^>]*)>/i
const BOUNDARY = /<details\b[^>]*>|<\/details>/gi
const PLACEHOLDER = (i: number): string => `<div data-vav-details="${i}"></div>`
const PLACEHOLDER_RE = /<div data-vav-details="(\d+)"><\/div>/g

function matchingClose(src: string, from: number): { index: number; tag: string } | null {
  let depth = 1
  BOUNDARY.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = BOUNDARY.exec(src))) {
    if (/^<\/details>/i.test(m[0])) {
      depth -= 1
      if (depth === 0) return { index: m.index, tag: m[0] }
    } else {
      depth += 1
    }
  }
  return null
}

function splitSummary(inner: string): { summary: string; body: string } {
  const m = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>\s*/i.exec(inner)
  if (!m) return { summary: 'Details', body: inner }
  const summary = m[1]!.trim() || 'Details'
  return { summary, body: inner.slice(m[0].length) }
}

function replaceTopLevelDetails(
  source: string,
  replace: (attrs: string, inner: string) => string
): string {
  let out = ''
  let rest = source
  while (rest) {
    const m = OPEN.exec(rest)
    if (!m) {
      out += rest
      break
    }
    out += rest.slice(0, m.index)
    const innerStart = m.index + m[0].length
    const close = matchingClose(rest, innerStart)
    if (!close) {
      out += rest.slice(m.index)
      break
    }
    out += replace(m[1] ?? '', rest.slice(innerStart, close.index))
    rest = rest.slice(close.index + close.tag.length)
  }
  return out
}

/** Drop HTML comments so bot metadata (`<!-- devin-review-comment -->`) stays out of the thread. */
export function stripHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, '')
}

function isTableSep(line: string): boolean {
  const t = line.trim()
  return t.includes('|') && t.includes('-') && /^[\s|:-]+$/.test(t)
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  if (!t || t.startsWith('<') || t.startsWith('```')) return false
  return t.startsWith('|') || t.includes('|')
}

function splitCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

/**
 * Turn GFM pipe tables into HTML so markdown-it (no table plugin) still
 * shows Cloudflare / Dependabot status grids instead of raw pipes.
 */
export function convertGfmTables(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const header = lines[i] ?? ''
    const sep = lines[i + 1] ?? ''
    if (isTableRow(header) && isTableSep(sep)) {
      const heads = splitCells(header)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && isTableRow(lines[j] ?? '') && !isTableSep(lines[j] ?? '')) {
        rows.push(splitCells(lines[j]!))
        j += 1
      }
      const thead = heads.map((c) => `<th>${c}</th>`).join('')
      const tbody = rows
        .map((row) => {
          const cells = heads.map((_, idx) => `<td>${row[idx] ?? ''}</td>`).join('')
          return `<tr>${cells}</tr>`
        })
        .join('')
      out.push(
        `<div class="table-scroll"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`
      )
      i = j
      continue
    }
    out.push(header)
    i += 1
  }
  return out.join('\n')
}

const TABLE_OPEN = /<table\b[^>]*>/i
const TABLE_BOUNDARY = /<table\b[^>]*>|<\/table>/gi
const TABLE_PLACEHOLDER = (i: number): string => `<div data-vav-table="${i}"></div>`
const TABLE_PLACEHOLDER_RE = /<div data-vav-table="(\d+)"><\/div>/g

function matchingTableClose(src: string, from: number): { index: number; tag: string } | null {
  let depth = 1
  TABLE_BOUNDARY.lastIndex = from
  let m: RegExpExecArray | null
  while ((m = TABLE_BOUNDARY.exec(src))) {
    if (/^<\/table>/i.test(m[0])) {
      depth -= 1
      if (depth === 0) return { index: m.index, tag: m[0] }
    } else {
      depth += 1
    }
  }
  return null
}

function replaceHtmlTables(source: string, replace: (html: string) => string): string {
  let out = ''
  let rest = source
  while (rest) {
    const m = TABLE_OPEN.exec(rest)
    if (!m) {
      out += rest
      break
    }
    out += rest.slice(0, m.index)
    const innerStart = m.index + m[0].length
    const close = matchingTableClose(rest, innerStart)
    if (!close) {
      out += rest.slice(m.index)
      break
    }
    out += replace(rest.slice(m.index, close.index + close.tag.length))
    rest = rest.slice(close.index + close.tag.length)
  }
  return out
}

/**
 * CommonMark ends an HTML `<table>` at the first blank line, which splits
 * nested tables and bot status grids. Peel complete tables (nested-aware)
 * out, convert any GFM pipes inside cells, then splice them back after
 * markdown has been rendered.
 */
export function renderGithubTables(source: string, renderMarkdown: (src: string) => string): string {
  const tables: string[] = []
  const marked = replaceHtmlTables(source, (html) => {
    const i = tables.length
    tables.push(`<div class="table-scroll">${convertGfmTables(html)}</div>`)
    return `\n\n${TABLE_PLACEHOLDER(i)}\n\n`
  })
  const html = renderMarkdown(convertGfmTables(marked))
  return html.replace(TABLE_PLACEHOLDER_RE, (_all, id) => tables[Number(id)] ?? '')
}

/**
 * Render markdown around GitHub `<details>` without leaking the inner body.
 * `renderMarkdown` is the host renderer (markdown-it in the app).
 */
export function renderGithubDetails(
  source: string,
  renderMarkdown: (src: string) => string
): string {
  const chunks: string[] = []
  const marked = replaceTopLevelDetails(source, (_attrs, inner) => {
    const { summary, body } = splitSummary(inner)
    const bodyHtml = renderGithubDetails(body, renderMarkdown)
    const i = chunks.length
    const extra = /prompt for agents/i.test(summary) ? ' github-details-prompt' : ''
    chunks.push(
      `<details class="github-details${extra}">` +
        `<summary>${summary}</summary>` +
        `<div class="github-details-body">${bodyHtml}</div>` +
        `</details>`
    )
    return `\n\n${PLACEHOLDER(i)}\n\n`
  })
  let html = renderMarkdown(marked)
  html = html.replace(PLACEHOLDER_RE, (_all, id) => chunks[Number(id)] ?? '')
  return html
}
