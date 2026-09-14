import { isImageAttachmentPath } from '@shared/agentImageInput'
import { useT } from '../i18n/useT'
import { FileChip } from './FileChip'

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
  const showHint = !imageInputSupported && images.length > 0

  return (
    <div className={`attachments${showHint ? ' is-unsupported' : ''}`}>
      {showHint ? (
        <p className="attachment-image-hint">{t('composer.imageInputUnsupported')}</p>
      ) : null}
      <div className="attachments-row">
        {paths.map((path) => (
          <AttachmentTile
            key={path}
            path={path}
            conversationId={conversationId}
            onRemove={() => onRemove(path)}
          />
        ))}
      </div>
    </div>
  )
}

export function AttachmentTile({
  path,
  conversationId,
  onRemove
}: {
  path: string
  conversationId?: string
  onRemove?: () => void
}): React.JSX.Element {
  const t = useT()
  const image = isImageAttachmentPath(path)

  return (
    <FileChip
      path={path}
      conversationId={conversationId}
      onRemove={onRemove}
      removeLabel={image ? t('composer.removeImage') : t('composer.removeAttachment')}
    />
  )
}
