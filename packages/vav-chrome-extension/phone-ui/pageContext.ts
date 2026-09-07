import type { PhonePageState } from './phoneTransport'

const EXCERPT_CAP = 8_000
const SELECTION_CAP = 4_000

function clip(text: string, cap: number): string {
  const trimmed = String(text)
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (trimmed.length <= cap) return trimmed
  return `${trimmed.slice(0, cap - 1).trimEnd()}…`
}

export function isAttachablePageUrl(url: string): boolean {
  return Boolean(url) && !/^(chrome|chrome-extension|about|devtools|edge|brave):/i.test(url)
}

export function composeSendText(userText: string, page: PhonePageState): string {
  const ask = (userText || '').trim()
  if (!page.includePage || !isAttachablePageUrl(page.url)) return ask
  const lines = ['[Current page]']
  if (page.title.trim()) lines.push(`Title: ${page.title.trim()}`)
  if (page.url.trim()) lines.push(`URL: ${page.url.trim()}`)
  if (page.selection.trim()) {
    lines.push('', 'Selected text:', clip(page.selection, SELECTION_CAP))
  }
  const context = lines.join('\n').trim()
  if (ask && context) return `${ask}\n\n${context}`
  return ask || context
}

void EXCERPT_CAP
