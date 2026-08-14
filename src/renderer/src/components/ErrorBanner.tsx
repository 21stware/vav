import { useState } from 'react'
import { X } from 'lucide-react'
import { Button, Modal } from './ui'
import { useT } from '../i18n/useT'

const LEAVE_MS = 180 // --dur-pop

export function ErrorDetailModal({
  detail,
  onDismiss
}: {
  detail: string
  onDismiss: () => void
}): React.JSX.Element {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard.writeText(detail).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    })
  }

  return (
    <Modal
      title={t('error.detailTitle')}
      onDismiss={onDismiss}
      actions={(dismiss) => (
        <>
          <Button label={copied ? t('common.copied') : t('common.copy')} size="sm" onClick={copy} />
          <Button label={t('common.close')} size="sm" variant="primary" onClick={dismiss} />
        </>
      )}
    >
      <pre className="error-detail-pre">{detail}</pre>
    </Modal>
  )
}

/** Error strip with enter (@starting-style) + exit before dismiss. */
export function ErrorBanner({
  message,
  detail,
  actionLabel,
  onAction,
  onDismiss
}: {
  message: string
  detail?: string | null
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const t = useT()
  const [leaving, setLeaving] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const detailText = (detail ?? message).trim()

  const dismiss = (): void => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(onDismiss, LEAVE_MS)
  }

  return (
    <>
      <div className="banner error" data-leaving={leaving || undefined}>
        <span>{message}</span>
        <span className="spacer" />
        {actionLabel && onAction && <Button label={actionLabel} size="sm" onClick={onAction} />}
        {detailText ? (
          <Button label={t('error.viewDetail')} size="sm" onClick={() => setDetailOpen(true)} />
        ) : null}
        <Button icon={<X size={12} />} size="sm" title={t('common.close')} onClick={dismiss} />
      </div>
      {detailOpen ? (
        <ErrorDetailModal detail={detailText} onDismiss={() => setDetailOpen(false)} />
      ) : null}
    </>
  )
}
