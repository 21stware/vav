/**
 * Mermaid / Graphviz full-bleed file canvas.
 * No Source tab / chrome — live re-render on text change; whole-node pick.
 */

import { useEffect, useRef, useState } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import { scheduleClickPick } from '../../lib/clickPick'
import {
  annotateDiagramPickTargets,
  syncDiagramSelection,
  themeGraphvizSource,
  type DiagramSvgKind
} from '../../lib/diagramSvgPick'
import { useT } from '../../i18n/useT'
import { useCanvasZoom } from './canvasZoom'

export type DiagramFileKind = DiagramSvgKind

export function DiagramFileView({
  kind,
  text,
  selecting,
  selectedIds,
  onSelect
}: {
  kind: DiagramFileKind
  text: string
  selecting: boolean
  selectedIds: string[]
  /** Kept for API compat; editing is via agent write / external file change → live re-render. */
  readOnly?: boolean
  onSelect: (block: PreviewBlock, event?: React.MouseEvent | null) => void
  onSourceChange?: (source: string) => void
}): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const renderGen = useRef(0)
  const zoom = useCanvasZoom()

  // Live re-render whenever source text changes (agent stream / Save / disk).
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const gen = ++renderGen.current
    let cancelled = false
    const dark =
      typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'

    const run = async (): Promise<void> => {
      setBusy(true)
      setError(null)
      try {
        const src = text.trim()
        if (!src) {
          if (!cancelled && hostRef.current) hostRef.current.innerHTML = ''
          return
        }
        let svg = ''
        if (kind === 'mermaid') {
          const mermaid = (await import('mermaid')).default
          // Match app mermaid theme tokens
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: dark ? 'dark' : 'neutral',
            fontFamily: 'var(--font-ui, system-ui, sans-serif)',
            themeVariables: dark
              ? {
                  darkMode: true,
                  background: 'transparent',
                  primaryColor: '#3a3a42',
                  primaryTextColor: '#efeff1',
                  primaryBorderColor: '#6a6a74',
                  lineColor: '#a2a2a9',
                  textColor: '#efeff1',
                  mainBkg: '#3a3a42',
                  nodeBorder: '#6a6a74',
                  clusterBkg: '#2a2a2e'
                }
              : {
                  background: 'transparent',
                  primaryTextColor: '#141416',
                  textColor: '#141416',
                  lineColor: '#5c5c66'
                }
          })
          const id = `mmd-file-${Date.now()}-${gen}`
          const { svg: out } = await mermaid.render(id, src)
          svg = out
        } else {
          const { instance } = await import('@viz-js/viz')
          const viz = await instance()
          const themed = themeGraphvizSource(src, dark)
          svg = viz.renderString(themed, { format: 'svg' })
        }
        if (cancelled || gen !== renderGen.current || !hostRef.current) return
        hostRef.current.innerHTML = svg
        annotateDiagramPickTargets(hostRef.current, kind)
        syncDiagramSelection(hostRef.current, selectedIds)
      } catch (err) {
        if (!cancelled && gen === renderGen.current) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (gen === renderGen.current) setBusy(false)
      }
    }

    // Short debounce so streaming agent writes re-paint smoothly, not per-keystroke thrash
    const timer = window.setTimeout(() => void run(), 40)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // selectedIds applied in separate effect after paint
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-annotate after each render
  }, [kind, text])

  useEffect(() => {
    if (hostRef.current) syncDiagramSelection(hostRef.current, selectedIds)
  }, [selectedIds])

  return (
    <div
      className={`diagram-file-view selecting${selecting ? ' is-selecting' : ''}`}
      data-kind={kind}
      data-busy={busy ? 'true' : 'false'}
    >
      {error ? (
        <div className="diagram-file-error muted">
          {error}
          <div className="diagram-file-error-hint">{t('diagram.renderFailed')}</div>
        </div>
      ) : null}
      <div
        className="diagram-file-scroll"
        data-panning={zoom.panning ? 'true' : 'false'}
        {...zoom.viewportProps}
        onMouseDown={(ev) => {
          if (!selecting || zoom.panning) return
          const raw = ev.target as Element | null
          const target = raw?.closest?.('.diagram-pick-target') as HTMLElement | null
          if (!target || !hostRef.current?.contains(target)) return
          const label = target.dataset.diagramLabel || target.textContent?.trim() || 'node'
          const id = target.dataset.blockId || `diag-${target.dataset.diagramId || 'node'}`
          scheduleClickPick(ev.nativeEvent, () => {
            onSelect(
              {
                id,
                kind: 'object',
                label,
                text: label,
                startLine: 1,
                endLine: 1
              },
              ev
            )
          })
        }}
      >
        <div ref={zoom.wrapperRef} className="canvas-pan-wrapper" style={zoom.contentStyle}>
          <div ref={hostRef} className="diagram-file-host" />
        </div>
      </div>
      {zoom.controls}
    </div>
  )
}
