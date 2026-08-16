import { Paperclip, X } from 'lucide-react'
import { localFileStreamUrl } from '@shared/localFileUrl'
import { isImageAttachmentPath } from '@shared/agentImageInput'
import { basename } from '../lib/path'
import { openAttachmentPreview } from '../lib/openSessionFile'
import { useT } from '../i18n/useT'

export function ComposerAttachments({
  paths,
  conversationId,
  imageInputSupported,
  onRemove
}: {
  paths: string[]
  conversationId: string
  imageInputSupported: boolean
  onRemove: (path: string) => void
}): React.JSX.Element | null {
  const t = useT()
  if (paths.length === 0) return null

  const images = paths.filter((path) => isImageAttachmentPath(path))
  const files = paths.filter((path) => !isImageAttachmentPath(path))
  const showHint = !imageInputSupported && images.length > 0

  return (
    <div className={`attachments${showHint ? ' is-unsupported' : ''}`}>
      {showHint ? (
        <p className="attachment-image-hint">{t('composer.imageInputUnsupported')}</p>
      ) : null}
      <div className="attachments-row">
        {images.map((path) => (
          <span className="attachment-image-chip" key={path}>
            <button
              type="button"
              className="attachment-image-thumb"
              title={t('composer.previewImage')}
              aria-label={t('composer.previewImage')}
              onClick={() => openAttachmentPreview(path, conversationId)}
            >
              <img src={localFileStreamUrl(path)} alt="" draggable={false} />
            </button>
            <button
              type="button"
              className="btn icon-only sm attachment-image-remove"
              title={t('composer.removeImage')}
              aria-label={t('composer.removeImage')}
              onClick={() => onRemove(path)}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {files.map((path) => (
          <span className="chip" key={path} title={path}>
            <Paperclip size={11} />
            <span className="chip-label">{basename(path)}</span>
            <button
              type="button"
              className="btn icon-only sm"
              style={{ width: 16, height: 16 }}
              title={t('composer.removeAttachment')}
              aria-label={t('composer.removeAttachment')}
              onClick={() => onRemove(path)}
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
