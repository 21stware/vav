/**
 * MentionBox — a robust @-mention text field.
 *
 * Architecture (see the conversation that led here):
 *   • A native <textarea> owns all editing: caret, selection, IME/composition,
 *     undo, scrolling. This is the reliable half that hand-rolled contenteditable
 *     or "custom caret" editors get wrong.
 *   • A CSS mirror (`.mention-box-highlights`) renders the same text with mention
 *     runs styled as chips. Because it shares the textarea's font, padding,
 *     white-space and wrapping, it lines up glyph-for-glyph with zero fragile
 *     measurement. The textarea's text is transparent; caret + selection show
 *     through on top.
 *   • The suggestion popover is anchored to the caret via `@chenglou/pretext`,
 *     which computes caret pixel coordinates without a layout reflow.
 *
 * All the correctness-critical string math (pretext/active-mention detection,
 * full-span replacement, atomic delete/nav) lives in ./mentionModel and is unit
 * tested.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import {
  applyMention,
  atomicBackspace,
  atomicCaretTarget,
  atomicDelete,
  findMentions,
  getActiveMention,
  mentionSpanEnd,
  segmentText,
  type ActiveMention,
  type MentionOptions
} from './mentionModel'
import { caretPoint, readMetrics, type CaretPoint } from './pretextMeasure'

export type MentionItem = {
  /** Stable id for keys / aria. */
  id: string
  /** Display label shown in the popover and used to build the inserted text. */
  label: string
  /** Exact text inserted into the field. Defaults to `trigger + label`. */
  insert?: string
  /** Optional secondary line in the popover row. */
  detail?: string
  /** Optional leading glyph. */
  icon?: ReactNode
  /** When true the row is shown but not selectable (e.g. a disabled reason). */
  disabled?: boolean
}

export type MentionBoxHandle = {
  /** The underlying textarea, for focus / selection from a parent. */
  textarea: HTMLTextAreaElement | null
  focus: () => void
  /** Replace the current selection with `text` (used to drop inline pills). */
  insertText: (text: string) => void
}

export type MentionPill = { start: number; end: number; name: string; kind?: string }

export type MentionBoxProps = {
  value: string
  onChange: (value: string) => void
  /**
   * Resolve candidates for a query (text after the trigger), rendered in the
   * built-in popover. Omit when using {@link onTrigger} (native menu).
   */
  fetchItems?: (query: string, trigger: string) => MentionItem[] | Promise<MentionItem[]>
  /**
   * Called once when a trigger char is typed at a valid boundary. When set, the
   * built-in popover is disabled and the host owns presentation (e.g. a native
   * AppKit menu). `anchor` is in window/client coordinates (below the caret).
   */
  onTrigger?: (query: string, anchor: { x: number; y: number } | null, active: ActiveMention) => void
  /**
   * Custom pill detection for the highlight + atomic layer. When set, replaces
   * the default `@name` scan (used e.g. to pill-ize file paths and app tokens).
   */
  findPills?: (text: string) => MentionPill[]
  /** Mention parsing config (triggers, roster matcher). Shared with highlights. */
  mentionOptions?: MentionOptions
  placeholder?: string
  disabled?: boolean
  rows?: number
  maxRows?: number
  className?: string
  id?: string
  'data-testid'?: string
  autoFocus?: boolean
  /** Called on keydown only when the popover did not consume the event. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onBlur?: () => void
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>
  onWheel?: React.WheelEventHandler<HTMLTextAreaElement>
  /** Empty-popover message. Return null to render nothing. */
  emptyLabel?: string
}

type MenuState = {
  active: ActiveMention
  items: MentionItem[]
  index: number
  point: CaretPoint | null
  loading: boolean
}

export const MentionBox = forwardRef<MentionBoxHandle, MentionBoxProps>(function MentionBox(
  {
    value,
    onChange,
    fetchItems,
    onTrigger,
    findPills,
    mentionOptions,
    placeholder,
    disabled,
    rows = 1,
    maxRows = 12,
    className,
    id,
    autoFocus,
    onKeyDown,
    onBlur,
    onPaste,
    emptyLabel,
    ...rest
  },
  ref
) {
  const testId = rest['data-testid']
  const taRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  const pendingCaret = useRef<number | null>(null)
  const reqId = useRef(0)

  const [menu, setMenu] = useState<MenuState | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      textarea: taRef.current,
      focus: () => taRef.current?.focus(),
      insertText: (text: string) => {
        const ta = taRef.current
        const s = ta?.selectionStart ?? value.length
        const e = ta?.selectionEnd ?? s
        const next = value.slice(0, s) + text + value.slice(e)
        pendingCaret.current = s + text.length
        onChange(next)
        requestAnimationFrame(() => ta?.focus())
      }
    }),
    [value, onChange]
  )

  const pills = useMemo<MentionPill[]>(
    () =>
      findPills
        ? findPills(value)
        : findMentions(value, mentionOptions).map((m) => ({ start: m.start, end: m.end, name: m.name })),
    [value, findPills, mentionOptions]
  )
  // Atomic delete / nav only need start/end; a synthetic trigger keeps the type.
  const mentions = useMemo(
    () => pills.map((p) => ({ start: p.start, end: p.end, trigger: '@', name: p.name })),
    [pills]
  )
  const kindByStart = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of pills) if (p.kind) map.set(p.start, p.kind)
    return map
  }, [pills])
  const segments = useMemo(() => segmentText(value, mentions), [value, mentions])

  /** Keep the mirror scrolled in lockstep with the textarea. */
  const syncScroll = useCallback(() => {
    const ta = taRef.current
    const hl = highlightRef.current
    if (!ta || !hl) return
    hl.scrollTop = ta.scrollTop
    hl.scrollLeft = ta.scrollLeft
  }, [])

  /** Reflow-free autosize using the mirror's natural height. */
  const resize = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const cs = getComputedStyle(ta)
    const lh = cs.lineHeight === 'normal' ? Number.parseFloat(cs.fontSize) * 1.2 : Number.parseFloat(cs.lineHeight)
    const padV =
      Number.parseFloat(cs.paddingTop) +
      Number.parseFloat(cs.paddingBottom) +
      Number.parseFloat(cs.borderTopWidth) +
      Number.parseFloat(cs.borderBottomWidth)
    ta.style.height = 'auto'
    const next = Math.min(ta.scrollHeight, Math.round(lh * maxRows + padV))
    ta.style.height = `${next}px`
    ta.style.overflowY = ta.scrollHeight > next + 1 ? 'auto' : 'hidden'
  }, [maxRows])

  useLayoutEffect(() => {
    resize()
    syncScroll()
  }, [value, resize, syncScroll])

  // Apply a pending caret after a controlled-value update (e.g. after a pick).
  useLayoutEffect(() => {
    if (pendingCaret.current == null) return
    const ta = taRef.current
    const pos = pendingCaret.current
    pendingCaret.current = null
    if (!ta) return
    ta.setSelectionRange(pos, pos)
  }, [value])

  /** Client-coord anchor just below the caret, for a host-owned native menu. */
  const triggerAnchor = useCallback((nextValue: string, caret: number): { x: number; y: number } | null => {
    const ta = taRef.current
    if (!ta) return null
    const metrics = readMetrics(ta)
    const point = caretPoint(nextValue.slice(0, caret), metrics, { left: ta.scrollLeft, top: ta.scrollTop })
    const rect = ta.getBoundingClientRect()
    if (!point) return { x: Math.round(rect.left + 8), y: Math.round(rect.bottom) }
    return { x: Math.round(rect.left + point.x), y: Math.round(rect.top + point.y + point.lineHeight) }
  }, [])

  /** Recompute the built-in popover from the current text + caret. */
  const syncMenu = useCallback(
    (nextValue: string, caret: number) => {
      if (composingRef.current || onTrigger || !fetchItems) return
      const active = getActiveMention(nextValue, caret, mentionOptions)
      if (!active) {
        setMenu(null)
        return
      }
      const ta = taRef.current
      let point: CaretPoint | null = null
      if (ta) {
        const metrics = readMetrics(ta)
        point = caretPoint(nextValue.slice(0, caret), metrics, {
          left: ta.scrollLeft,
          top: ta.scrollTop
        })
      }
      const myReq = ++reqId.current
      setMenu((prev) => ({
        active,
        items: prev?.active.start === active.start ? prev.items : [],
        index: 0,
        point,
        loading: true
      }))
      Promise.resolve(fetchItems(active.query, active.trigger)).then(
        (items) => {
          if (myReq !== reqId.current) return
          setMenu((prev) => (prev ? { ...prev, items, index: 0, loading: false } : prev))
        },
        () => {
          if (myReq !== reqId.current) return
          setMenu((prev) => (prev ? { ...prev, items: [], loading: false } : prev))
        }
      )
    },
    [fetchItems, mentionOptions, onTrigger]
  )

  const closeMenu = useCallback(() => {
    reqId.current++
    setMenu(null)
  }, [])

  /** Commit a picked candidate: full-span replace + trailing space. */
  const pick = useCallback(
    (item: MentionItem) => {
      if (item.disabled) return
      const ta = taRef.current
      const active = menu?.active
      if (!ta || !active) return
      const end = mentionSpanEnd(value, active.start, mentionOptions)
      const nextChar = value[end] ?? ''
      const needsSpace = !/\s/.test(nextChar) // true at EOL too (nextChar === '')
      const insert = (item.insert ?? `${active.trigger}${item.label}`) + (needsSpace ? ' ' : '')
      const res = applyMention(value, active.start, insert, mentionOptions)
      pendingCaret.current = res.caret
      onChange(res.value)
      closeMenu()
      requestAnimationFrame(() => ta.focus())
    },
    [menu, value, onChange, mentionOptions, closeMenu]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (composingRef.current || e.nativeEvent.isComposing) return

      // 1) Popover navigation wins.
      if (menu) {
        const selectable = menu.items.filter((i) => !i.disabled)
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMenu((m) => (m ? { ...m, index: (m.index + 1) % Math.max(1, m.items.length) } : m))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMenu((m) =>
            m ? { ...m, index: (m.index - 1 + Math.max(1, m.items.length)) % Math.max(1, m.items.length) } : m
          )
          return
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && selectable.length > 0) {
          e.preventDefault()
          pick(menu.items[menu.index] ?? selectable[0])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          closeMenu()
          return
        }
      }

      // 2) Atomic mention behavior on a plain string.
      const ta = taRef.current
      if (ta) {
        const s = ta.selectionStart
        const en = ta.selectionEnd
        if (e.key === 'Backspace') {
          const del = atomicBackspace(s, en, mentions)
          if (del) {
            e.preventDefault()
            const next = value.slice(0, del.start) + value.slice(del.end)
            pendingCaret.current = del.start
            onChange(next)
            return
          }
        } else if (e.key === 'Delete') {
          const del = atomicDelete(s, en, mentions)
          if (del) {
            e.preventDefault()
            const next = value.slice(0, del.start) + value.slice(del.end)
            pendingCaret.current = del.start
            onChange(next)
            return
          }
        } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && s === en && !e.shiftKey) {
          const target = atomicCaretTarget(s, e.key === 'ArrowLeft' ? 'left' : 'right', mentions)
          if (target != null && target !== s) {
            e.preventDefault()
            ta.setSelectionRange(target, target)
            requestAnimationFrame(() => syncMenu(value, target))
            return
          }
        }
      }

      // 3) Fall through to the host (e.g. Enter-to-send).
      onKeyDown?.(e)
    },
    [menu, mentions, value, onChange, pick, closeMenu, syncMenu, onKeyDown]
  )

  useEffect(() => {
    if (autoFocus) taRef.current?.focus()
  }, [autoFocus])

  const popover =
    menu && !onTrigger && (menu.items.length > 0 || menu.loading || emptyLabel) ? (
      <MentionPopover
        menu={menu}
        onHover={(index) => setMenu((m) => (m ? { ...m, index } : m))}
        onPick={pick}
        emptyLabel={emptyLabel}
      />
    ) : null

  return (
    <div
      ref={boxRef}
      className={`mention-box${className ? ` ${className}` : ''}`}
      data-disabled={disabled ? 'true' : undefined}
    >
      <div ref={highlightRef} className="mention-box-highlights" aria-hidden="true">
        {segments.map((seg) =>
          seg.kind === 'mention' ? (
            <span
              key={seg.start}
              className="mention-chip"
              data-name={seg.name}
              data-kind={kindByStart.get(seg.start)}
            >
              {seg.text}
            </span>
          ) : (
            <span key={seg.start} className="mention-text">
              {seg.text}
            </span>
          )
        )}
        {/* Keep the mirror's last empty line so the caret has room to sit. */}
        {value.endsWith('\n') || value === '' ? '\u200b' : null}
      </div>

      <textarea
        {...rest}
        ref={taRef}
        id={id}
        data-testid={testId}
        className="mention-box-input"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        spellCheck={false}
        onChange={(e) => {
          const next = e.target.value
          const caret = e.target.selectionStart ?? next.length
          onChange(next)
          if (onTrigger) {
            if (composingRef.current) return
            const active = getActiveMention(next, caret, mentionOptions)
            // Fire only on the keystroke that inserts the trigger (empty query).
            if (active && caret === active.start + 1) {
              onTrigger(active.query, triggerAnchor(next, caret), active)
            }
            return
          }
          syncMenu(next, caret)
        }}
        onScroll={syncScroll}
        onClick={(e) => syncMenu(value, e.currentTarget.selectionStart ?? 0)}
        onKeyUp={(e) => {
          // Caret-moving keys re-evaluate the popover; typing is handled onChange.
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            syncMenu(value, e.currentTarget.selectionStart ?? 0)
          }
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          syncMenu(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
        }}
        onBlur={() => {
          // Let a popover mousedown land before we close.
          window.setTimeout(() => {
            if (document.activeElement !== taRef.current) closeMenu()
          }, 0)
          onBlur?.()
        }}
        onPaste={onPaste}
      />

      {popover}
    </div>
  )
})

function MentionPopover({
  menu,
  onHover,
  onPick,
  emptyLabel
}: {
  menu: MenuState
  onHover: (index: number) => void
  onPick: (item: MentionItem) => void
  emptyLabel?: string
}): React.JSX.Element {
  const style: CSSProperties =
    menu.point != null
      ? { left: Math.round(menu.point.x), top: Math.round(menu.point.y + menu.point.lineHeight + 4) }
      : { left: 8, bottom: '100%' }

  return (
    <div
      className="mention-popover"
      role="listbox"
      data-testid="mention-popover"
      style={style}
      onMouseDown={(e) => e.preventDefault() /* keep textarea focus */}
    >
      {menu.items.length === 0 ? (
        <div className="mention-popover-empty">{menu.loading ? '…' : emptyLabel ?? null}</div>
      ) : (
        menu.items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={index === menu.index}
            aria-disabled={item.disabled || undefined}
            className={`mention-option${index === menu.index ? ' is-active' : ''}${item.disabled ? ' is-disabled' : ''}`}
            data-testid={`mention-option-${item.id}`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onPick(item)}
          >
            {item.icon ? <span className="mention-option-icon">{item.icon}</span> : null}
            <span className="mention-option-label">{item.label}</span>
            {item.detail ? <span className="mention-option-detail">{item.detail}</span> : null}
          </button>
        ))
      )}
    </div>
  )
}
