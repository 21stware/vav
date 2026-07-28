import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { tt } from '../i18n/useT'
import wordmark from '../assets/wordmark.png'
import wordmarkDark from '../assets/wordmark-dark.png'

type ButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger'

export function Button({
  label,
  icon,
  variant = 'ghost',
  size,
  disabled,
  title,
  className,
  onClick
}: {
  label?: string
  icon?: ReactNode
  variant?: ButtonVariant
  size?: 'sm'
  disabled?: boolean
  title?: string
  className?: string
  onClick?: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const classes = ['btn', variant, size, !label && icon ? 'icon-only' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={classes} disabled={disabled} title={title ?? label} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

export function Chip({
  label,
  icon,
  active,
  emphasis,
  title,
  onClick,
  onContextMenu,
  onClose,
  closeTitle,
  onAction,
  actionIcon,
  actionTitle
}: {
  label: string
  icon?: ReactNode
  active?: boolean
  /** Tints the glyph (e.g. agent shell tab). */
  emphasis?: boolean
  title?: string
  onClick?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  /** When set, a permanent close control sits inside the capsule. */
  onClose?: () => void
  closeTitle?: string
  /**
   * Optional trailing action inside the capsule (e.g. change workspace).
   * Kept separate from `onClick` so accordion / select do not fight it.
   */
  onAction?: () => void
  actionIcon?: ReactNode
  actionTitle?: string
}): React.JSX.Element {
  const resolvedCloseTitle = closeTitle ?? tt('common.close')
  const trailing = Boolean(onClose || onAction)
  const classes = [
    'chip',
    active ? 'active' : '',
    emphasis ? 'emphasis' : '',
    trailing ? 'has-trailing' : ''
  ]
    .filter(Boolean)
    .join(' ')

  if (!trailing) {
    return (
      <button
        className={classes}
        title={title ?? label}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {icon}
        <span className="chip-label">{label}</span>
      </button>
    )
  }

  return (
    <div className={classes} title={title ?? label} onContextMenu={onContextMenu}>
      <button type="button" className="chip-main" onClick={onClick}>
        {icon}
        <span className="chip-label">{label}</span>
      </button>
      {onAction && (
        <button
          type="button"
          className="chip-action"
          title={actionTitle}
          onClick={(event) => {
            event.stopPropagation()
            onAction()
          }}
        >
          {actionIcon}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className="chip-close"
          title={resolvedCloseTitle}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

export function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <button
      className={`toggle${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    />
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  logo,
  children
}: {
  title: string
  description?: string
  /** The blank transcript is where the app can say its own name. */
  logo?: boolean
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty-state">
      {logo && (
        /* Both variants ship; CSS picks one so no theme state is needed here. */
        <span className="empty-logo" role="img" aria-label="vav">
          <img className="logo-light" src={wordmark} alt="" />
          <img className="logo-dark" src={wordmarkDark} alt="" />
        </span>
      )}
      <div className="empty-title">{title}</div>
      {description && <div className="empty-desc">{description}</div>}
      {children}
    </div>
  )
}

/**
 * One fact, once.
 *
 * `title` is only for the case where the body is text we did not write — an
 * errno, a provider's rejection — and needs a line naming what failed. Anything
 * we phrased ourselves is already a sentence and gets no heading: a bold line
 * above a sentence that restates it is two thirds of a screen saying nothing,
 * and `kind` has already carried the severity.
 */
export function InlineAlert({
  kind,
  title,
  message
}: {
  kind: 'warning' | 'error' | 'success'
  title?: string
  message: string
}): React.JSX.Element {
  return (
    <div className={`inline-alert ${kind}`}>
      <div>
        {title && <div className="alert-title">{title}</div>}
        <div>{message}</div>
      </div>
    </div>
  )
}

export function Modal({
  title,
  children,
  actions,
  onDismiss
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  onDismiss: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div className="scrim center" onMouseDown={onDismiss}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  )
}

