import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { tt } from '../i18n/useT'
import wordmark from '../assets/wordmark.png'
import wordmarkDark from '../assets/wordmark-dark.png'

/** Match --dur-pop so exit stays on-screen through the transition. */
const MODAL_LEAVE_MS = 180

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
  const tip = title ?? label
  return (
    <button
      type="button"
      className={classes}
      disabled={disabled}
      title={tip}
      aria-label={tip}
      onClick={onClick}
    >
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
  danger,
  muted,
  disabled,
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
  /** Error / missing path — red capsule (e.g. dir not exist). */
  danger?: boolean
  /** Still interactive, but no longer live (e.g. a terminal whose process exited). */
  muted?: boolean
  disabled?: boolean
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
    danger ? 'danger' : '',
    muted ? 'muted' : '',
    disabled ? 'is-disabled' : '',
    trailing ? 'has-trailing' : ''
  ]
    .filter(Boolean)
    .join(' ')

  if (!trailing) {
    return (
      <button
        type="button"
        className={classes}
        title={title ?? label}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
        onContextMenu={disabled ? undefined : onContextMenu}
      >
        {icon}
        <span className="chip-label">{label}</span>
      </button>
    )
  }

  return (
    <div
      className={classes}
      title={title ?? label}
      onContextMenu={disabled ? undefined : onContextMenu}
    >
      <button
        type="button"
        className="chip-main"
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
      >
        {icon}
        <span className="chip-label">{label}</span>
      </button>
      {onAction && (
        <button
          type="button"
          className="chip-action"
          title={actionTitle}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            if (!disabled) onAction()
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
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            if (!disabled) onClose()
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
  onChange,
  title
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title?: string
}): React.JSX.Element {
  return (
    <button
      className={`toggle${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      title={title}
      aria-label={title}
      onClick={() => onChange(!checked)}
    />
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string; title?: string }[]
  value: T
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'active' : ''}
          title={option.title ?? option.label}
          aria-label={option.title ?? option.label}
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
        <span className="empty-logo" role="img" aria-label="VAV">
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
  /** Receives animated dismiss so action buttons share the exit path. */
  actions: (dismiss: () => void) => ReactNode
  onDismiss: () => void
}): React.JSX.Element {
  const [leaving, setLeaving] = useState(false)
  const leavingRef = useRef(false)
  const leaveTimer = useRef<number | null>(null)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const dismiss = (): void => {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      onDismissRef.current()
    }, MODAL_LEAVE_MS)
  }

  useEffect(() => {
    return () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="scrim center"
      data-leaving={leaving || undefined}
      onMouseDown={dismiss}
    >
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions(dismiss)}</div>
      </div>
    </div>
  )
}

