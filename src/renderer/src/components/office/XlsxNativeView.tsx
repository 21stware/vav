/**
 * XLSX via SheetJS in the renderer — full used range in memory, windowed DOM.
 * Performance via virtualization, not user-facing "truncated to N×M" cuts.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import type { PreviewBlock } from '@shared/previewBlock'
import { handleClickPickMouseDown } from '../../lib/clickPick'
import { loadFileBuffer } from '../../lib/officeBinary'
import { useT } from '../../i18n/useT'

/** Rows painted at once. */
const ROW_WINDOW = 80
/** Columns painted at once for very wide sheets. */
const COL_WINDOW = 40
/**
 * Soft in-memory budget for pathological workbooks. Silent — never shown as a
 * preview truncation banner; the used range is preferred when it fits.
 */
const MAX_CELLS = 500_000
const MAX_COLS_HARD = 512
/** Approximate row height for spacer-based virtual scroll. */
const ROW_PX = 28

export function XlsxNativeView({
  path,
  revision = 0,
  selecting,
  selectedIds,
  onPick
}: {
  path: string
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
}): React.JSX.Element {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheets, setSheets] = useState<{ name: string; grid: string[][] }[]>([])
  const [active, setActive] = useState(0)
  const [rowStart, setRowStart] = useState(0)
  const [colStart, setColStart] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const syncingScroll = useRef(false)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const buf = await loadFileBuffer(path)
        if (cancelled) return
        const wb = XLSX.read(buf, { type: 'array', cellDates: true })
        const next: { name: string; grid: string[][] }[] = []
        for (const name of wb.SheetNames) {
          const sheet = wb.Sheets[name]
          if (!sheet) continue
          const ref = sheet['!ref']
          if (!ref) {
            next.push({ name, grid: [] })
            continue
          }
          const range = XLSX.utils.decode_range(ref)
          const fullRows = Math.max(0, range.e.r - range.s.r + 1)
          const fullCols = Math.max(0, range.e.c - range.s.c + 1)
          const cols = Math.min(fullCols, MAX_COLS_HARD)
          const rowBudget = Math.max(1, Math.floor(MAX_CELLS / Math.max(1, cols)))
          const rows = Math.min(fullRows, rowBudget)
          const grid: string[][] = []
          for (let r = 0; r < rows; r++) {
            const line: string[] = []
            for (let c = 0; c < cols; c++) {
              const addr = XLSX.utils.encode_cell({
                r: range.s.r + r,
                c: range.s.c + c
              })
              const cell = sheet[addr]
              line.push(
                cell == null
                  ? ''
                  : cell.w != null
                    ? String(cell.w)
                    : cell.v != null
                      ? String(cell.v)
                      : ''
              )
            }
            grid.push(line)
          }
          next.push({ name, grid })
        }
        setSheets(next)
        setActive(0)
        setRowStart(0)
        setColStart(0)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || t('preview.loadFailed'))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, revision, t])

  const sheet = sheets[active]
  const grid = sheet?.grid ?? []
  const colCount = useMemo(() => {
    let max = 1
    for (let i = 0; i < grid.length; i++) {
      const n = grid[i]?.length ?? 0
      if (n > max) max = n
    }
    return max
  }, [grid])

  const rowEnd = Math.min(grid.length, rowStart + ROW_WINDOW)
  const colEnd = Math.min(colCount, colStart + COL_WINDOW)
  const slice = grid.slice(rowStart, rowEnd)
  const visibleCols = useMemo(
    () => Array.from({ length: colEnd - colStart }, (_, i) => colStart + i),
    [colStart, colEnd]
  )

  // Keep pick targets in the painted window.
  useEffect(() => {
    for (const id of selectedIds) {
      const cell = /^xlsx-\d+-r(\d+)-c(\d+)$/.exec(id)
      const row = /^xlsx-\d+-row-(\d+)$/.exec(id)
      if (cell) {
        const ri = Number(cell[1])
        const ci = Number(cell[2])
        if (ri < rowStart || ri >= rowStart + ROW_WINDOW) {
          setRowStart(Math.max(0, Math.min(grid.length - ROW_WINDOW, ri - 10)))
        }
        if (ci < colStart || ci >= colStart + COL_WINDOW) {
          setColStart(Math.max(0, Math.min(colCount - COL_WINDOW, ci - 4)))
        }
        break
      }
      if (row) {
        const ri = Number(row[1])
        if (ri < rowStart || ri >= rowStart + ROW_WINDOW) {
          setRowStart(Math.max(0, Math.min(grid.length - ROW_WINDOW, ri - 10)))
        }
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, grid.length, colCount])

  // Spacer scroll: keep native scrollbar length = full sheet.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || syncingScroll.current) return
    const target = rowStart * ROW_PX
    if (Math.abs(el.scrollTop - target) > ROW_PX / 2) {
      syncingScroll.current = true
      el.scrollTop = target
      requestAnimationFrame(() => {
        syncingScroll.current = false
      })
    }
  }, [rowStart])

  const onWrapScroll = (): void => {
    const el = wrapRef.current
    if (!el || syncingScroll.current) return
    const next = Math.max(
      0,
      Math.min(Math.max(0, grid.length - ROW_WINDOW), Math.floor(el.scrollTop / ROW_PX))
    )
    if (next !== rowStart) setRowStart(next)
  }

  const pick = (
    id: string,
    text: string,
    kind: PreviewBlock['kind'],
    event: React.MouseEvent
  ): void => {
    handleClickPickMouseDown(event, () => {
      const synthetic = { button: 0 } as MouseEvent
      onPick(
        {
          id,
          kind,
          text: text.slice(0, 8000),
          label: text.slice(0, 64) || id,
          startLine: 1,
          endLine: 1
        },
        synthetic
      )
    })
  }

  const topPad = rowStart * ROW_PX
  const bottomPad = Math.max(0, grid.length - rowEnd) * ROW_PX
  const paintedColSpan = visibleCols.length + 1

  return (
    <div className={`office-native-root xlsx-root${selecting ? ' selecting' : ''}`}>
      {loading && <div className="office-native-status muted">{t('common.loading')}</div>}
      {error && (
        <div className="office-native-status error">
          <strong>{t('preview.loadFailed')}</strong>
          <div className="muted tiny">{error}</div>
        </div>
      )}
      {!loading && !error && (
        <>
          <nav className="structured-doc-nav">
            <div className="structured-doc-nav-scroll">
              {sheets.map((s, i) => (
                <button
                  key={s.name}
                  type="button"
                  className={`structured-doc-nav-item${i === active ? ' active' : ''}`}
                  title={s.name}
                  onClick={() => {
                    setActive(i)
                    setRowStart(0)
                    setColStart(0)
                    wrapRef.current?.scrollTo({ top: 0 })
                  }}
                >
                  <span className="structured-doc-nav-label">{s.name}</span>
                </button>
              ))}
            </div>
          </nav>
          <div className="structured-sheet-panel">
            <div className="structured-sheet-toolbar muted tiny">
              <span>
                {grid.length === 0
                  ? t('common.empty')
                  : `Rows ${rowStart + 1}–${rowEnd} / ${grid.length} · Cols ${colStart + 1}–${colEnd} / ${colCount}`}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn ghost sm"
                disabled={colStart <= 0}
                title={t('common.pageLeft')}
                aria-label={t('common.pageLeft')}
                onClick={() => setColStart((s) => Math.max(0, s - COL_WINDOW))}
              >
                ←
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={colEnd >= colCount}
                title={t('common.pageRight')}
                aria-label={t('common.pageRight')}
                onClick={() =>
                  setColStart((s) =>
                    Math.min(Math.max(0, colCount - COL_WINDOW), s + COL_WINDOW)
                  )
                }
              >
                →
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={rowStart <= 0}
                title={t('common.pageUp')}
                aria-label={t('common.pageUp')}
                onClick={() => setRowStart((s) => Math.max(0, s - ROW_WINDOW))}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={rowEnd >= grid.length}
                title={t('common.pageDown')}
                aria-label={t('common.pageDown')}
                onClick={() =>
                  setRowStart((s) =>
                    Math.min(Math.max(0, grid.length - ROW_WINDOW), s + ROW_WINDOW)
                  )
                }
              >
                ↓
              </button>
            </div>
            <div className="structured-sheet-wrap" ref={wrapRef} onScroll={onWrapScroll}>
              <table
                className="structured-sheet"
                style={{ ['--gutter-digits' as string]: Math.max(2, String(grid.length).length) }}
              >
                <thead>
                  <tr>
                    <th className="structured-sheet-gutter">#</th>
                    {visibleCols.map((ci) => (
                      <th key={ci} className="structured-sheet-colhead">
                        {colLabel(ci)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {topPad > 0 && (
                    <tr aria-hidden className="structured-sheet-spacer">
                      <td
                        colSpan={paintedColSpan}
                        style={{ height: topPad, padding: 0, border: 'none' }}
                      />
                    </tr>
                  )}
                  {slice.map((row, offset) => {
                    const ri = rowStart + offset
                    const rowId = `xlsx-${active}-row-${ri}`
                    const rowOn = selected.has(rowId)
                    const rowText = row.join('\t')
                    return (
                      <tr key={ri} className={rowOn ? 'selected' : undefined}>
                        <th
                          className="structured-sheet-gutter"
                          onMouseDown={
                            selecting
                              ? (e) => pick(rowId, rowText, 'row', e)
                              : undefined
                          }
                        >
                          {ri + 1}
                        </th>
                        {visibleCols.map((ci) => {
                          const val = row[ci] ?? ''
                          const cellId = `xlsx-${active}-r${ri}-c${ci}`
                          const on = selected.has(cellId)
                          return (
                            <td
                              key={ci}
                              className={`preview-select-region${on ? ' selected' : ''}`}
                              data-block-id={cellId}
                              title={val}
                              onMouseDown={
                                selecting
                                  ? (e) =>
                                      pick(
                                        val ? cellId : rowId,
                                        val || rowText,
                                        val ? 'cell-table' : 'row',
                                        e
                                      )
                                  : undefined
                              }
                            >
                              {val}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {bottomPad > 0 && (
                    <tr aria-hidden className="structured-sheet-spacer">
                      <td
                        colSpan={paintedColSpan}
                        style={{ height: bottomPad, padding: 0, border: 'none' }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function colLabel(index: number): string {
  let n = index
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}
