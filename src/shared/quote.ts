import type { QuoteDraft } from './types'

const QUOTE_SUMMARY_MAX = 120

/** First ~120 chars of a message body for the quote strip / outbound marker. */
export function quoteSummaryFromContent(content: string, max = QUOTE_SUMMARY_MAX): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`
}

/** Block prepended to outbound user text so the model sees the citation. */
export function formatQuoteMarker(role: 'user' | 'assistant', summary: string): string {
  const who = role === 'user' ? 'User' : 'Agent'
  return `「引用自 ${who}」\n${summary}\n\n`
}

/** Text sent to the model: optional quote marker + user text (+ attachments later). */
export function composeQuotedUserText(text: string, quote: QuoteDraft | null | undefined): string {
  if (!quote?.summary) return text
  return `${formatQuoteMarker(quote.role, quote.summary)}${text}`
}
