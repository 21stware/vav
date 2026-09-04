/**
 * Format the current browser tab so a vavd turn can see it.
 * Shared by the Chrome extension (copied into extension/lib) and tests.
 */

export type ChromePageContext = {
  url: string
  title: string
  selection?: string
  description?: string
  headings?: string[]
  excerpt?: string
  siteName?: string
}

const EXCERPT_CAP = 8_000
const SELECTION_CAP = 4_000
const HEADING_CAP = 12

export function formatPageContext(page: ChromePageContext): string {
  const lines: string[] = ['[Current page]']
  if (page.title.trim()) lines.push(`Title: ${page.title.trim()}`)
  if (page.url.trim()) lines.push(`URL: ${page.url.trim()}`)
  if (page.siteName?.trim()) lines.push(`Site: ${page.siteName.trim()}`)
  if (page.description?.trim()) lines.push(`Description: ${clip(page.description, 400)}`)
  const headings = (page.headings ?? []).map((h) => h.trim()).filter(Boolean).slice(0, HEADING_CAP)
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

export function composeSendText(userText: string, page?: ChromePageContext | null): string {
  const ask = userText.trim()
  const context = page ? formatPageContext(page) : ''
  if (ask && context) return `${ask}\n\n${context}`
  return ask || context
}

function clip(text: string, cap: number): string {
  const trimmed = text.replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (trimmed.length <= cap) return trimmed
  return `${trimmed.slice(0, cap - 1).trimEnd()}…`
}
