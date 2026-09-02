import type { PreviewBlock } from './previewBlock'
import type { PreviewRef } from './types'

/**
 * True when the pick carries a real source line range (1-based).
 * DOM / media / archive picks use 0 to mean "unknown" so we never tell
 * the model "lines 1–1" for a slide or image.
 */
export function hasKnownLineRange(startLine: number, endLine: number): boolean {
  return startLine > 0 && endLine > 0
}

/** Human range: "line 12" or "lines 3–8". Empty when the range is unknown. */
export function formatPreviewLineRange(startLine: number, endLine: number): string {
  if (!hasKnownLineRange(startLine, endLine)) return ''
  if (startLine === endLine) return `line ${startLine}`
  return `lines ${startLine}–${endLine}`
}

/**
 * Chip / comment-card title. Prefer a real label when lines are unknown
 * (office DOM, media, ZIP) so we never show "paragraph · line 0".
 */
export function formatBlockPickLabel(block: {
  kind?: string
  id?: string
  label?: string
  startLine: number
  endLine: number
}): string {
  if (block.kind === 'line' || (block.id ?? '').startsWith('line-L')) {
    return block.startLine > 0 ? `line ${block.startLine}` : (block.label || 'line')
  }
  const range = formatPreviewLineRange(block.startLine, block.endLine)
  if (!range) return block.label || (block.kind || 'block').replace(/_/g, '-')
  if (block.label && !/line/i.test(block.label)) {
    return `${block.label} · ${range}`
  }
  const kind = (block.kind || 'block').replace(/_/g, '-')
  return `${kind} · ${range}`
}

/**
 * Hidden context block prepended to outbound user text so the model sees the
 * previewed selection. The bubble body stays user-typed only — this is the
 * counterpart to {@link ./quote.composeQuotedUserText} for file-preview refs.
 */
/** One selected preview block → a composer comment-block reference. */
export function blockToPreviewRef(
  sourcePath: string,
  badge: string,
  block: PreviewBlock
): PreviewRef {
  return {
    id: `${sourcePath}::${block.id}`,
    filePath: sourcePath,
    label: formatBlockPickLabel(block),
    startLine: block.startLine,
    endLine: block.endLine,
    text: block.text,
    badge
  }
}

export function formatPreviewContext(refs: PreviewRef[] | null | undefined): string {
  if (!refs || refs.length === 0) return ''
  const lines: string[] = ['## Selected context']
  for (const ref of refs) {
    const badge = ref.badge ? ` ${ref.badge}` : ''
    const label = ref.label ? ` · ${ref.label}` : ''
    const range = formatPreviewLineRange(ref.startLine, ref.endLine)
    const rangeSuffix = range ? ` · ${range}` : ''
    lines.push('')
    lines.push(`### ${ref.filePath}${badge}${label}${rangeSuffix}`)
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
