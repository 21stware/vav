import { useState } from 'react'
import { File, X } from 'lucide-react'
import { localFileStreamUrl } from '@shared/localFileUrl'
import { isFileMentionImage } from '../lib/filePathLinks'
import { openInApp } from '../lib/openInApp'
import { basename } from '../lib/path'

function isResolvablePath(path: string): boolean {
  return /^\/|^[A-Za-z]:[\\/]/.test(path) || path.startsWith('~/')
}

/** Compact [thumb + filename + optional ×]. Full path is the tooltip; click opens a preview. */
export function FileChip({
  path,
  className,
  onRemove,
  removeLabel
}: {
  path: string
  conversationId?: string | null
  className?: string
  onRemove?: () => void
  removeLabel?: string
}): React.JSX.Element {
  const name = basename(path) || path
  const image = isFileMentionImage(path) && isResolvablePath(path)
  const [imgFailed, setImgFailed] = useState(false)
  const showThumb = image && !imgFailed
  const closeLabel = removeLabel ?? 'Remove'

  return (
    <span className={`md-file-chip${className ? ` ${className}` : ''}`} title={path}>
      <button
        type="button"
        className="md-file-chip-hit"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void openInApp(path)
        }}
      >
        {showThumb ? (
          <img
            className="md-file-chip-thumb"
            src={localFileStreamUrl(path)}
            alt=""
            draggable={false}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="md-file-chip-icon">
            <File size={12} strokeWidth={2} aria-hidden />
          </span>
        )}
        <span className="md-file-chip-name">{name}</span>
      </button>
      {onRemove ? (
        <button
          type="button"
          className="md-file-chip-close"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }}
        >
          <X size={10} strokeWidth={2.5} aria-hidden />
        </button>
      ) : null}
    </span>
  )
}
