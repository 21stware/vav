import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

type Edges = { top: boolean; bottom: boolean }

const EDGE_PX = 2
const STICK_PX = 28

function edgesOf(el: HTMLElement): Edges {
  const overflow = el.scrollHeight - el.clientHeight > EDGE_PX
  if (!overflow) return { top: false, bottom: false }
  return {
    top: el.scrollTop > EDGE_PX,
    bottom: el.scrollHeight - el.scrollTop - el.clientHeight > EDGE_PX
  }
}

/**
 * Reading well that grows with the trace up to a max height. Live thinking
 * and an expanded thinking process share this frame so a long trace scrolls
 * inside instead of pushing the answer down. Fades show only on edges that
 * still have more text.
 */
export function ThinkingViewport({
  children,
  follow = false,
  className
}: {
  children: ReactNode
  /** Keep the latest line in view while thinking is still streaming. */
  follow?: boolean
  className?: string
}): React.JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stuckRef = useRef(true)
  const [edges, setEdges] = useState<Edges>({ top: false, bottom: false })

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    const paint = (stick: boolean): void => {
      if (stick && follow && stuckRef.current) el.scrollTop = el.scrollHeight
      const next = edgesOf(el)
      setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next))
    }

    const onScroll = (): void => {
      if (follow) {
        const gap = el.scrollHeight - el.scrollTop - el.clientHeight
        stuckRef.current = gap < STICK_PX
      }
      paint(false)
    }

    paint(true)
    el.addEventListener('scroll', onScroll, { passive: true })
    // Children sit in a stable content node; ResizeObserver sees growth.
    const content = el.firstElementChild
    const observer = new ResizeObserver(() => paint(true))
    observer.observe(el)
    if (content) observer.observe(content)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [follow])

  const classes = [
    'thinking-viewport',
    edges.top ? 'is-overflow-top' : '',
    edges.bottom ? 'is-overflow-bottom' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} data-testid="thinking-viewport">
      <div className="thinking-viewport-fade top" aria-hidden="true" />
      <div className="thinking-viewport-fade bottom" aria-hidden="true" />
      <div ref={scrollerRef} className="thinking-viewport-scroll">
        <div className="thinking-viewport-content">{children}</div>
      </div>
    </div>
  )
}
