/**
 * Platform file-manager glyph for “Reveal in Finder / Explorer”.
 * macOS: outline Finder face (stroke, matches Lucide toolbar icons).
 * Windows / Linux: open-folder (Lucide).
 */

import { FolderOpen } from 'lucide-react'
import { IS_MAC } from '../lib/platform'

export function FileManagerIcon({
  size = 14,
  className,
  strokeWidth = 2
}: {
  size?: number
  className?: string
  strokeWidth?: number
}): React.JSX.Element {
  if (!IS_MAC) {
    return <FolderOpen size={size} strokeWidth={strokeWidth} className={className} aria-hidden />
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
      className={`file-manager-icon${className ? ` ${className}` : ''}`}
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 3v18" />
      <circle cx="8.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <path d="M6.8 14.2c1.1 1.4 2.4 2.1 3.7 2.1" />
      <path d="M17.2 14.2c-1.1 1.4-2.4 2.1-3.7 2.1" />
    </svg>
  )
}
