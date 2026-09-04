const EXCERPT_CAP = 8_000
const SELECTION_CAP = 4_000
const HEADING_CAP = 12

export function formatPageContext(page) {
  const lines = ['[Current page]']
  if (page.title?.trim()) lines.push(`Title: ${page.title.trim()}`)
  if (page.url?.trim()) lines.push(`URL: ${page.url.trim()}`)
  if (page.siteName?.trim()) lines.push(`Site: ${page.siteName.trim()}`)
  if (page.description?.trim()) lines.push(`Description: ${clip(page.description, 400)}`)
  const headings = (page.headings || []).map((h) => String(h).trim()).filter(Boolean).slice(0, HEADING_CAP)
  if (headings.length) lines.push(`Headings: ${headings.join(' · ')}`)
  const selection = page.selection?.trim()
  if (selection) {
    lines.push('', 'Selected text:', clip(selection, SELECTION_CAP))
  }
  const excerpt = page.excerpt?.trim()
  if (excerpt && excerpt !== selection) {
    lines.push('', 'Page text:', clip(excerpt, EXCERPT_CAP))
  }
  return lines.join('\n').trim()
}

export function composeSendText(userText, page) {
  const ask = (userText || '').trim()
  const context = page ? formatPageContext(page) : ''
  if (ask && context) return `${ask}\n\n${context}`
  return ask || context
}

function clip(text, cap) {
  const trimmed = String(text)
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (trimmed.length <= cap) return trimmed
  return `${trimmed.slice(0, cap - 1).trimEnd()}…`
}
