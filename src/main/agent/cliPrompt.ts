import { formatAppColumnSendContext, type AppColumnFocus } from '../../shared/appColumnFocus.ts'
import type { PreviewRef } from '../../shared/types.ts'

export function composeCliPrompt(
  text: string,
  contextBlocks?: PreviewRef[] | null,
  attachments?: string[],
  contextFile?: string | null,
  fileReadOnly = false,
  omitAttachmentPaths = false,
  appFocus?: AppColumnFocus | null
): string {
  const parts: string[] = []
  const app = formatAppColumnSendContext(appFocus)
  if (app) parts.push(app)
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
  parts.push(text)
  return parts.join('\n\n')
}
