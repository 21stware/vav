import { findFilePathMentions } from '@shared/filePathMentions'
import { FileChip } from './FileChip'

/** Plain text with file-path mentions painted as thumbnail chips. */
export function PathRichText({
  text,
  conversationId
}: {
  text: string
  conversationId?: string | null
}): React.JSX.Element {
  const mentions = findFilePathMentions(text)
  if (mentions.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let last = 0
  mentions.forEach((mention, index) => {
    if (mention.index > last) {
      parts.push(text.slice(last, mention.index))
    }
    parts.push(
      <FileChip key={`${mention.index}-${index}`} path={mention.path} conversationId={conversationId} />
    )
    last = mention.index + mention.raw.length
  })
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
