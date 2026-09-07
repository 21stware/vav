import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { highlightCode, languageFromPath } from '../../lib/highlightCode'
import {
  findBlockById,
  parentBlockOf,
  pickBlockAtLine,
  type PreviewBlock
} from '../../lib/previewBlocks'
import { handleClickPickMouseDown, type ClickPickPointer } from '../../lib/clickPick'
import { useT } from '../../i18n/useT'

/**
 * Continuous highlighted source with whole-block outlines (not per-line paint).
 *
 * Viewport virtualization: only the visible window (+ overscan) is highlighted
 * and mounted as DOM. Full-file highlight of large XML/JSON was freezing open.
 * Selection overlays still use absolute line ranges against the virtual height.
 */
const CODE_OVERSCAN_LINES = 48
/** Below this line count, render everything (small files stay simple). */
const CODE_VIRTUALIZE_MIN_LINES = 200

export function CodeBlockCanvas({
  path,
  text,
  lineOriented = false,
  selecting,
  blocks,
  selectedIds,
  selectedBlocks,
  onSelectBlock,
  onSelectLine,
  onNearEnd,
  onAskAgent
}: {
  path: string
  text: string
  lineOriented?: boolean
  selecting: boolean
  blocks: PreviewBlock[]
  selectedIds: string[]
  selectedBlocks: PreviewBlock[]
  onSelectBlock: (id: string, event?: React.MouseEvent | ClickPickPointer | null) => void
  onSelectLine: (line: number, event?: React.MouseEvent | ClickPickPointer | null) => void
  onNearEnd?: () => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
}): React.JSX.Element {
  const t = useT()
  const language = languageFromPath(path)
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  const virtualize = lines.length >= CODE_VIRTUALIZE_MIN_LINES
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const containerRef = useRef<HTMLPreElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [linePx, setLinePx] = useState(0)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 })
  const [contentMinWidth, setContentMinWidth] = useState(0)
  /** Overlay width in px = max content width of lines in the block range. */
  const [overlayWidths, setOverlayWidths] = useState<Record<string, number>>({})
  const scrollRaf = useRef(0)
  const onNearEndRef = useRef(onNearEnd)
  onNearEndRef.current = onNearEnd

  // Measure line-height from a real line box (must match CSS --code-line-height).
  // Runs every render rather than on a dep list: type zoom changes the line box
  // without touching the text, and virtual scroll math built on a stale pitch
  // paints blank bands.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const probe = el.querySelector<HTMLElement>('.preview-code-line')
    const measured = probe ? probe.getBoundingClientRect().height : 0
    let next = measured
    if (!(next > 0)) {
      const cs = getComputedStyle(el)
      const fontSize = parseFloat(cs.fontSize) || 12
      const lh = parseFloat(cs.lineHeight)
      next = Number.isFinite(lh) && lh > 0 ? lh : fontSize * 1.55
    }
    if (Math.abs(next - linePx) < 0.5) return
    setLinePx(next)
  })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const sync = (): void => {
      if (scrollRaf.current) return
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = 0
        // Read from the scrolling element only — body must not scroll instead.
        const scrollTop = el.scrollTop
        const height = el.clientHeight || 600
        setViewport({ scrollTop, height })
        // Seamless window fill: near the bottom of *loaded* content, pull more.
        const room = el.scrollHeight - scrollTop - height
        if (room < Math.max(320, height * 0.6)) {
          onNearEndRef.current?.()
        }
      })
    }
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      ro?.disconnect()
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current)
    }
  }, [lines.length, virtualize])

  const lh = linePx > 0 ? linePx : 19
  const range = useMemo(() => {
    if (!virtualize) return { start: 0, end: lines.length }
    const start = Math.max(0, Math.floor(viewport.scrollTop / lh) - CODE_OVERSCAN_LINES)
    const visible = Math.ceil(Math.max(viewport.height, 1) / lh) + CODE_OVERSCAN_LINES * 2
    const end = Math.min(lines.length, start + Math.max(visible, 60))
    return { start, end }
  }, [virtualize, viewport.scrollTop, viewport.height, lh, lines.length])

  // Highlight only the visible window — never the whole file.
  const visibleHtml = useMemo(() => {
    const out: string[] = []
    for (let i = range.start; i < range.end; i++) {
      out.push(highlightCode(lines[i] ?? '', language) || ' ')
    }
    return out
  }, [lines, range.start, range.end, language])

  const hoverBlock = useMemo((): PreviewBlock | null => {
    if (!selecting || !hoveredId || selectedIds.includes(hoveredId)) return null
    if (lineOriented && hoveredId.startsWith('line-L')) {
      const line = Number(hoveredId.slice('line-L'.length))
      if (!Number.isFinite(line) || line < 1 || line > lines.length) return null
      return {
        id: hoveredId,
        kind: 'line',
        text: lines[line - 1] ?? '',
        startLine: line,
        endLine: line,
        label: `L${line}`
      }
    }
    return findBlockById(blocks, hoveredId)
  }, [selecting, hoveredId, selectedIds, lineOriented, lines, blocks])

  /**
   * Absolute overlays for structured/code blocks. Line-oriented logs paint
   * selection on the row DOM itself (avoids ghost boxes in empty flex space).
   */
  const overlays = useMemo(() => {
    if (!selecting || lineOriented) return []
    const result: {
      id: string
      startLine: number
      endLine: number
      selected: boolean
      hovered: boolean
    }[] = []
    for (const block of selectedBlocks) {
      result.push({
        id: block.id,
        startLine: block.startLine,
        endLine: block.endLine,
        selected: true,
        hovered: false
      })
    }
    if (hoverBlock) {
      result.push({
        id: hoverBlock.id,
        startLine: hoverBlock.startLine,
        endLine: hoverBlock.endLine,
        selected: false,
        hovered: true
      })
    }
    return result
  }, [selecting, lineOriented, selectedBlocks, hoverBlock])

  // Measure visible line widths for horizontal scroll + tight selection boxes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const lineEls = canvas.querySelectorAll<HTMLElement>('.preview-code-line')
    let maxW = 0
    lineEls.forEach((lineEl) => {
      const content = (lineEl.firstElementChild as HTMLElement | null) ?? lineEl
      maxW = Math.max(maxW, content.offsetWidth, content.scrollWidth)
    })
    if (maxW > 0) {
      setContentMinWidth((prev) => (maxW > prev ? maxW : prev))
    }

    if (!selecting || overlays.length === 0) {
      setOverlayWidths((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    const next: Record<string, number> = {}
    for (const ov of overlays) {
      // Only measure intersection with the mounted window.
      const from = Math.max(ov.startLine - 1, range.start)
      const to = Math.min(ov.endLine, range.end)
      let max = 0
      for (let i = from; i < to; i++) {
        const lineEl = lineEls[i - range.start]
        if (!lineEl) continue
        const content = (lineEl.firstElementChild as HTMLElement | null) ?? lineEl
        max = Math.max(max, content.offsetWidth, content.scrollWidth)
      }
      next[ov.id] = Math.max(max, overlayWidths[ov.id] ?? 0, 8)
    }
    setOverlayWidths((prev) => {
      const keys = Object.keys(next)
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => prev[k] === next[k])
      ) {
        return prev
      }
      return { ...prev, ...next }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlayWidths read is a floor, not a dep
  }, [selecting, overlays, visibleHtml, range.start, range.end])

  /** Map pointer → line; null when outside real content (not empty flex padding). */
  const lineAtPointer = (event: React.MouseEvent): number | null => {
    const el = containerRef.current
    if (!el || lines.length <= 0) return null
    const rect = el.getBoundingClientRect()
    const y = event.clientY - rect.top + el.scrollTop
    const contentH = lines.length * lh
    // Clicks in leftover flex/empty area below the last line must not pick.
    if (y < 0 || y >= contentH) return null
    const lineNo = Math.floor(y / lh) + 1
    if (lineNo < 1 || lineNo > lines.length) return null
    return lineNo
  }

  const handleMouseMove = (event: React.MouseEvent): void => {
    if (!selecting) return
    const lineNo = lineAtPointer(event)
    if (lineNo == null) {
      setHoveredId(null)
      return
    }
    if (lineOriented) {
      setHoveredId(`line-L${lineNo}`)
      return
    }
    const hit = pickBlockAtLine(blocks, lineNo, text)
    setHoveredId(hit?.id ?? null)
  }

  const handlePointerPick = (event: React.MouseEvent): void => {
    if (!selecting) return
    // Capture line under pointer at mousedown — drag may move the cursor.
    const lineNo = lineAtPointer(event)
    if (lineNo == null) return
    // Skip pure-empty rows in log mode — they produced ghost 8px boxes.
    if (lineOriented && !(lines[lineNo - 1] ?? '').trim()) return
    handleClickPickMouseDown(event, () => onSelectLine(lineNo, null), {
      stopPropagation: false
    })
  }

  const handleContextMenu = (event: React.MouseEvent): void => {
    if (!selecting) return
    event.preventDefault()
    const lineNo = lineAtPointer(event)
    if (lineNo == null) return
    if (lineOriented && !(lines[lineNo - 1] ?? '').trim()) return
    const hit = lineOriented
      ? ({
          id: `line-L${lineNo}`,
          kind: 'line' as const,
          text: lines[lineNo - 1] ?? '',
          startLine: lineNo,
          endLine: lineNo,
          label: `L${lineNo}`
        } satisfies PreviewBlock)
      : pickBlockAtLine(blocks, lineNo, text)
    if (!hit) return
    const parent = lineOriented ? null : parentBlockOf(blocks, hit.id)
    void window.vav.window
      .popupMenu(
        [
          { id: 'copy', label: t('preview.copyBlock') },
          { id: 'analyze', label: t('preview.analyzeBlock') },
          { id: 'refactor', label: t('preview.refactorBlock') },
          ...(parent ? [{ id: 'parent', label: t('preview.selectParent') }] : [])
        ],
        { x: event.clientX, y: event.clientY }
      )
      .then((id) => {
        if (id === 'copy') void window.vav.conversations.copyToClipboard(hit.text)
        if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), hit)
        if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), hit)
        if (id === 'parent' && parent) onSelectBlock(parent.id, event)
      })
  }

  const totalHeight = Math.max(lh, lines.length * lh)
  const padTop = range.start * lh
  const padBottom = Math.max(0, (lines.length - range.end) * lh)

  return (
    <pre
      ref={containerRef}
      className={`file-viewer-code continuous${selecting ? ' selecting' : ''}${
        virtualize ? ' is-virtualized' : ''
      }`}
      onMouseMove={selecting ? handleMouseMove : undefined}
      onMouseLeave={() => setHoveredId(null)}
      onMouseDown={selecting ? handlePointerPick : undefined}
      onContextMenu={selecting ? handleContextMenu : undefined}
    >
      <div
        className="preview-code-canvas"
        ref={canvasRef}
        style={{
          // Prefer padding spacers over a single absolute window + fixed height
          // so scrollHeight always matches line count × line height.
          minHeight: virtualize ? totalHeight : undefined,
          height: virtualize ? totalHeight : undefined,
          minWidth: contentMinWidth > 0 ? contentMinWidth : undefined,
          position: 'relative'
        }}
      >
        <div
          className="preview-code-window"
          style={
            virtualize
              ? {
                  position: 'absolute',
                  top: padTop,
                  left: 0,
                  minWidth: '100%',
                  // Bottom spacer via canvas height; window only hosts visible lines.
                  paddingBottom: 0
                }
              : { minWidth: '100%' }
          }
        >
          {visibleHtml.map((html, i) => {
            const lineNo = range.start + i + 1
            const lineId = `line-L${lineNo}`
            const rowSelected =
              lineOriented && selecting && selectedIds.includes(lineId)
            const rowHovered =
              lineOriented && selecting && hoveredId === lineId && !rowSelected
            return (
              <div
                className={[
                  'preview-code-line',
                  rowSelected ? 'is-selected' : '',
                  rowHovered ? 'is-hovered' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={lineNo}
                data-line={lineNo}
              >
                <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            )
          })}
        </div>
        {/* Invisible bottom sentinel keeps total scroll extent stable if height math drifts. */}
        {virtualize && padBottom > 0 ? (
          <div aria-hidden style={{ position: 'absolute', top: totalHeight - 1, height: 1, width: 1 }} />
        ) : null}
        {/* Structured/code block overlays only — logs use row .is-selected. */}
        {overlays.map((ov) => (
          <div
            key={`ov-${ov.id}`}
            className={`preview-code-overlay${ov.selected ? ' selected' : ''}${ov.hovered ? ' hovered' : ''}`}
            style={{
              top: (ov.startLine - 1) * lh,
              height: Math.max(lh, (ov.endLine - ov.startLine + 1) * lh),
              width: overlayWidths[ov.id] != null ? `${overlayWidths[ov.id]}px` : undefined
            }}
          />
        ))}
      </div>
    </pre>
  )
}
