import { useEffect, useMemo, useRef } from 'react'
import {
  csvColId,
  csvCellBlock,
  csvRowBlock,
  parseCsvModel,
  type PreviewBlock
} from '../../lib/previewBlocks'
import { handleClickPickMouseDown, type ClickPickPointer } from '../../lib/clickPick'
import { useSheetVirtualWindow } from '../../lib/useSheetVirtualWindow'
import { useT } from '../../i18n/useT'

/** Truncate cell text in the DOM (title still holds full value for hover). */
const CSV_CELL_DISPLAY_CAP = 120

/**
 * Sheet-style CSV: sticky header/gutter, scroll-virtualized rows, cell/row/col pick
 * using the same preview-select-region chrome as code/MD.
 */
export function CsvView({
  model,
  selecting,
  selectedIds,
  onSelect
}: {
  model: ReturnType<typeof parseCsvModel>
  selecting: boolean
  selectedIds: string[]
  onSelect: (
    id: string,
    event?: React.MouseEvent | ClickPickPointer | null,
    hint?: PreviewBlock
  ) => void
}): React.JSX.Element {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const total = model.rows.length
  const {
    rowStart,
    rowEnd,
    topPad,
    bottomPad,
    revealRow,
    onScroll: onWrapScroll,
    resetScroll
  } = useSheetVirtualWindow(wrapRef, total, `${model.headers.join('\0')}:${total}`)

  useEffect(() => {
    resetScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // Keep the selected row visible when selection changes from outside.
  useEffect(() => {
    for (const id of selectedIds) {
      const cell = /^cell-r(\d+)-c(\d+)$/.exec(id)
      const row = /^row-(\d+)$/.exec(id)
      const parsed = cell ? Number(cell[1]) - 1 : row ? Number(row[1]) - 1 : null
      if (parsed == null) continue
      if (parsed >= 0 && parsed < model.rows.length) {
        if (parsed < rowStart || parsed >= rowEnd) revealRow(parsed)
      }
      break
    }
    // Only react to selection identity, not window offsets themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, model.rows.length])

  if (model.headers.length === 0) return <div className="muted">{t('common.empty')}</div>

  // Avoid Math.max(...spread) on huge row arrays (stack/alloc blow-up).
  let maxRowCols = model.headers.length
  const probe = Math.min(model.rows.length, 50)
  for (let i = 0; i < probe; i++) {
    const n = model.rows[i]?.length ?? 0
    if (n > maxRowCols) maxRowCols = n
  }
  const totalCols = Math.max(maxRowCols, 1)
  const visibleColIndexes = Array.from({ length: totalCols }, (_, i) => i)
  const headers = Array.from({ length: totalCols }, (_, i) => model.headers[i] ?? `col${i + 1}`)
  const slice = model.rows.slice(rowStart, rowEnd)
  const paintedColSpan = totalCols + 1

  const pick = (id: string, event: React.MouseEvent, hint?: PreviewBlock): void => {
    // Click (not drag) → conversation pick; drag → native text select/copy.
    handleClickPickMouseDown(event, () => onSelect(id, null, hint))
  }

  const displayCell = (cell: string): string =>
    cell.length > CSV_CELL_DISPLAY_CAP ? `${cell.slice(0, CSV_CELL_DISPLAY_CAP)}…` : cell

  return (
    <div className={`csv-sheet-root${selecting ? ' selecting' : ''}`}>
      <div className="csv-sheet-wrap file-viewer-table" ref={wrapRef} onScroll={onWrapScroll}>
        <table
          className="csv-sheet"
          style={{ ['--gutter-digits' as string]: Math.max(2, String(total).length) }}
        >
          <thead>
            <tr>
              {/* Sticky row×col junction — keep a glyph so width never collapses to 72px. */}
              <th className="csv-sheet-gutter csv-sheet-corner" aria-hidden="true">
                #
              </th>
              {visibleColIndexes.map((index) => {
                const name = headers[index] ?? `col${index + 1}`
                const id = csvColId(name, index)
                const on = selecting && selected.has(id)
                return (
                  <th
                    key={id}
                    className={`csv-sheet-colhead preview-select-region${on ? ' selected' : ''}`}
                    data-block-id={id}
                    title={name}
                    onMouseDown={
                      selecting
                        ? (e) => {
                            const hint: PreviewBlock = {
                              id,
                              kind: 'col',
                              text: name,
                              label: `col ${name}`,
                              startLine: 1,
                              endLine: total + 1
                            }
                            pick(id, e, hint)
                          }
                        : undefined
                    }
                  >
                    <span className="csv-sheet-col-label">{name || `col ${index + 1}`}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {topPad > 0 && (
              <tr aria-hidden className="csv-sheet-spacer">
                <td
                  colSpan={paintedColSpan}
                  style={{ height: topPad, padding: 0, border: 'none' }}
                />
              </tr>
            )}
            {slice.map((row, offset) => {
              const rowIndex = rowStart + offset
              const rowId = `row-${rowIndex + 1}`
              const rowOn = selecting && selected.has(rowId)
              // Build row hint only if selecting — avoid string work on every paint.
              const rowHint = selecting ? csvRowBlock(headers, row, rowIndex) : undefined
              return (
                <tr key={rowId} className={rowOn ? 'row-selected' : undefined}>
                  <th
                    className={`csv-sheet-gutter preview-select-region${rowOn ? ' selected' : ''}`}
                    data-block-id={rowId}
                    title={selecting ? t('preview.selectRow') : undefined}
                    onMouseDown={
                      selecting && rowHint
                        ? (e) => pick(rowId, e, rowHint)
                        : undefined
                    }
                  >
                    {rowIndex + 1}
                  </th>
                  {visibleColIndexes.map((cellIndex) => {
                    const cell = row[cellIndex] ?? ''
                    const cellId = `cell-r${rowIndex + 1}-c${cellIndex}`
                    const on = selecting && selected.has(cellId)
                    return (
                      <td
                        key={cellId}
                        className={`preview-select-region${on ? ' selected' : ''}${cell ? '' : ' is-empty'}`}
                        data-block-id={cellId}
                        title={cell.length > CSV_CELL_DISPLAY_CAP ? cell : undefined}
                        onMouseDown={
                          selecting
                            ? (e) => {
                                if (!cell.trim()) {
                                  if (rowHint) pick(rowId, e, rowHint)
                                  return
                                }
                                pick(cellId, e, csvCellBlock(headers, row, rowIndex, cellIndex))
                              }
                            : undefined
                        }
                      >
                        {displayCell(cell)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {bottomPad > 0 && (
              <tr aria-hidden className="csv-sheet-spacer">
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
  )
}
