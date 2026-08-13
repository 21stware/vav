import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { X } from 'lucide-react'
import { tt } from '../i18n/useT'
import wordmark from '../assets/wordmark.png'
import wordmarkDark from '../assets/wordmark-dark.png'

/** Match --dur-pop so exit stays on-screen through the transition. */
const MODAL_LEAVE_MS = 180

/** Empty-state entrance budget — long enough for a full prose stagger. */
const EMPTY_ENTER_MS = 1800

/** Scenes that already started an entrance. Claimed after first paint. */
const emptyPlayedScenes = new Set<string>()

/**
 * One `.is-entering` per session+host. Arm in layout (before paint) so the
 * name does not flash, then claim in a passive effect so Strict Mode's extra
 * layout pass cannot drop the class and restart stagger.
 */
function useEmptyEntering(enterKey: string, logoKey: string): boolean {
  const scene = `${enterKey}::${logoKey}`
  const [entering, setEntering] = useState(false)

  useLayoutEffect(() => {
    if (emptyPlayedScenes.has(scene)) {
      setEntering(false)
      return
    }
    setEntering(true)
  }, [scene])

  useEffect(() => {
    if (!entering) return
    emptyPlayedScenes.add(scene)
    const stop = window.setTimeout(() => setEntering(false), EMPTY_ENTER_MS)
    return () => window.clearTimeout(stop)
  }, [entering, scene])

  return entering
}

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
  options: { value: T; label: string; title?: string; icon?: ReactNode }[]
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
          {option.icon ? <span className="segmented-icon">{option.icon}</span> : null}
          <span className="segmented-label">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Word units when spaced; Unicode chars for CJK / unspaced strings. */
function splitNameUnits(text: string): string[] {
  if (/\s/.test(text)) return text.split(/(\s+)/).filter((s) => s.length > 0)
  return Array.from(text)
}

function staggerNode(node: ReactNode, step: { i: number }, baseDelay: number): ReactNode {
  return Children.map(node, (child, idx) => {
    if (child == null || typeof child === 'boolean') return child
    if (typeof child === 'string' || typeof child === 'number') {
      return splitNameUnits(String(child)).map((unit, u) => {
        if (unit === '' || /^\s+$/.test(unit)) {
          return (
            <Fragment key={`s${idx}-${u}`}>
              {unit}
            </Fragment>
          )
        }
        const i = step.i++
        return (
          <span
            key={`w${idx}-${u}`}
            className="empty-stagger-unit"
            style={{ animationDelay: `${baseDelay + i * 28}ms` }}
          >
            {unit}
          </span>
        )
      })
    }
    if (isValidElement(child)) {
      const nested = (child.props as { children?: ReactNode }).children
      if (nested == null || nested === false) {
        const i = step.i++
        return (
          <span
            key={child.key ?? `e${idx}`}
            className="empty-stagger-unit"
            style={{ animationDelay: `${baseDelay + i * 28}ms` }}
          >
            {child}
          </span>
        )
      }
      return cloneElement(child, { key: child.key ?? idx }, staggerNode(nested, step, baseDelay))
    }
    return child
  })
}

/** Split a line into stagger units (words, CJK chars, or leaf elements). */
export function StaggerLine({
  children,
  baseDelay = 0
}: {
  children: ReactNode
  baseDelay?: number
}): React.JSX.Element {
  return <>{staggerNode(children, { i: 0 }, baseDelay)}</>
}

function EmptyAgentName({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="empty-agent-name" aria-label={text}>
      <StaggerLine baseDelay={48}>{text}</StaggerLine>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  logo,
  logoLabel,
  logoKey,
  enterKey,
  layout = 'centered',
  foot,
  children
}: {
  /** Omit for session hero (logo + agent name only). */
  title?: string
  description?: string
  /**
   * Blank-transcript mark. `true` = VAV wordmark; pass a node (e.g. agent
   * brand) so the empty state tracks the active host.
   */
  logo?: boolean | ReactNode
  /** Agent / product name under the mark — staggered on change. */
  logoLabel?: string
  /**
   * When this changes with {@link enterKey}, the empty hero plays once.
   * Identity is the host id, not the label — same name on a new session still
   * staggers.
   */
  logoKey?: string
  /**
   * Scene id (session empty view). Combined with {@link logoKey}. Git load and
   * layout remounts must not mint a new scene.
   */
  enterKey?: string
  /**
   * `session` — hero (logo + name + optional foot) centered in the transcript.
   * `centered` — classic stacked empty state.
   */
  layout?: 'centered' | 'session'
  /** Supporting chrome under the mark (e.g. workspace / git prose). */
  foot?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  const entering = useEmptyEntering(enterKey ?? 'empty', logoKey ?? '')
  const motionKey = `${enterKey ?? 'empty'}::${logoKey ?? ''}`

  const logoNode =
    logo === true ? (
      <>
        <img className="logo-light" src={wordmark} alt="" />
        <img className="logo-dark" src={wordmarkDark} alt="" />
      </>
    ) : logo ? (
      logo
    ) : null

  const hero = (
    <>
      {logoNode && (
        <span className="empty-logo" role="img" aria-label={logoLabel ?? 'VAV'}>
          <span className="empty-logo-mark">{logoNode}</span>
        </span>
      )}
      {logoLabel ? <EmptyAgentName key={motionKey} text={logoLabel} /> : null}
      {title ? <div className="empty-title">{title}</div> : null}
      {description && <div className="empty-desc">{description}</div>}
      {children}
      {foot ? <div className="empty-state-foot">{foot}</div> : null}
    </>
  )

  const rootClass =
    layout === 'session'
      ? `empty-state empty-state-session${entering ? ' is-entering' : ''}`
      : `empty-state${entering ? ' is-entering' : ''}`

  if (layout === 'session') {
    return (
      <div className={rootClass}>
        <div className="empty-state-hero">{hero}</div>
      </div>
    )
  }

  return <div className={rootClass}>{hero}</div>
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

