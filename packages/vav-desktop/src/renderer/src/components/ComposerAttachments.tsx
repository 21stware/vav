import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  X
} from 'lucide-react'
import { localFileStreamUrl } from '@shared/localFileUrl'
import { isImageAttachmentPath } from '@shared/agentImageInput'
import {
  attachmentExtLabel,
  attachmentKindFromPath,
  type AttachmentKind
} from '@shared/attachmentKind'
import { basename } from '../lib/path'
import { openAttachmentPreview, openConversationFile } from '../lib/openSessionFile'
import { useT } from '../i18n/useT'

const KIND_ICON: Record<Exclude<AttachmentKind, 'image'>, typeof FileText> = {
  pdf: FileText,
  doc: FileText,
  sheet: FileSpreadsheet,
  slide: Presentation,
  code: FileCode,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  text: FileText,
  file: File
}

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
  const kind = attachmentKindFromPath(path)
  const Icon = kind === 'image' ? FileText : KIND_ICON[kind]
  const name = basename(path)
  const open = (): void => {
    if (image) openAttachmentPreview(path, conversationId)
    else if (conversationId) openAttachmentPreview(path, conversationId)
    else openConversationFile(path)
  }

  return (
    <span className="attachment-image-chip" title={path}>
      <button
        type="button"
        className="attachment-image-thumb"
        title={image ? t('composer.previewImage') : t('composer.previewFile')}
        aria-label={image ? t('composer.previewImage') : t('composer.previewFile')}
        onClick={open}
      >
        {image ? (
          <img src={localFileStreamUrl(path)} alt="" draggable={false} />
        ) : (
          <span className="attachment-file-tile" data-kind={kind}>
            <span className="attachment-file-ext">{attachmentExtLabel(path)}</span>
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            <span className="attachment-file-name">{name}</span>
          </span>
        )}
      </button>
      {onRemove ? (
        <button
          type="button"
          className="btn icon-only sm attachment-image-remove"
          title={image ? t('composer.removeImage') : t('composer.removeAttachment')}
          aria-label={image ? t('composer.removeImage') : t('composer.removeAttachment')}
          onClick={onRemove}
        >
          <X size={10} />
        </button>
      ) : null}
    </span>
  )
}
