import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import { useSessionStore } from '../state/sessionStore'
import { applyBlockPick, selectedBlockIdsForPath } from '../lib/applyBlockPick'
import { handleClickPickMouseDown } from '../lib/clickPick'
import { blockAtLine, findBlockById, parentBlockOf } from '../lib/previewBlocks'
import { useT } from '../i18n/useT'

type OverlayBox = {
  id: string
  selected: boolean
  hovered: boolean
  top: number
  height: number
  width: number
}

/** Same paint box FileViewer uses for structured/code pick (`preview-code-overlay`). */
function measureLineRange(
  host: HTMLElement,
  startLine: number,
  endLine: number
): { top: number; height: number; width: number } | null {
  const start = host.querySelector<HTMLElement>(`[data-line="${startLine}"]`)
  const end = host.querySelector<HTMLElement>(`[data-line="${endLine}"]`)
  if (!start || !end) return null
  const top = start.offsetTop
  const height = Math.max(end.offsetTop + end.offsetHeight - top, start.offsetHeight)
  let width = 0
  let el: Element | null = start
  while (el instanceof HTMLElement) {
    if (el.hasAttribute('data-line')) {
      width = Math.max(width, el.scrollWidth, el.offsetWidth)
    }
    if (el === end) break
    el = el.nextElementSibling
  }
  return { top, height, width: Math.max(width, 8) }
}

/**
 * Line-grouped block pick for plain text surfaces (git diff, terminal log).
 * Same chrome as file-preview code pick: one overlay box per block,
 * dashed hover → solid selected.
 */
export function TextBlockPick({
  className,
  lines,
  blocks,
  sourcePath,
  badge,
  conversationId,
  renderLine
}: {
  className?: string
  lines: string[]
  blocks: PreviewBlock[]
  sourcePath: string
  badge: string
  conversationId?: string | null
  renderLine: (line: string, index: number) => ReactNode
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const cid = conversationId ?? activeId
  // Do not `?? []` in the selector — a fresh array each snapshot loops zustand/React.
  const commentCards = useSessionStore((s) => (cid ? s.commentCards[cid] : undefined))
  const selectedIds = useMemo(
    () => selectedBlockIdsForPath(cid, sourcePath),
    [cid, sourcePath, commentCards]
  )
  const [hoverLine, setHoverLine] = useState<number | null>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const [overlays, setOverlays] = useState<OverlayBox[]>([])

  const hoverBlock = useMemo(() => {
    if (hoverLine == null) return null
    const hit = blockAtLine(blocks, hoverLine)
    if (!hit || selectedIds.includes(hit.id)) return null
    return hit
  }, [blocks, hoverLine, selectedIds])

  const selectedBlocks = useMemo(
    () => selectedIds.map((id) => findBlockById(blocks, id)).filter((b): b is PreviewBlock => !!b),
    [blocks, selectedIds]
  )

  useLayoutEffect(() => {
    const host = preRef.current
    if (!host) {
      setOverlays([])
      return
    }
    const measure = (): void => {
      const next: OverlayBox[] = []
      for (const block of selectedBlocks) {
        const box = measureLineRange(host, block.startLine, block.endLine)
        if (!box) continue
        next.push({ id: block.id, selected: true, hovered: false, ...box })
      }
      if (hoverBlock) {
        const box = measureLineRange(host, hoverBlock.startLine, hoverBlock.endLine)
        if (box) next.push({ id: hoverBlock.id, selected: false, hovered: true, ...box })
      }
      setOverlays(next)
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(host)
    return () => ro?.disconnect()
  }, [selectedBlocks, hoverBlock, lines.length])

  const pick = (line: number): void => {
    const hit = blockAtLine(blocks, line)
    if (hit) applyBlockPick({ conversationId: cid, sourcePath, badge, block: hit })
  }

  return (
    <pre
      ref={preRef}
      className={`text-block-pick selecting${className ? ` ${className}` : ''}`}
      onMouseLeave={() => setHoverLine(null)}
    >
      {lines.map((line, index) => {
        const n = index + 1
        return (
          <div
            key={n}
            className="text-block-pick-line"
            data-line={n}
            onMouseEnter={() => setHoverLine(n)}
            onMouseDown={(event) =>
              handleClickPickMouseDown(event, () => pick(n), { stopPropagation: false })
            }
            onContextMenu={(event) => {
              event.preventDefault()
              const hit = blockAtLine(blocks, n)
              if (!hit) return
              const parent = parentBlockOf(blocks, hit.id)
              void window.vav.window
                .popupMenu(
                  [
                    { id: 'copy', label: t('preview.copyBlock') },
                    ...(parent ? [{ id: 'parent', label: t('preview.selectParent') }] : [])
                  ],
                  { x: event.clientX, y: event.clientY }
                )
                .then((id) => {
                  if (id === 'copy') void window.vav.conversations.copyToClipboard(hit.text)
                  if (id === 'parent' && parent) {
                    applyBlockPick({
                      conversationId: cid,
                      sourcePath,
                      badge,
                      block: parent
                    })
                  }
                })
            }}
          >
            {renderLine(line, index)}
          </div>
        )
      })}
      {overlays.map((ov) => (
        <div
          key={`ov-${ov.id}`}
          data-block-id={ov.id}
          className={`preview-code-overlay${ov.selected ? ' selected' : ''}${
            ov.hovered ? ' hovered' : ''
          }`}
          style={{
            top: ov.top,
            height: ov.height,
            width: ov.width
          }}
        />
      ))}
    </pre>
  )
}
