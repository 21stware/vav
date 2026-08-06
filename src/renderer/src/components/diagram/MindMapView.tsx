/**
 * FreeMind / OPML full-bleed mind map: whole-node pick, live edit write-back.
 * No toolbar chrome — double-click renames; ⌘/Ctrl+Enter adds child; Delete removes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import {
  addMindChild,
  deleteMindNode,
  findMindNode,
  mindNodePath,
  mindNodeSubtreeText,
  parseMindMap,
  serializeMindMap,
  updateMindNodeTitle,
  type MindMapDoc
} from '@shared/mindmap'
import { scheduleClickPick } from '../../lib/clickPick'
import { layoutMindMap } from '../../lib/mindmapLayout'
import { useCanvasZoom } from './canvasZoom'

export function MindMapView({
  path,
  text,
  selecting,
  selectedIds,
  readOnly,
  onSelect,
  onDocChange
}: {
  path: string
  text: string
  selecting: boolean
  selectedIds: string[]
  readOnly: boolean
  onSelect: (block: PreviewBlock, event?: React.MouseEvent | null) => void
  onDocChange: (serialized: string) => void
}): React.JSX.Element {
  const [doc, setDoc] = useState<MindMapDoc>(() => parseMindMap(path, text))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // Track the last source we emitted via onDocChange so the live-rename stream
  // (which round-trips through the parent's `text` prop) doesn't blow away the
  // in-progress edit. Without this guard, each keystroke re-parses the doc
  // (regenerating OPML node ids) and resets editingId, instantly unmounting
  // the input — so a single character would end the edit.
  const lastEmittedRef = useRef<{ path: string; text: string } | null>(null)

  useEffect(() => {
    const last = lastEmittedRef.current
    if (last && last.path === path && last.text === text) return
    setDoc(parseMindMap(path, text))
    setEditingId(null)
  }, [path, text])

  const layout = useMemo(() => layoutMindMap(doc.root), [doc])
  const selected = new Set(selectedIds)

  const commitDoc = useCallback(
    (next: MindMapDoc) => {
      setDoc(next)
      const serialized = serializeMindMap(next)
      lastEmittedRef.current = { path, text: serialized }
      onDocChange(serialized)
    },
    [onDocChange, path]
  )

  /** Live title edit while typing — stream re-layout. */
  const liveRename = useCallback(
    (id: string, title: string) => {
      setDraft(title)
      const next = updateMindNodeTitle(doc, id, title || ' ')
      setDoc(next)
      const serialized = serializeMindMap(next)
      lastEmittedRef.current = { path, text: serialized }
      onDocChange(serialized)
    },
    [doc, onDocChange, path]
  )

  const pickNode = useCallback(
    (id: string, event?: React.MouseEvent | null) => {
      if (!selecting) return
      const node = findMindNode(doc.root, id)
      if (!node) return
      const pathLabels = mindNodePath(doc.root, id) ?? [node.title]
      onSelect(
        {
          id: `mind-${id}`,
          kind: 'section',
          label: pathLabels.join(' › '),
          text: mindNodeSubtreeText(node),
          startLine: 1,
          endLine: 1
        },
        event ?? null
      )
    },
    [doc, onSelect, selecting]
  )

  const activeId = useMemo(() => {
    const raw = selectedIds[0]
    if (!raw) return null
    return raw.startsWith('mind-') ? raw.slice(5) : raw
  }, [selectedIds])

  useEffect(() => {
    if (readOnly || !activeId) return
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        commitDoc(addMindChild(doc, activeId))
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && activeId !== doc.root.id) {
        e.preventDefault()
        commitDoc(deleteMindNode(doc, activeId))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeId, commitDoc, doc, readOnly])

  const zoom = useCanvasZoom()

  return (
    <div className={`mindmap-view selecting${selecting ? ' is-selecting' : ''}`}>
      <div
        className="mindmap-canvas-scroll"
        data-panning={zoom.panning ? 'true' : 'false'}
        {...zoom.viewportProps}
      >
        <div ref={zoom.wrapperRef} className="canvas-pan-wrapper" style={zoom.contentStyle}>
          <svg
            className="mindmap-canvas"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
          >
          {layout.edges.map((e) => {
            const a = layout.nodes.find((n) => n.id === e.from)
            const b = layout.nodes.find((n) => n.id === e.to)
            if (!a || !b) return null
            const x1 = a.x + a.width
            const y1 = a.y + a.height / 2
            const x2 = b.x
            const y2 = b.y + b.height / 2
            const mx = (x1 + x2) / 2
            return (
              <path
                key={`${e.from}-${e.to}`}
                className="mindmap-edge"
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
              />
            )
          })}
          {layout.nodes.map((n) => {
            const isSel =
              selected.has(`mind-${n.id}`) || selected.has(n.id) || activeId === n.id
            const isEdit = editingId === n.id
            return (
              <g
                key={n.id}
                className={`mindmap-node diagram-pick-target preview-select-region office-pick-target${
                  isSel ? ' selected is-selected' : ''
                }${n.depth === 0 ? ' is-root' : ''}`}
                data-block-id={`mind-${n.id}`}
                transform={`translate(${n.x}, ${n.y})`}
              >
                <rect
                  width={n.width}
                  height={n.height}
                  rx={8}
                  ry={8}
                  className="mindmap-node-plate"
                  onMouseDown={(ev) => {
                    if (isEdit) return
                    scheduleClickPick(ev.nativeEvent, () => pickNode(n.id, ev))
                  }}
                  onDoubleClick={(ev) => {
                    ev.preventDefault()
                    if (readOnly) return
                    setEditingId(n.id)
                    setDraft(n.title)
                  }}
                />
                {isEdit ? (
                  <foreignObject x={4} y={4} width={n.width - 8} height={n.height - 8}>
                    <input
                      className="mindmap-node-input"
                      value={draft}
                      autoFocus
                      onChange={(e) => liveRename(n.id, e.target.value)}
                      onBlur={() => {
                        if (editingId) {
                          commitDoc(updateMindNodeTitle(doc, editingId, draft.trim() || 'Topic'))
                        }
                        setEditingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                  </foreignObject>
                ) : (
                  <text
                    x={n.width / 2}
                    y={n.height / 2}
                    className="mindmap-node-label"
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.title.length > 28 ? `${n.title.slice(0, 26)}…` : n.title}
                  </text>
                )}
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
