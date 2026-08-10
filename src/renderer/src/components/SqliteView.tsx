/**
 * Read-only SQLite browser: table list + scroll-virtualized grid.
 *
 * Same UX as CSV — continuous scroll, no product pagination. Rows are fetched
 * in technical chunks (≤ MAX_LIMIT) into a cache; only the painted window is
 * mounted (useSheetVirtualWindow spacers).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import type { SqliteDatabaseInfo } from '@shared/ipc'
import { handleClickPickMouseDown, type ClickPickPointer } from '../lib/clickPick'
import { useSheetVirtualWindow } from '../lib/useSheetVirtualWindow'
import { useT } from '../i18n/useT'

/** Match SqliteService MAX_LIMIT — one IPC round-trip fills a chunk. */
const CHUNK = 500

function dbRowId(table: string, absRow: number): string {
  return `db-row-${table}-${absRow}`
}

function dbCellId(table: string, absRow: number, col: number): string {
  return `db-cell-${table}-r${absRow}-c${col}`
}

function dbColId(table: string, col: string, colIndex: number): string {
  return `db-col-${table}-${colIndex}-${col}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function SqliteView({
  path,
  info,
  selecting,
  selectedIds,
  onSelect
}: {
  path: string
  info: SqliteDatabaseInfo
  selecting: boolean
  selectedIds: string[]
  onSelect: (
    id: string,
    event?: React.MouseEvent | ClickPickPointer | null,
    hint?: PreviewBlock
  ) => void
}): React.JSX.Element {
  const t = useT()
  const tables = info.tables
  const [active, setActive] = useState(tables[0]?.name ?? '')
  const [columns, setColumns] = useState<string[]>(() => tables[0]?.columns ?? [])
  const [total, setTotal] = useState(() => tables[0]?.rowCount ?? 0)
  /** Chunk index → rows for that [chunk*CHUNK, (chunk+1)*CHUNK) window. */
  const [chunks, setChunks] = useState<Map<number, string[][]>>(() => new Map())
  const chunksRef = useRef(chunks)
  chunksRef.current = chunks
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const inflightRef = useRef<Set<number>>(new Set())
  const totalRef = useRef(total)
  totalRef.current = total
  /** Bumped on table/path change so late IPC replies don't pollute the new cache. */
  const genRef = useRef(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const activeMeta = tables.find((tb) => tb.name === active) ?? tables[0]

  const {
    rowStart,
    rowEnd,
    topPad,
    bottomPad,
    revealRow,
    onScroll: onWrapScroll,
    resetScroll
  } = useSheetVirtualWindow(wrapRef, total, `${path}\0${active}`)

  useEffect(() => {
    if (!active && tables[0]) setActive(tables[0].name)
  }, [tables, active])

  // Table switch: drop cache and jump to top.
  useEffect(() => {
    genRef.current += 1
    setChunks(new Map())
    chunksRef.current = new Map()
    setError(null)
    inflightRef.current.clear()
    setColumns(activeMeta?.columns ?? [])
    setTotal(activeMeta?.rowCount ?? 0)
    setLoading(false)
    resetScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, path])

  const ensureChunks = useCallback(
    async (table: string, start: number, end: number) => {
      if (!table || end <= start) return
      const gen = genRef.current
      const knownTotal = totalRef.current
      const first = Math.max(0, Math.floor(start / CHUNK) - 1)
      const last = Math.floor(Math.max(0, end - 1) / CHUNK) + 1
      const needed: number[] = []
      for (let c = first; c <= last; c++) {
        if (c < 0) continue
        if (chunksRef.current.has(c) || inflightRef.current.has(c)) continue
        if (knownTotal > 0 && c * CHUNK >= knownTotal) continue
        needed.push(c)
      }
      if (needed.length === 0) return

      for (const c of needed) inflightRef.current.add(c)
      setLoading(true)
      try {
        await Promise.all(
          needed.map(async (c) => {
            try {
              const result = await window.vav.files.dbQuery(path, table, c * CHUNK, CHUNK)
              if (gen !== genRef.current) return
              if (result.error) {
                setError(result.error)
                return
              }
              if (result.columns.length) setColumns(result.columns)
              setTotal(result.total)
              setChunks((prev) => {
                if (prev.has(c)) return prev
                const next = new Map(prev)
                next.set(c, result.rows)
                chunksRef.current = next
                return next
              })
            } catch (err) {
              if (gen !== genRef.current) return
              setError((err as Error).message)
            } finally {
              inflightRef.current.delete(c)
            }
          })
        )
      } finally {
        if (gen === genRef.current) {
          setLoading(inflightRef.current.size > 0)
        }
      }
    },
    [path]
  )

  useEffect(() => {
    if (!active) return
    void ensureChunks(active, rowStart, rowEnd)
  }, [active, rowStart, rowEnd, ensureChunks])

  // Keep the selected row visible when selection jumps from outside.
  useEffect(() => {
    if (!active) return
    for (const id of selectedIds) {
      const rowMatch = new RegExp(`^db-row-${escapeRegExp(active)}-(\\d+)$`).exec(id)
      const cellMatch = new RegExp(
        `^db-cell-${escapeRegExp(active)}-r(\\d+)-c\\d+$`
      ).exec(id)
      const abs = rowMatch
        ? Number(rowMatch[1])
        : cellMatch
          ? Number(cellMatch[1])
          : -1
      if (abs < 0) continue
      if (abs < rowStart || abs >= rowEnd) revealRow(abs)
      break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, active])

  const rowAt = useCallback(
    (abs: number): string[] | null => {
      const c = Math.floor(abs / CHUNK)
      const chunk = chunks.get(c)
      if (!chunk) return null
      return chunk[abs - c * CHUNK] ?? null
    },
    [chunks]
  )

  if (tables.length === 0) {
    return <div className="muted" style={{ padding: 16 }}>{t('preview.dbEmpty')}</div>
  }

  const tableId = `db-table-${active}`
  const paintedColSpan = columns.length + 1
  const sliceIndexes = Array.from(
    { length: Math.max(0, rowEnd - rowStart) },
    (_, i) => rowStart + i
  )

  const pick = (id: string, event: React.MouseEvent, hint: PreviewBlock): void => {
    handleClickPickMouseDown(event, () => onSelect(id, null, hint))
  }

  const pickTable = (event: React.MouseEvent): void => {
    const text = [
      `TABLE ${active}`,
      `columns: ${columns.join(', ')}`,
      `rows: ${total}`
    ].join('\n')
    pick(tableId, event, {
      id: tableId,
      kind: 'table',
      text,
      label: `table ${active}`,
      startLine: 1,
      endLine: 1
    })
  }

  const pickCol = (colIndex: number, event: React.MouseEvent): void => {
    const col = columns[colIndex] ?? `col${colIndex + 1}`
    const id = dbColId(active, col, colIndex)
    pick(id, event, {
      id,
      kind: 'col',
      text: col,
      label: `${active}.${col}`,
      startLine: 1,
      endLine: Math.max(1, total)
    })
  }

  const pickRow = (abs: number, cells: string[], event: React.MouseEvent): void => {
    const id = dbRowId(active, abs)
    const pairs = columns.map((c, i) => `${c}=${cells[i] ?? ''}`)
    pick(id, event, {
      id,
      kind: 'row',
      text: pairs.join(' | '),
      label: `${active} · row ${abs + 1}`,
      startLine: abs + 1,
      endLine: abs + 1
    })
  }

  const pickCell = (
    abs: number,
    cells: string[],
    colIndex: number,
    event: React.MouseEvent
  ): void => {
    const cell = cells[colIndex] ?? ''
    if (!cell.trim()) {
      pickRow(abs, cells, event)
      return
    }
    const col = columns[colIndex] ?? `col${colIndex + 1}`
    const id = dbCellId(active, abs, colIndex)
    pick(id, event, {
      id,
      kind: 'cell-table',
      text: cell,
      label: `${active}.${col} · row ${abs + 1}`,
      startLine: abs + 1,
      endLine: abs + 1
    })
  }

  return (
    <div className={`sqlite-root${selecting ? ' selecting' : ''}`}>
      <nav className="structured-doc-nav">
        <div className="structured-doc-nav-scroll">
          {tables.map((tb) => (
            <button
              key={tb.name}
              type="button"
              className={`structured-doc-nav-item${tb.name === active ? ' active' : ''}${
                selected.has(`db-table-${tb.name}`) ? ' selected' : ''
              }`}
              title={tb.name}
              onClick={() => setActive(tb.name)}
              onMouseDown={
                selecting
                  ? (e) => {
                      if (tb.name !== active) setActive(tb.name)
                      const text = [
                        `TABLE ${tb.name}`,
                        `columns: ${tb.columns.join(', ')}`,
                        `rows: ${tb.rowCount}`
                      ].join('\n')
                      handleClickPickMouseDown(e, () =>
                        onSelect(`db-table-${tb.name}`, null, {
                          id: `db-table-${tb.name}`,
                          kind: 'table',
                          text,
                          label: `table ${tb.name}`,
                          startLine: 1,
                          endLine: 1
                        })
                      )
                    }
                  : undefined
              }
            >
              <span className="structured-doc-nav-label">{tb.name}</span>
              <span className="structured-doc-nav-index muted tiny">{tb.rowCount}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="sqlite-panel">
        <div className="sqlite-toolbar muted tiny">
          <button
            type="button"
            className={`preview-select-region sqlite-table-chip${
              selected.has(tableId) ? ' selected' : ''
            }`}
            onMouseDown={selecting ? pickTable : undefined}
            title={selecting ? t('preview.dbSelectTable') : undefined}
          >
            {active}
          </button>
          <span>
            {total === 0
              ? t('common.empty')
              : t('preview.dbRowCount', { n: total })}
            {loading ? ` · ${t('common.loading')}` : ''}
          </span>
        </div>

        {error && (
          <div className="office-native-status error" style={{ margin: 12 }}>
            {error}
          </div>
        )}

        <div
          className="sqlite-sheet-wrap"
          ref={wrapRef}
          onScroll={onWrapScroll}
        >
          <table
            className="csv-sheet sqlite-sheet"
            style={{
              ['--gutter-digits' as string]: Math.max(2, String(Math.max(total, 1)).length)
            }}
          >
            <thead>
              <tr>
                <th className="csv-sheet-gutter csv-sheet-corner">#</th>
                {columns.map((col, ci) => {
                  const colId = dbColId(active, col, ci)
                  const on = selecting && selected.has(colId)
                  return (
                    <th
                      key={colId}
                      className={`csv-sheet-colhead preview-select-region${on ? ' selected' : ''}`}
                      data-block-id={colId}
                      title={col}
                      onMouseDown={selecting ? (e) => pickCol(ci, e) : undefined}
                    >
                      <span className="csv-sheet-col-label">{col}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {topPad > 0 && (
                <tr aria-hidden className="csv-sheet-spacer">
                  <td
                    colSpan={Math.max(1, paintedColSpan)}
                    style={{ height: topPad, padding: 0, border: 'none' }}
                  />
                </tr>
              )}
              {sliceIndexes.map((abs) => {
                const row = rowAt(abs)
                const rowId = dbRowId(active, abs)
                const rowOn = selecting && selected.has(rowId)
                const cells = row ?? columns.map(() => '')
                const cellSelected =
                  selecting &&
                  columns.some((_, ci) => selected.has(dbCellId(active, abs, ci)))
                return (
                  <tr
                    key={rowId}
                    className={rowOn || cellSelected ? 'row-selected' : undefined}
                  >
                    <th
                      className={`csv-sheet-gutter preview-select-region${rowOn ? ' selected' : ''}`}
                      data-block-id={rowId}
                      title={selecting ? t('preview.selectRow') : undefined}
                      onMouseDown={
                        selecting && row
                          ? (e) => pickRow(abs, cells, e)
                          : undefined
                      }
                    >
                      {abs + 1}
                    </th>
                    {columns.map((_, ci) => {
                      const cell = cells[ci] ?? ''
                      const cellId = dbCellId(active, abs, ci)
                      const on = selecting && selected.has(cellId)
                      const pending = !row
                      return (
                        <td
                          key={cellId}
                          className={`preview-select-region${on ? ' selected' : ''}${
                            cell ? '' : ' is-empty'
                          }${pending ? ' is-pending' : ''}`}
                          data-block-id={cellId}
                          title={pending ? undefined : cell}
                          onMouseDown={
                            selecting && row
                              ? (e) => pickCell(abs, cells, ci, e)
                              : undefined
                          }
                        >
                          {pending ? '' : cell}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {bottomPad > 0 && (
                <tr aria-hidden className="csv-sheet-spacer">
                  <td
                    colSpan={Math.max(1, paintedColSpan)}
                    style={{ height: bottomPad, padding: 0, border: 'none' }}
                  />
                </tr>
              )}
              {!loading && total === 0 && !error && (
                <tr>
                  <td
                    colSpan={Math.max(1, paintedColSpan)}
                    className="muted"
                    style={{ padding: 16 }}
                  >
                    {t('common.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
