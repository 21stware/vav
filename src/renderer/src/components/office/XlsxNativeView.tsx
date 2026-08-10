/**
 * XLSX via SheetJS in the renderer — full used range in memory, windowed DOM.
 * Performance via virtualization, not user-facing "truncated to N×M" chrome.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument } from '@shared/structuredDoc'
import { handleClickPickMouseDown } from '../../lib/clickPick'
import { loadFileBuffer } from '../../lib/officeBinary'
import { useSheetVirtualWindow } from '../../lib/useSheetVirtualWindow'
import { useT } from '../../i18n/useT'

/**
 * Soft in-memory budget for pathological workbooks. Silent — never shown as a
 * preview truncation banner; the used range is preferred when it fits.
 */
const MAX_CELLS = 500_000
const MAX_COLS_HARD = 512
/** First-paint row cap — full sheet expands on idle. */
const FIRST_PAINT_ROWS = 120

function gridsFromWorkbook(
  wb: XLSX.WorkBook,
  rowCap?: number
): { name: string; grid: string[][] }[] {
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
    const rows = Math.min(fullRows, rowCap != null ? Math.min(rowBudget, rowCap) : rowBudget)
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
  return next
}

export function XlsxNativeView({
  path,
  revision = 0,
  selecting,
  selectedIds,
  onPick,
  onReady,
  seedStructured
}: {
  path: string
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
  onReady?: () => void
  /** Progressive structured chunk from main — paints before full buffer parse. */
  seedStructured?: StructuredDocument | null
}): React.JSX.Element {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheets, setSheets] = useState<{ name: string; grid: string[][] }[]>([])
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const readyFired = useRef(false)
  /** True once main-process structured rows painted — skips open-path SheetJS. */
  const seededFromMain = useRef(false)
  /** Keep prior grid on revision until the next parse paints. */
  const hasGridRef = useRef(false)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  // Prefer main-pushed row chunks (partial → full). Avoids a second SheetJS parse on open.
  useEffect(() => {
    if (!seedStructured || seedStructured.kind !== 'xlsx') return
    const seeded = seedStructured.sections
      .filter((s) => s.kind === 'sheet')
      .map((s) => ({ name: s.title, grid: s.grid ?? [] }))
    if (seeded.length === 0) return
    seededFromMain.current = true
    hasGridRef.current = true
    setSheets(seeded)
    setActive((i) => (i < seeded.length ? i : 0))
    setLoading(false)
    setError(null)
    if (!readyFired.current) {
      readyFired.current = true
      onReady?.()
    }
  }, [seedStructured, onReady])

  useEffect(() => {
    let cancelled = false
    let idleId: number | null = null
    let waitTimer: number | null = null
    let expandTimer: number | null = null
    readyFired.current = false
    seededFromMain.current = false
    setError(null)
    if (!hasGridRef.current) {
      setSheets([])
      setActive(0)
      resetScroll()
      setLoading(true)
    }

    const runLocalParse = async (): Promise<void> => {
      if (cancelled || seededFromMain.current) return
      try {
        const buf = await loadFileBuffer(path)
        if (cancelled || seededFromMain.current) return
        const first = XLSX.read(buf, {
          type: 'array',
          cellDates: true,
          sheetRows: FIRST_PAINT_ROWS
        })
        if (cancelled || seededFromMain.current) return
        hasGridRef.current = true
        setSheets(gridsFromWorkbook(first, FIRST_PAINT_ROWS))
        setActive(0)
        resetScroll()
        setLoading(false)
        if (!readyFired.current) {
          readyFired.current = true
          onReady?.()
        }

        const expand = (): void => {
          if (cancelled || seededFromMain.current) return
          const full = XLSX.read(buf, { type: 'array', cellDates: true })
          if (cancelled || seededFromMain.current) return
          setSheets(gridsFromWorkbook(full))
        }
        if (typeof requestIdleCallback === 'function') {
          idleId = requestIdleCallback(expand, { timeout: 1200 })
        } else {
          expandTimer = window.setTimeout(expand, 200)
        }
      } catch (err) {
        if (!cancelled && !seededFromMain.current) {
          setError((err as Error).message || t('preview.loadFailed'))
          setLoading(false)
          onReady?.()
        }
      }
    }

    // Brief wait so inspectStructured can paint first and skip dual parse.
    waitTimer = window.setTimeout(() => {
      void runLocalParse()
    }, 160)

    return () => {
      cancelled = true
      if (waitTimer != null) window.clearTimeout(waitTimer)
      if (expandTimer != null) window.clearTimeout(expandTimer)
      if (idleId != null && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idleId)
      }
    }
  }, [path, revision, t, onReady])

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

  const {
    rowStart,
    rowEnd,
    topPad,
    bottomPad,
    revealRow,
    onScroll: onWrapScroll,
    resetScroll
  } = useSheetVirtualWindow(wrapRef, grid.length, `${path}:${active}:${grid.length}`)

  const slice = grid.slice(rowStart, rowEnd)
  const visibleCols = useMemo(
    () => Array.from({ length: colCount }, (_, i) => i),
    [colCount]
  )

  // Keep pick targets in the painted row window.
  useEffect(() => {
    for (const id of selectedIds) {
      const cell = /^xlsx-\d+-r(\d+)-c(\d+)$/.exec(id)
      const row = /^xlsx-\d+-row-(\d+)$/.exec(id)
      const ri = cell ? Number(cell[1]) : row ? Number(row[1]) : null
      if (ri == null) continue
      if (ri < rowStart || ri >= rowEnd) revealRow(ri)
      break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, grid.length])

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
                    resetScroll()
                  }}
                >
                  <span className="structured-doc-nav-label">{s.name}</span>
                </button>
              ))}
            </div>
          </nav>
          <div className="structured-sheet-panel">
            <div className="structured-sheet-wrap" ref={wrapRef} onScroll={onWrapScroll}>
              {grid.length === 0 ? (
                <div className="muted" style={{ padding: 12 }}>
                  {t('common.empty')}
                </div>
              ) : (
                <table
                  className="structured-sheet"
                  style={{
                    ['--gutter-digits' as string]: Math.max(2, String(grid.length).length)
                  }}
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
              )}
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
