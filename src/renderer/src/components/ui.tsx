import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { X } from 'lucide-react'
import { tt } from '../i18n/useT'
import { entranceStarted, markEntranceStarted } from '../lib/emptyEntrance'
import wordmark from '../assets/wordmark.png'
import wordmarkDark from '../assets/wordmark-dark.png'

/** Match --dur-pop so exit stays on-screen through the transition. */
const MODAL_LEAVE_MS = 180

/** Empty-state entrance budget — long enough for a full prose stagger. */
const EMPTY_ENTER_MS = 1800

/**
 * Ceiling on waiting for async empty-session copy before playing without it.
 */
const EMPTY_COPY_HOLD_MS = 300

/** Ceiling on waiting for a reveal, in case the flag is never cleared. */
const EMPTY_REVEAL_HOLD_MS = 1200

/**
 * Main sets this while a hidden window paints the frame it is about to reveal,
 * and clears it once the window is on screen. A build-up started now would be
 * spent off-screen, so the run waits it out.
 */
function isWindowRevealing(): boolean {
  return document.documentElement.dataset.revealing === '1'
}

function prefersNoMotion(): boolean {
  return document.documentElement.dataset.reduceMotion === 'true'
}

type EntranceRun = {
  slot: string
  scene: string
  /** This scene gets a build-up at all (first visit, motion enabled). */
  play: boolean
  /** Copy is in and the window is on screen: `.is-entering` may go on. */
  armed: boolean
  /** Wall clock ceiling for holding an unarmed run. */
  holdUntil: number
}

function startRun(slot: string, scene: string): EntranceRun {
  const play = !entranceStarted(slot, scene) && !prefersNoMotion()
  return {
    slot,
    scene,
    play,
    // Nothing to wait for when there is no build-up — stay out of the hold.
    armed: !play,
    holdUntil: performance.now() + EMPTY_COPY_HOLD_MS
  }
}

/**
 * One build-up per scene: armed on the frame the whole stack is ready, ended
 * once, and never restarted — not by a remount, not by late copy, not by a
 * reveal. `holding` means the stack is not paintable yet; the caller must keep
 * it invisible, because a rest frame followed by `empty-in` reads as a flash of
 * finished content that then rewinds.
 */
function useEntranceRun(
  slot: string,
  scene: string,
  hold: boolean
): { entering: boolean; holding: boolean } {
  const [run, setRun] = useState(() => startRun(slot, scene))

  // Decided in render, not after paint: the first committed style must already
  // be `empty-in` + backwards, or the rest state shows for a frame.
  // Slot is per conversation — `empty#1::vendor` repeats on every new session
  // of the same host, and must not reuse the previous session's spent run.
  if (run.scene !== scene || run.slot !== slot) setRun(startRun(slot, scene))

  useLayoutEffect(() => {
    markEntranceStarted(slot, scene)
  }, [slot, scene])

  useLayoutEffect(() => {
    if (!run.play || run.armed || run.scene !== scene) return
    const arm = (): void =>
      setRun((r) => (r.scene === scene && !r.armed ? { ...r, armed: true } : r))
    const revealing = isWindowRevealing()
    if (!hold && !revealing) {
      arm()
      return
    }
    const deadline = revealing
      ? EMPTY_REVEAL_HOLD_MS
      : Math.max(0, run.holdUntil - performance.now())
    const cap = window.setTimeout(arm, deadline)
    const observer = new MutationObserver(() => {
      if (isWindowRevealing()) return
      if (!hold) {
        arm()
        return
      }
      // On screen now: give the copy its full grace from here, not from a
      // budget that was spent while the window was still hidden.
      setRun((r) =>
        r.scene === scene && !r.armed
          ? { ...r, holdUntil: performance.now() + EMPTY_COPY_HOLD_MS }
          : r
      )
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-revealing']
    })
    return () => {
      window.clearTimeout(cap)
      observer.disconnect()
    }
  }, [run.play, run.armed, run.holdUntil, run.scene, scene, hold])

  useEffect(() => {
    if (!run.play || !run.armed || run.scene !== scene) return
    const stop = window.setTimeout(
      () => setRun((r) => (r.scene === scene ? { ...r, play: false } : r)),
      EMPTY_ENTER_MS
    )
    // The window went off-screen mid-build-up (a reveal is being prepared, e.g.
    // the app booting behind a hidden window). Re-queue instead of burning the
    // run on frames nobody sees: it plays once, on screen.
    const observer = new MutationObserver(() => {
      if (!isWindowRevealing()) return
      setRun((r) =>
        r.scene === scene && r.armed
          ? { ...r, armed: false, holdUntil: performance.now() + EMPTY_COPY_HOLD_MS }
          : r
      )
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-revealing']
    })
    return () => {
      window.clearTimeout(stop)
      observer.disconnect()
    }
  }, [run.play, run.armed, run.scene, scene])

  const live = run.scene === scene && run.play
  return { entering: live && run.armed, holding: live && !run.armed }
}

type EmptyEntranceValue = {
  /** Scene id — children key their stagger off it so a new visit remounts it. */
  scene: string
  /** `.is-entering` is live: children mounted now belong to this run. */
  entering: boolean
  /** Async copy reports itself in, so the run starts with the stack complete. */
  setCopyReady: (ready: boolean) => void
}

const EmptyEntranceContext = createContext<EmptyEntranceValue | null>(null)

/**
 * Supporting copy that arrives after mount (git status). Holds the entrance
 * until it is in and then rides the same run — logo, name and prose build up
 * as one stack instead of the hero playing and the prose entering after it.
 */
export function useEmptyEntranceCopy(ready: boolean): {
  entering: boolean
  motionKey: string | null
} {
  const entrance = useContext(EmptyEntranceContext)
  const setCopyReady = entrance?.setCopyReady
  const scene = entrance?.scene ?? null

  // Layout effect: reporting after paint would spend a frame with the stack
  // held back even when the copy was already there.
  useLayoutEffect(() => {
    setCopyReady?.(ready)
  }, [setCopyReady, ready, scene])

  return { entering: entrance?.entering ?? false, motionKey: scene }
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
  testId,
  onClick
}: {
  label?: string
  icon?: ReactNode
  variant?: ButtonVariant
  size?: 'sm'
  disabled?: boolean
  title?: string
  className?: string
  testId?: string
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
      data-testid={testId}
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
          data-testid="chip-action"
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
  title,
  testId
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title?: string
  testId?: string
}): React.JSX.Element {
  return (
    <button
      className={`toggle${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      title={title}
      aria-label={title}
      data-testid={testId}
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
          data-testid={`segment-${option.value}`}
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

function EmptyAgentName({
  text,
  title,
  onClick
}: {
  text: string
  title?: string
  onClick?: (el: HTMLElement) => void
}): React.JSX.Element {
  return (
    <div
      className="empty-agent-name"
      aria-label={text}
      title={title}
      data-testid={onClick ? 'empty-workspace-name' : undefined}
      onClick={onClick ? (event) => onClick(event.currentTarget) : undefined}
    >
      <StaggerLine baseDelay={48}>{text}</StaggerLine>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  logo,
  logoLabel,
  logoAlt,
  logoTitle,
  logoLabelOnClick,
  logoKey,
  enterKey,
  enterSlot,
  layout = 'centered',
  meta,
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
  /** Accessible name for the mark when {@link logoLabel} is a workspace title. */
  logoAlt?: string
  logoTitle?: string
  /** Same box as the name — do not wrap or reclass it, or empty-in cancels. */
  logoLabelOnClick?: (el: HTMLElement) => void
  /**
   * When this changes with {@link enterKey}, the empty hero plays once.
   * Identity is the host id, not the label — same name on a new session still
   * staggers.
   */
  logoKey?: string
  /**
   * Scene id (session empty view). Combined with {@link logoKey}. Must carry the
   * visit, not just the session id: git load and layout remounts may not mint a
   * new scene, but returning to a conversation must.
   */
  enterKey?: string
  /**
   * Entrance bookkeeping slot. Each live empty transcript needs its own —
   * a shared `session` slot lets sibling Swarm panes steal the run and
   * replay the build-up on every focus.
   */
  enterSlot?: string
  /**
   * `session` — hero (logo + name + optional foot) centered in the transcript.
   * `centered` — classic stacked empty state.
   */
  layout?: 'centered' | 'session'
  /** Quiet facts under the mark (subscription usage). */
  meta?: ReactNode
  /** Supporting chrome under the mark (e.g. workspace / git prose). */
  foot?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  // Panel empty states share one slot and one scene: they greet you once per
  // window, and tab / filter remounts are not visits.
  const session = layout === 'session'
  const slot = session ? (enterSlot?.trim() || 'session') : 'panel'
  const motionKey = session ? `${enterKey ?? 'empty'}::${logoKey ?? ''}` : 'panel'

  // Pessimistic: a foot means copy we do not have yet (git status), so hold the
  // run until it reports in rather than play the hero and trail the prose.
  const needCopy = session && !!foot
  const [copy, setCopy] = useState({ scene: motionKey, ready: !needCopy })
  if (copy.scene !== motionKey) setCopy({ scene: motionKey, ready: !needCopy })
  const setCopyReady = useCallback(
    (ready: boolean) => setCopy((c) => (c.ready === ready ? c : { ...c, ready })),
    []
  )

  const copyReady = copy.scene === motionKey ? copy.ready : !needCopy
  const { entering, holding } = useEntranceRun(slot, motionKey, needCopy && !copyReady)
  const entrance = useMemo<EmptyEntranceValue>(
    () => ({ scene: motionKey, entering, setCopyReady }),
    [motionKey, entering]
  )

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
        <span className="empty-logo" role="img" aria-label={logoAlt ?? logoLabel ?? 'VAV'}>
          <span className="empty-logo-mark">{logoNode}</span>
        </span>
      )}
      {logoLabel ? (
        <EmptyAgentName
          key={motionKey}
          text={logoLabel}
          title={logoTitle}
          onClick={logoLabelOnClick}
        />
      ) : null}
      {meta}
      {title ? <div className="empty-title">{title}</div> : null}
      {description ? (
        session ? (
          <div className="empty-desc empty-harness" aria-label={description}>
            <StaggerLine baseDelay={120}>{description}</StaggerLine>
          </div>
        ) : (
          <div className="empty-desc">{description}</div>
        )
      ) : null}
      {children}
      {foot ? <div className="empty-state-foot">{foot}</div> : null}
    </>
  )

  const rootClass = [
    'empty-state',
    session ? 'empty-state-session' : '',
    entering ? 'is-entering' : '',
    holding ? 'is-holding' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <EmptyEntranceContext.Provider value={entrance}>
      <div className={rootClass} data-testid="empty-state">
        {session ? <div className="empty-state-hero">{hero}</div> : hero}
      </div>
    </EmptyEntranceContext.Provider>
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

