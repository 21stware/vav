import { File } from 'lucide-react'
import { formatById, formatIdForPath } from '@shared/fileAssociationFormats'

/** In-app counterpart of the Finder / Explorer document icon. */
export function FileTypeIcon({
  id,
  size = 16
}: {
  id: string
  size?: number
}): React.JSX.Element | null {
  const format = formatById(id)
  if (!format) return null
  const fontSize = format.badge.length <= 2 ? 9.4 : format.badge.length === 3 ? 7.4 : 6
  const clipId = `fti-${id}`
  return (
    <span className="file-type-icon" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 32 32" width={size} height={size} focusable="false">
        <defs>
          <clipPath id={clipId}>
            <rect x="6.2" y="2.4" width="19.6" height="27.2" rx="4.2" />
          </clipPath>
        </defs>
        <rect x="6.2" y="2.4" width="19.6" height="27.2" rx="4.2" fill={format.color} />
        <g clipPath={`url(#${clipId})`}>
          <g
            fill="none"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="1.35"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(16 12.2) scale(1.55) translate(-15.2 -14.2)"
          >
            <path d="M11.4 11.6c.1-2 1.3-3.4 2.2-3.4" />
            <path d="M19.4 11.6c-.1-2-1.3-3.4-2.2-3.4" />
            <path d="M8.8 14.8h2.1M8.6 16.1h2.1M8.8 17.4h2.1" />
            <path d="M22 14.8h-2.1M22.2 16.1h-2.1M22 17.4h-2.1" />
            <path d="M12.8 17.8a2.6 2.6 0 1 1 2.4-2.5" />
            <path d="M18 13.4v4.8c0 .9.6 1.4 1.3 1.4" />
          </g>
        </g>
        <text
          x="16"
          y="26.8"
          textAnchor="middle"
          fill="#fff"
          fontSize={fontSize}
          fontWeight="700"
          fontFamily="ui-monospace, Menlo, 'SF Mono', monospace"
        >
          {format.badge}
        </text>
      </svg>
    </span>
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
