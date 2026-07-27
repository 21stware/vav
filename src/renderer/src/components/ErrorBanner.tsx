import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui'
import { useT } from '../i18n/useT'

const LEAVE_MS = 180 // --dur-pop

/** Error strip with enter (@starting-style) + exit before dismiss. */
export function ErrorBanner({
  message,
  actionLabel,
  onAction,
  onDismiss
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const t = useT()
  const [leaving, setLeaving] = useState(false)

  const dismiss = (): void => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(onDismiss, LEAVE_MS)
  }

  return (
    <div className="banner error" data-leaving={leaving || undefined}>
      <span>{message}</span>
      <span className="spacer" />
      {actionLabel && onAction && <Button label={actionLabel} size="sm" onClick={onAction} />}
      <Button icon={<X size={12} />} size="sm" title={t('common.close')} onClick={dismiss} />
    </div>
  )
}
