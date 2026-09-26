import { useMemo } from 'react'
import { File } from 'lucide-react'
import { formatById, formatIdForPath } from '@shared/fileAssociationFormats'
import { fileTypeIconSvg } from '@shared/fileTypeIconSvg'

/** In-app counterpart of the Finder / Explorer document icon (same artwork). */
export function FileTypeIcon({
  id,
  size = 16
}: {
  id: string
  size?: number
}): React.JSX.Element | null {
  const format = formatById(id)
  // Markup is built from the static format catalog only — no user text.
  const html = useMemo(() => (format ? fileTypeIconSvg(format, size) : ''), [format, size])
  if (!format) return null
  return (
    <span
      className="file-type-icon"
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Type plate when the path is a registered format; generic file mark otherwise. */
export function FileKindMark({
  path,
  size = 16,
  strokeWidth = 1.75
}: {
  path: string
  size?: number
  strokeWidth?: number
}): React.JSX.Element {
  const id = formatIdForPath(path)
  if (id) return <FileTypeIcon id={id} size={size} />
  return <File size={size} strokeWidth={strokeWidth} aria-hidden />
}
