import type { PreviewRef } from './types'

/**
 * Hidden context block prepended to outbound user text so the model sees the
 * previewed selection. The bubble body stays user-typed only — this is the
 * counterpart to {@link ./quote.composeQuotedUserText} for file-preview refs.
 */
export function formatPreviewContext(refs: PreviewRef[] | null | undefined): string {
  if (!refs || refs.length === 0) return ''
  const lines: string[] = ['## Selected context']
  for (const ref of refs) {
    const badge = ref.badge ? ` ${ref.badge}` : ''
    lines.push('')
    lines.push(`### ${ref.filePath}${badge} · lines ${ref.startLine}–${ref.endLine}`)
    lines.push('```')
    lines.push(ref.text)
    lines.push('```')
  }
  return lines.join('\n')
}

/** Text sent to the model: optional selection context + user text. */
export function composeContextUserText(
  text: string,
  refs: PreviewRef[] | null | undefined
): string {
  const context = formatPreviewContext(refs)
  if (!context) return text
  return text ? `${context}\n\n${text}` : context
}
