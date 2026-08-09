/**
 * Block-selectable structured document canvas (PDF / DOCX / XLSX / PPTX).
 *
 * Layout goals:
 * - One section visible at a time (page / slide / sheet) so large docs stay usable
 * - Sheet rows windowed (virtual slice) instead of mounting thousands of cells
 * - Selection outline matches MD/code pick chrome
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument, StructuredSection } from '@shared/structuredDoc'
import { handleClickPickMouseDown } from '../lib/clickPick'
import { useT } from '../i18n/useT'

const SHEET_ROW_WINDOW = 60

export function StructuredDocView({
  doc,
  selecting,
  selectedIds,
  onSelect
}: {
  doc: StructuredDocument
  selecting: boolean
  selectedIds: string[]
  onSelect: (id: string, event?: React.MouseEvent | null) => void
}): React.JSX.Element {
  const t = useT()
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const [activeSectionId, setActiveSectionId] = useState(doc.sections[0]?.id ?? '')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset section when document changes.
  useEffect(() => {
    setActiveSectionId(doc.sections[0]?.id ?? '')
    scrollRef.current?.scrollTo({ top: 0 })
  }, [doc.path, doc.kind, doc.sections])

  // If selection lands in another section, jump the nav there.
  useEffect(() => {
    if (selectedIds.length === 0) return
    const hit = selectedIds[selectedIds.length - 1]!
    for (const section of doc.sections) {
      if (section.id === hit || section.blocks.some((b) => containsId(b, hit))) {
        if (section.id !== activeSectionId) setActiveSectionId(section.id)
        break
      }
    }
  }, [selectedIds, doc.sections, activeSectionId])

  const active =
    doc.sections.find((s) => s.id === activeSectionId) ?? doc.sections[0] ?? null
  const multi = doc.sections.length > 1

  return (
    <div
      className={`structured-doc kind-${doc.kind}${selecting ? ' selecting' : ''}`}
      data-kind={doc.kind}
    >
      {doc.warnings
        ?.filter((w) => !isSilentPreviewWindowWarning(w))
        .map((w) => (
          <div key={w} className="structured-doc-warning muted tiny">
            {w}
          </div>
        ))}

      {doc.sections.length === 0 && (
        <div className="structured-doc-empty muted">{t('preview.emptyFile')}</div>
      )}

      {multi && (
        <nav className="structured-doc-nav" aria-label={doc.kind}>
          <div className="structured-doc-nav-scroll">
            {doc.sections.map((section, index) => {
              const on = section.id === active?.id
              const hasSel =
                selected.has(section.id) ||
                section.blocks.some((b) => selectedIds.some((id) => containsId(b, id)))
              return (
                <button
                  key={section.id}
                  type="button"
                  className={`structured-doc-nav-item${on ? ' active' : ''}${hasSel ? ' has-selection' : ''}`}
                  title={section.title}
                  onClick={() => {
                    setActiveSectionId(section.id)
                    scrollRef.current?.scrollTo({ top: 0 })
                  }}
                >
                  <span className="structured-doc-nav-index">{index + 1}</span>
                  <span className="structured-doc-nav-label">{section.title}</span>
                </button>
              )
            })}
          </div>
        </nav>
      )}

      <div className="structured-doc-canvas" ref={scrollRef}>
        {active && (
          <StructuredSectionView
            section={active}
            selecting={selecting}
            selected={selected}
            onSelect={onSelect}
            showTitle={!multi}
          />
        )}
      </div>
    </div>
  )
}

function containsId(block: PreviewBlock, id: string): boolean {
  if (block.id === id) return true
  return !!block.children?.some((c) => containsId(c, id))
}

function StructuredSectionView({
  section,
  selecting,
  selected,
  onSelect,
  showTitle
}: {
  section: StructuredSection
  selecting: boolean
  selected: Set<string>
  onSelect: (id: string, event?: React.MouseEvent | null) => void
  showTitle: boolean
}): React.JSX.Element {
  const sectionSelected = selected.has(section.id)
  const paper = section.kind === 'page' || section.kind === 'slide' || section.kind === 'body'

  return (
    <section
      className={[
        'structured-section',
        `kind-${section.kind}`,
        paper ? 'is-paper' : '',
        sectionSelected ? 'selected' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-block-id={section.id}
    >
      {showTitle && (
        <header
          className={`structured-section-head preview-select-region${sectionSelected ? ' selected' : ''}`}
          onMouseDown={
            selecting
              ? (e) => handleClickPickMouseDown(e, () => onSelect(section.id))
              : undefined
          }
        >
          <span className="structured-section-title" title={section.title}>
            {section.title}
          </span>
          <span className="structured-section-meta muted tiny">
            {section.blocks.length} blocks
          </span>
        </header>
      )}

      {section.kind === 'sheet' && section.grid ? (
        <SheetGrid
          section={section}
          selecting={selecting}
          selected={selected}
          onSelect={onSelect}
        />
      ) : (
        <div className="structured-section-body">
          {section.blocks.map((block) => (
            <BlockNode
              key={block.id}
              block={block}
              selecting={selecting}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
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

function SheetGrid({
  section,
  selecting,
  selected,
  onSelect
}: {
  section: StructuredSection
  selecting: boolean
  selected: Set<string>
  onSelect: (id: string, event?: React.MouseEvent | null) => void
}): React.JSX.Element {
  const t = useT()
  const grid = section.grid ?? []
  const colCount = Math.max(1, ...grid.map((r) => r.length), 1)
  const [windowStart, setWindowStart] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Keep selected row visible in the window.
  useEffect(() => {
    for (let i = 0; i < section.blocks.length; i++) {
      const row = section.blocks[i]!
      if (selected.has(row.id) || row.children?.some((c) => selected.has(c.id))) {
        if (i < windowStart || i >= windowStart + SHEET_ROW_WINDOW) {
          setWindowStart(Math.max(0, i - Math.floor(SHEET_ROW_WINDOW / 3)))
        }
        break
      }
    }
  }, [selected, section.blocks, windowStart])

  const end = Math.min(grid.length, windowStart + SHEET_ROW_WINDOW)
  const slice = grid.slice(windowStart, end)
  const canUp = windowStart > 0
  const canDown = end < grid.length

  return (
    <div className="structured-sheet-panel">
      <div className="structured-sheet-toolbar muted tiny">
        <span>
          Rows {grid.length === 0 ? 0 : windowStart + 1}–{end} of {grid.length}
          {colCount > 0 ? ` · ${colCount} cols` : ''}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn ghost sm"
          disabled={!canUp}
          title={t('common.pageUp')}
          aria-label={t('common.pageUp')}
          onClick={() => setWindowStart((s) => Math.max(0, s - SHEET_ROW_WINDOW))}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={!canDown}
          title={t('common.pageDown')}
          aria-label={t('common.pageDown')}
          onClick={() =>
            setWindowStart((s) => Math.min(Math.max(0, grid.length - SHEET_ROW_WINDOW), s + SHEET_ROW_WINDOW))
          }
        >
          ↓
        </button>
      </div>
      <div
        className="structured-sheet-wrap"
        ref={wrapRef}
        onWheel={(e) => {
          // Page through rows with shift+wheel for large sheets.
          if (!e.shiftKey) return
          e.preventDefault()
          const delta = e.deltaY > 0 ? SHEET_ROW_WINDOW : -SHEET_ROW_WINDOW
          setWindowStart((s) =>
            Math.min(Math.max(0, grid.length - SHEET_ROW_WINDOW), Math.max(0, s + delta))
          )
        }}
      >
        <table
          className={`structured-sheet${selecting ? ' selecting' : ''}`}
          style={{ ['--gutter-digits' as string]: Math.max(2, String(grid.length).length) }}
        >
          <thead>
            <tr>
              <th className="structured-sheet-gutter">#</th>
              {Array.from({ length: colCount }, (_, ci) => (
                <th key={ci} className="structured-sheet-colhead">
                  {colLabel(ci)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, offset) => {
              const ri = windowStart + offset
              const rowBlock = section.blocks[ri]
              const rowId = rowBlock?.id
              const rowOn = rowId ? selected.has(rowId) : false
              return (
                <tr
                  key={ri}
                  className={rowOn ? 'selected' : undefined}
                  data-block-id={rowId}
                  onMouseDown={
                    selecting && rowId
                      ? (e) => {
                          // Row gutter / empty area selects the row.
                          if ((e.target as HTMLElement).closest('td[data-block-id]')) return
                          handleClickPickMouseDown(e, () => onSelect(rowId))
                        }
                      : undefined
                  }
                >
                  <th
                    className="structured-sheet-gutter"
                    onMouseDown={
                      selecting && rowId
                        ? (e) => handleClickPickMouseDown(e, () => onSelect(rowId))
                        : undefined
                    }
                  >
                    {ri + 1}
                  </th>
                  {Array.from({ length: colCount }, (_, ci) => {
                    const cellBlock = rowBlock?.children?.find((c) => c.id.includes(`-c${ci}-`))
                    const cellId = cellBlock?.id
                    const cellOn = cellId ? selected.has(cellId) : false
                    const value = row[ci] ?? ''
                    return (
                      <td
                        key={ci}
                        className={`preview-select-region${cellOn ? ' selected' : ''}${value ? '' : ' is-empty'}`}
                        data-block-id={cellId}
                        title={cellBlock?.label ?? (value ? value.slice(0, 200) : undefined)}
                        onMouseDown={
                          selecting && cellId
                            ? (e) => handleClickPickMouseDown(e, () => onSelect(cellId))
                            : selecting && rowId && !cellId
                              ? (e) => handleClickPickMouseDown(e, () => onSelect(rowId))
                              : undefined
                        }
                      >
                        {value}
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
  )
}

function BlockNode({
  block,
  selecting,
  selected,
  onSelect
}: {
  block: PreviewBlock
  selecting: boolean
  selected: Set<string>
  onSelect: (id: string, event?: React.MouseEvent | null) => void
}): React.JSX.Element {
  const on = selected.has(block.id)

  const handle = selecting
    ? (e: React.MouseEvent) => handleClickPickMouseDown(e, () => onSelect(block.id))
    : undefined

  // DOCX / generic tables → real <table>, not chip rows.
  if (block.kind === 'table' && block.children?.length) {
    const colCount = Math.max(
      1,
      ...block.children.map((r) => r.children?.length ?? r.text.split('\t').length)
    )
    return (
      <div
        className={`structured-docx-table-wrap preview-select-region${on ? ' selected' : ''}`}
        data-block-id={block.id}
        onMouseDown={handle}
      >
        <table className="structured-docx-table">
          <tbody>
            {block.children.map((row) => {
              const rowOn = selected.has(row.id)
              const cells =
                row.children && row.children.length > 0
                  ? row.children
                  : row.text.split('\t').map((text, i) => ({
                      id: `${row.id}-c${i}`,
                      kind: 'cell-table' as const,
                      text,
                      startLine: row.startLine,
                      endLine: row.endLine
                    }))
              // Pad short rows so columns align.
              while (cells.length < colCount) {
                cells.push({
                  id: `${row.id}-pad${cells.length}`,
                  kind: 'cell-table',
                  text: '',
                  startLine: row.startLine,
                  endLine: row.endLine
                })
              }
              return (
                <tr
                  key={row.id}
                  className={rowOn ? 'selected' : undefined}
                  data-block-id={row.id}
                  onMouseDown={
                    selecting
                      ? (e) => {
                          if ((e.target as HTMLElement).closest('td[data-block-id]')) return
                          handleClickPickMouseDown(e, () => onSelect(row.id))
                        }
                      : undefined
                  }
                >
                  {cells.map((cell) => {
                    const cellOn = selected.has(cell.id)
                    return (
                      <td
                        key={cell.id}
                        className={`preview-select-region${cellOn ? ' selected' : ''}`}
                        data-block-id={cell.id}
                        onMouseDown={
                          selecting
                            ? (e) => handleClickPickMouseDown(e, () => onSelect(cell.id))
                            : undefined
                        }
                      >
                        {cell.text}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  if (block.kind === 'row') {
    // Standalone row outside a table block (rare) — still render as a grid line.
    const cells = block.children?.length
      ? block.children
      : block.text.split('\t').map((text, i) => ({
          id: `${block.id}-c${i}`,
          kind: 'cell-table' as const,
          text,
          startLine: block.startLine,
          endLine: block.endLine
        }))
    return (
      <div
        className={`structured-row preview-select-region${on ? ' selected' : ''}`}
        data-block-id={block.id}
        onMouseDown={handle}
      >
        {cells.map((cell) => {
          const cellOn = selected.has(cell.id)
          return (
            <span
              key={cell.id}
              className={`structured-row-cell preview-select-region${cellOn ? ' selected' : ''}`}
              data-block-id={cell.id}
              onMouseDown={
                selecting
                  ? (e) => handleClickPickMouseDown(e, () => onSelect(cell.id))
                  : undefined
              }
            >
              {cell.text || '\u00a0'}
            </span>
          )
        })}
      </div>
    )
  }

  if (block.kind === 'heading') {
    const level = Math.min(6, Math.max(1, block.level ?? 2))
    const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    return (
      <Tag
        className={`structured-block kind-heading level-${level} preview-select-region${on ? ' selected' : ''}`}
        data-block-id={block.id}
        onMouseDown={handle}
      >
        {block.text}
      </Tag>
    )
  }

  return (
    <p
      className={`structured-block kind-paragraph preview-select-region${on ? ' selected' : ''}`}
      data-block-id={block.id}
      onMouseDown={handle}
    >
      {block.text}
    </p>
  )
}

/** Soft index/window caps must not appear as “truncated for preview” banners. */
function isSilentPreviewWindowWarning(warning: string): boolean {
  return (
    /truncated to \d+\s*[x×]\s*\d+/i.test(warning) ||
    (/truncat/i.test(warning) && /for preview/i.test(warning)) ||
    /Sheet .+ truncated/i.test(warning)
  )
}
