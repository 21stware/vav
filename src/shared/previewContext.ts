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
    const label = ref.label ? ` · ${ref.label}` : ''
    lines.push('')
    lines.push(`### ${ref.filePath}${badge}${label} · lines ${ref.startLine}–${ref.endLine}`)
    lines.push('```')
    lines.push(ref.text)
    lines.push('```')
    const note = ref.comment?.trim()
    if (note) {
      lines.push('')
      lines.push(`User note: ${note}`)
    }
  }
  return lines.join('\n')
}

/** Paperclip paths reconstituted for the model (not shown in the bubble body). */
export function formatAttachmentsContext(paths: string[] | null | undefined): string {
  if (!paths || paths.length === 0) return ''
  return `Attachments:\n${paths.map((p) => `- ${p}`).join('\n')}`
}

/** Text sent to the model: optional selection context + attachments + user text. */
export function composeContextUserText(
  text: string,
  refs: PreviewRef[] | null | undefined,
  attachments?: string[] | null
): string {
  const parts: string[] = []
  const context = formatPreviewContext(refs)
  if (context) parts.push(context)
  const files = formatAttachmentsContext(attachments)
  if (files) parts.push(files)
  if (text) parts.push(text)
  return parts.join('\n\n')
}
