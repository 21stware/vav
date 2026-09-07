/**
 * Platform file-manager glyph for “Reveal in Finder / Explorer”.
 * macOS: simplified Finder face (from brand SVG, stroke matches Lucide weight).
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
      <rect x="2" y="2" width="20" height="20" rx="4.3" />
      {/* Face seam + notch (Finder smile channel). */}
      <polyline points="11.8 2 12 9.6 8.8 14.4 12 14.4 11.8 21.5" />
      <path d="M6.1 16.1c1.2 1.5 2.6 2.3 4 2.3" />
      <path d="M17.9 16.1c-1.2 1.5-2.6 2.3-4 2.3" />
      {/* Eyes as short strokes (not filled dots). */}
      <path d="M8.1 6.4v1.5" />
      <path d="M15.9 6.4v1.5" />
    </svg>
  )
}
