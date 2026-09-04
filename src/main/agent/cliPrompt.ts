import type { PreviewRef, QuoteDraft } from '../../shared/types.ts'

export function composeCliPrompt(
  text: string,
  quote?: QuoteDraft | null,
  contextBlocks?: PreviewRef[] | null,
  attachments?: string[],
  contextFile?: string | null,
  fileReadOnly = false,
  omitAttachmentPaths = false
): string {
  const parts: string[] = []
  if (contextFile) {
    parts.push(
      fileReadOnly ? `[Open file — read only]\n${contextFile}` : `[Open file]\n${contextFile}`
    )
  }
  if (contextBlocks?.length) {
    for (const ref of contextBlocks) {
      parts.push(
        `[Selection ${ref.filePath}:${ref.startLine}-${ref.endLine}]\n${ref.text}${
          ref.comment ? `\n(comment: ${ref.comment})` : ''
        }`
      )
    }
  }
  if (attachments?.length && !omitAttachmentPaths) {
    parts.push(`[Attachments]\n${attachments.map((a) => `- ${a}`).join('\n')}`)
  }
  if (quote?.summary) {
    parts.push(`[Quoted ${quote.role} message]\n${quote.summary}`)
  }
  parts.push(text)
  return parts.join('\n\n')
}
