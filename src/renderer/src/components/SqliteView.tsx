/**
 * Read-only SQLite browser: table list + paged grid.
 * Table / column / row / cell selection mirrors CSV sheet chrome for Agent context.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import type { SqliteDatabaseInfo, SqliteQueryResult } from '@shared/ipc'
import { handleClickPickMouseDown, type ClickPickPointer } from '../lib/clickPick'
import { useT } from '../i18n/useT'

const PAGE = 100

function dbRowId(table: string, absRow: number): string {
  return `db-row-${table}-${absRow}`
}

function dbCellId(table: string, absRow: number, col: number): string {
  return `db-cell-${table}-r${absRow}-c${col}`
}

function dbColId(table: string, col: string, colIndex: number): string {
  return `db-col-${table}-${colIndex}-${col}`
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
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState<SqliteQueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const activeMeta = tables.find((tb) => tb.name === active) ?? tables[0]

  const load = useCallback(
    async (table: string, off: number) => {
      if (!table) return
      setLoading(true)
      try {
        const result = await window.vav.files.dbQuery(path, table, off, PAGE)
        setQuery(result)
      } catch (err) {
        setQuery({
          columns: [],
          rows: [],
          total: 0,
          offset: off,
          limit: PAGE,
          error: (err as Error).message
        })
      } finally {
        setLoading(false)
      }
    },
    [path]
  )

  useEffect(() => {
    if (!active && tables[0]) setActive(tables[0].name)
  }, [tables, active])

  useEffect(() => {
    setOffset(0)
  }, [active])

  useEffect(() => {
    if (!active) return
    void load(active, offset)
  }, [active, offset, load])

  // Keep the selected row/cell page in view when selection jumps (e.g. re-open card).
  useEffect(() => {
    if (!active) return
    for (const id of selectedIds) {
      const rowMatch = new RegExp(`^db-row-${escapeRegExp(active)}-(\\d+)$`).exec(id)
      const cellMatch = new RegExp(`^db-cell-${escapeRegExp(active)}-r(\\d+)-c\\d+$`).exec(id)
      const abs = rowMatch
        ? Number(rowMatch[1])
        : cellMatch
          ? Number(cellMatch[1])
          : -1
      if (abs < 0) continue
      if (abs < offset || abs >= offset + PAGE) {
        setOffset(Math.floor(abs / PAGE) * PAGE)
      }
      break
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, active])

  if (tables.length === 0) {
    return <div className="muted" style={{ padding: 16 }}>{t('preview.dbEmpty')}</div>
  }

  const columns = query?.columns?.length
    ? query.columns
    : activeMeta?.columns ?? []
  const rows = query?.rows ?? []
  const total = query?.total ?? activeMeta?.rowCount ?? 0
  const end = Math.min(total, offset + rows.length)
  const tableId = `db-table-${active}`

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

  const pickRow = (rowIndex: number, cells: string[], event: React.MouseEvent): void => {
    const abs = offset + rowIndex
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
    rowIndex: number,
    cells: string[],
    colIndex: number,
    event: React.MouseEvent
  ): void => {
    const abs = offset + rowIndex
    const cell = cells[colIndex] ?? ''
    // Empty cells promote to row select (same as CSV sheet).
    if (!cell.trim()) {
      pickRow(rowIndex, cells, event)
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
              : `Rows ${offset + 1}–${Math.max(offset, end)} / ${total}`}
            {loading ? ` · ${t('common.loading')}` : ''}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn ghost sm"
            disabled={offset <= 0 || loading}
            title={t('common.pageUp')}
            aria-label={t('common.pageUp')}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
          >
            ↑
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={offset + PAGE >= total || loading}
            title={t('common.pageDown')}
            aria-label={t('common.pageDown')}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            ↓
          </button>
        </div>

        {query?.error && (
          <div className="office-native-status error" style={{ margin: 12 }}>
            {query.error}
          </div>
        )}

        <div className="sqlite-sheet-wrap">
          <table className="csv-sheet sqlite-sheet">
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
              {rows.map((row, ri) => {
                const abs = offset + ri
                const rowId = dbRowId(active, abs)
                const rowOn = selecting && selected.has(rowId)
                // Soft-tint the row if any of its cells are selected (CSV parity).
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
                      onMouseDown={selecting ? (e) => pickRow(ri, row, e) : undefined}
                    >
                      {abs + 1}
                    </th>
                    {columns.map((_, ci) => {
                      const cell = row[ci] ?? ''
                      const cellId = dbCellId(active, abs, ci)
                      const on = selecting && selected.has(cellId)
                      return (
                        <td
                          key={cellId}
                          className={`preview-select-region${on ? ' selected' : ''}${
                            cell ? '' : ' is-empty'
                          }`}
                          data-block-id={cellId}
                          title={cell}
                          onMouseDown={
                            selecting ? (e) => pickCell(ri, row, ci, e) : undefined
                          }
                        >
                          {cell}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {!loading && rows.length === 0 && !query?.error && (
                <tr>
                  <td colSpan={columns.length + 1} className="muted" style={{ padding: 16 }}>
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
