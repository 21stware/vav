/**
 * draw.io read-only full-bleed canvas — whole cell pick, no chrome.
 */

import { useMemo } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import { drawioVertices, parseDrawioXml, type DrawioCell } from '@shared/drawio'
import { scheduleClickPick } from '../../lib/clickPick'
import { useT } from '../../i18n/useT'
import { useCanvasZoom } from './canvasZoom'

export function DrawioView({
  text,
  selecting,
  selectedIds,
  onSelect
}: {
  text: string
  selecting: boolean
  selectedIds: string[]
  onSelect: (block: PreviewBlock, event?: React.MouseEvent | null) => void
}): React.JSX.Element {
  const t = useT()
  const doc = useMemo(() => parseDrawioXml(text), [text])
  const vertices = useMemo(() => drawioVertices(doc), [doc])
  const selected = new Set(selectedIds)
  const zoom = useCanvasZoom()

  const bounds = useMemo(() => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const c of vertices) {
      const x = c.x ?? 0
      const y = c.y ?? 0
      const w = c.width ?? 80
      const h = c.height ?? 40
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + w)
      maxY = Math.max(maxY, y + h)
    }
    if (!Number.isFinite(minX)) {
      minX = 0
      minY = 0
      maxX = 400
      maxY = 300
    }
    const pad = 40
    return {
      minX: minX - pad,
      minY: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2
    }
  }, [vertices])

  const pick = (cell: DrawioCell, event?: React.MouseEvent | null): void => {
    onSelect(
      {
        id: `drawio-${cell.id}`,
        kind: 'object',
        label: cell.label,
        text: [
          cell.label,
          cell.style ? `style: ${cell.style}` : '',
          cell.x != null ? `pos: ${cell.x},${cell.y} size: ${cell.width}×${cell.height}` : ''
        ]
          .filter(Boolean)
          .join('\n'),
        startLine: 1,
        endLine: 1
      },
      event ?? null
    )
  }

  if (doc.compressedSkipped || vertices.length === 0) {
    return (
      <div className="drawio-view drawio-empty">
        <p className="muted">{doc.warning || t('diagram.drawioEmpty')}</p>
      </div>
    )
  }

  return (
    <div className={`drawio-view selecting${selecting ? ' is-selecting' : ''}`}>
      <div
        className="drawio-scroll"
        data-panning={zoom.panning ? 'true' : 'false'}
        {...zoom.viewportProps}
      >
        <div ref={zoom.wrapperRef} className="canvas-pan-wrapper" style={zoom.contentStyle}>
          <svg
            className="drawio-canvas"
            width={bounds.width}
            height={bounds.height}
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
          >
          {vertices.map((c) => {
            const x = c.x ?? 0
            const y = c.y ?? 0
            const w = Math.max(c.width ?? 80, 40)
            const h = Math.max(c.height ?? 40, 28)
            const isSel = selected.has(`drawio-${c.id}`)
            return (
              <g
                key={c.id}
                className={`drawio-cell diagram-pick-target preview-select-region office-pick-target${
                  isSel ? ' selected is-selected' : ''
                }`}
                data-block-id={`drawio-${c.id}`}
                transform={`translate(${x}, ${y})`}
                onMouseDown={(ev) => {
                  if (!selecting) return
                  scheduleClickPick(ev.nativeEvent, () => pick(c, ev))
                }}
              >
                <rect width={w} height={h} rx={6} ry={6} className="drawio-cell-plate" />
                <text
                  x={w / 2}
                  y={h / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="drawio-cell-label"
                  style={{ pointerEvents: 'none' }}
                >
                  {c.label.length > 36 ? `${c.label.slice(0, 34)}…` : c.label}
                </text>
              </g>
            )
          })}
          </svg>
        </div>
      </div>
      {zoom.controls}
    </div>
  )
}
