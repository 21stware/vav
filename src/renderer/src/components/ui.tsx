import { useEffect, type ReactNode } from 'react'
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
  onClick
}: {
  label?: string
  icon?: ReactNode
  variant?: ButtonVariant
  size?: 'sm'
  disabled?: boolean
  title?: string
  onClick?: (event: React.MouseEvent) => void
}): React.JSX.Element {
  const classes = ['btn', variant, size, !label && icon ? 'icon-only' : '']
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
  title,
  onClick,
  onContextMenu
}: {
  label: string
  icon?: ReactNode
  active?: boolean
  title?: string
  onClick?: () => void
  onContextMenu?: (event: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <button
      className={`chip${active ? ' active' : ''}`}
      title={title ?? label}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {icon}
      <span className="chip-label">{label}</span>
    </button>
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

export function InlineAlert({
  kind,
  title,
  message
}: {
  kind: 'info' | 'warning' | 'error' | 'success'
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

