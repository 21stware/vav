/**
 * XLSX via SheetJS in the renderer — mature data layer + real HTML table.
 */

import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { PreviewBlock } from '@shared/previewBlock'
import { handleClickPickMouseDown } from '../../lib/clickPick'
import { loadFileBuffer } from '../../lib/officeBinary'
import { useT } from '../../i18n/useT'

const MAX_ROWS = 500
const MAX_COLS = 50
const WINDOW = 80

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
  const [sheets, setSheets] = useState<
    { name: string; grid: string[][] }[]
  >([])
  const [active, setActive] = useState(0)
  const [rowStart, setRowStart] = useState(0)
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
          const rows = Math.min(range.e.r - range.s.r + 1, MAX_ROWS)
          const cols = Math.min(range.e.c - range.s.c + 1, MAX_COLS)
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
  const colCount = Math.max(1, ...grid.map((r) => r.length), 1)
  const end = Math.min(grid.length, rowStart + WINDOW)
  const slice = grid.slice(rowStart, end)

  const pick = (
    id: string,
    text: string,
    kind: PreviewBlock['kind'],
    event: React.MouseEvent
  ): void => {
    handleClickPickMouseDown(event, () => {
      // Synthetic MouseEvent for office pick consumers that only check button.
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
                  onClick={() => {
                    setActive(i)
                    setRowStart(0)
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
                Rows {grid.length === 0 ? 0 : rowStart + 1}–{end} / {grid.length}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn ghost sm"
                disabled={rowStart <= 0}
                title={t('common.pageUp')}
                aria-label={t('common.pageUp')}
                onClick={() => setRowStart((s) => Math.max(0, s - WINDOW))}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn ghost sm"
                disabled={end >= grid.length}
                title={t('common.pageDown')}
                aria-label={t('common.pageDown')}
                onClick={() =>
                  setRowStart((s) =>
                    Math.min(Math.max(0, grid.length - WINDOW), s + WINDOW)
                  )
                }
              >
                ↓
              </button>
            </div>
            <div className="structured-sheet-wrap">
              <table className="structured-sheet">
                <thead>
                  <tr>
                    <th className="structured-sheet-gutter" />
                    {Array.from({ length: colCount }, (_, ci) => (
                      <th key={ci} className="structured-sheet-colhead">
                        {colLabel(ci)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
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
                        {Array.from({ length: colCount }, (_, ci) => {
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
