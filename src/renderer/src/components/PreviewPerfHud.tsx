import { useEffect, useState } from 'react'

type MarkRow = { name: string; ms: number }

/**
 * Dev-only overlay of preview performance marks
 * (`preview:*` / `viewer:*` from FilePreviewWindow + FileViewer).
 */
export function PreviewPerfHud(): React.JSX.Element | null {
  const [rows, setRows] = useState<MarkRow[]>([])
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const tick = (): void => {
      try {
        const marks = performance
          .getEntriesByType('mark')
          .filter((m) => m.name.startsWith('preview:') || m.name.startsWith('viewer:'))
          .slice(-16)
          .map((m) => ({ name: m.name.replace(/^(preview|viewer):/, ''), ms: m.startTime }))
        setRows(marks)
      } catch {
        // ignore
      }
    }
    tick()
    const id = window.setInterval(tick, 400)
    return () => window.clearInterval(id)
  }, [])

  if (!import.meta.env.DEV || !open || rows.length === 0) {
    if (!import.meta.env.DEV) return null
    return (
      <button
        type="button"
        className="preview-perf-hud-toggle"
        onClick={() => setOpen(true)}
        title="Preview perf (dev only)"
      >
        <span className="preview-perf-dev-badge">dev</span>
        perf
      </button>
    )
  }

  const origin = rows[0]?.ms ?? 0
  return (
    <div className="preview-perf-hud" role="status" data-dev-only="">
      <div className="preview-perf-hud-head">
        <span className="preview-perf-hud-title">
          <span className="preview-perf-dev-badge">dev</span>
          preview perf
        </span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Hide" title="Hide">
          ×
        </button>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={`${r.name}-${r.ms}`}>
            <code>{r.name}</code>
            <span>{Math.max(0, r.ms - origin).toFixed(0)}ms</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
