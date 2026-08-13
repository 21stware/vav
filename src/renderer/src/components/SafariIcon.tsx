/**
 * Browser glyph for “Open on the web”.
 * macOS: simplified Safari compass (stroke matches Lucide / Finder icon).
 * Windows / Linux: compass (Lucide).
 */

import { Compass } from 'lucide-react'
import { IS_MAC } from '../lib/platform'

export function SafariIcon({
  size = 14,
  className,
  strokeWidth = 2
}: {
  size?: number
  className?: string
  strokeWidth?: number
}): React.JSX.Element {
  if (!IS_MAC) {
    return <Compass size={size} strokeWidth={strokeWidth} className={className} aria-hidden />
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`safari-icon${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      {/* Safari needle — north-east diamond, same weight as Finder strokes. */}
      <path d="M16.3 7.7 13.9 13.9 7.7 16.3 10.1 10.1Z" />
    </svg>
  )
}
