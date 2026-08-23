import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n/useT'
import { layoutRewindRail, rewindIndexAtY } from '../lib/rewindLayout'
import type { RewindTurn } from '../lib/rewindTurns'

/**
 * The pointer has to be near a tick center to count as a jump — the rail strip
 * is deliberately wider than the ticks, and a click in the empty gutter above
 * the first turn should do nothing rather than teleport the log.
 */
const CLICK_SLOP_PX = 20
/** Labels below this opacity are not worth a glass plate. */
const LABEL_FLOOR = 0.08
/** First-paint guess until ResizeObserver reports the filled scrollbar height. */
const RAIL_FALLBACK_PX = 340

function indexOfId(turns: RewindTurn[], id: string | null): number {
  if (!id) return 0
  const index = turns.findIndex((turn) => turn.id === id)
  return index < 0 ? 0 : index
}

export function RewindRail({
  turns,
  currentId,
  onJump,
  onPassScroll
}: {
  turns: RewindTurn[]
  currentId: string | null
  onJump: (messageId: string) => void
  onPassScroll?: (deltaY: number) => void
}): React.JSX.Element {
  const t = useT()
  const railRef = useRef<HTMLElement>(null)
  const passScrollRef = useRef(onPassScroll)
  const lastJumpRef = useRef<string | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [keyIndex, setKeyIndex] = useState<number | null>(null)
  const [measured, setMeasured] = useState(0)

  passScrollRef.current = onPassScroll

  const height = measured > 0 ? measured : RAIL_FALLBACK_PX
  const lens = hover ?? keyIndex
  const focus = lens ?? indexOfId(turns, currentId)
  const rows = useMemo(
    () =>
      layoutRewindRail({
        count: turns.length,
        height,
        focus,
        hover: lens
      }),
    [turns.length, height, focus, lens]
  )
  const centers = useMemo(() => rows.map((row) => row.y), [rows])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const applySize = (): void => {
      const next = Math.round(rail.getBoundingClientRect().height)
      setMeasured((prev) => (prev === next ? prev : next))
    }
    applySize()
    const observer = new ResizeObserver(applySize)
    observer.observe(rail)
    /**
     * React attaches `wheel` passively at the root, so preventDefault needs an
     * explicit non-passive listener. The rail is a fixed-height fisheye and must
     * never scroll itself — a wheel over it belongs to the transcript.
     */
    const onWheel = (event: WheelEvent): void => {
      const pass = passScrollRef.current
      if (!pass) return
      event.preventDefault()
      pass(event.deltaY)
    }
    rail.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      rail.removeEventListener('wheel', onWheel)
    }
  }, [])

  const lensAt = (clientY: number): number | null => {
    const rail = railRef.current
    if (!rail || centers.length === 0) return null
    return rewindIndexAtY(clientY - rail.getBoundingClientRect().top, centers)
  }

  const jumpAt = (clientY: number, slop: number): void => {
    const rail = railRef.current
    if (!rail || turns.length === 0) return
    const y = clientY - rail.getBoundingClientRect().top
    const at = rewindIndexAtY(y, centers)
    if (at == null) return
    const index = Math.round(at)
    const center = centers[index]
    if (center == null || Math.abs(center - y) > slop) return
    const turn = turns[index]
    if (!turn || turn.id === lastJumpRef.current) return
    lastJumpRef.current = turn.id
    // Trackpad haptic: tick once when the press-and-hold scrub lands on a new
    // thread node. macOS-only; Linux/Windows IPC no-ops.
    void window.vav.haptics.tap()
    onJump(turn.id)
  }

  return (
    <nav
      ref={railRef}
      className="rewind-rail"
      data-hot={lens != null ? 'true' : undefined}
      aria-label={t('transcript.rewindNav')}
      onPointerEnter={(event) => setHover(lensAt(event.clientY))}
      onPointerMove={(event) => {
        setHover(lensAt(event.clientY))
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          jumpAt(event.clientY, Number.POSITIVE_INFINITY)
        }
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        jumpAt(event.clientY, CLICK_SLOP_PX)
      }}
      onPointerUp={(event) => {
        lastJumpRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
    >
      <ol className="rewind-list">
        {turns.map((turn, index) => {
          const row = rows[index]
          const current = turn.id === currentId
          const label = turn.preview || t('transcript.rewindEmpty')
          const hot = lens != null && Math.round(lens) === index
          return (
            <li
              key={turn.id}
              className="rewind-slot"
              style={row ? { transform: `translateY(${row.y}px)` } : undefined}
            >
              <button
                type="button"
                className="rewind-item"
                data-current={current ? 'true' : undefined}
                data-hot={hot ? 'true' : undefined}
                aria-current={current ? 'true' : undefined}
                aria-label={t('transcript.rewindJump', { n: index + 1, preview: label })}
                onFocus={() => setKeyIndex(index)}
                onBlur={() => setKeyIndex(null)}
                onClick={(event) => {
                  // Only keyboard activation reaches the button (the list is
                  // pointer-transparent); the rail must not also hit-test it.
                  event.stopPropagation()
                  onJump(turn.id)
                }}
              >
                <span
                  className="rewind-tick"
                  aria-hidden
                  style={
                    row
                      ? {
                          width: row.tickW,
                          height: current ? Math.max(row.tickH, 3) : row.tickH,
                          opacity: current || hot ? 1 : row.tickOpacity
                        }
                      : undefined
                  }
                />
                {row && row.labelOpacity > LABEL_FLOOR ? (
                  <span
                    className="rewind-copy"
                    style={{
                      opacity: row.labelOpacity,
                      transform: `translateY(-50%) scale(${row.labelScale})`
                    }}
                  >
                    <span className="rewind-prompt">{label}</span>
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
