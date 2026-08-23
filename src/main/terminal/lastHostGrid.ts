/**
 * Last real terminal size seen from a focused viewer.
 * Renderer still calls create() with the 80×24 stub before xterm measures;
 * reuse the last grid so the agent TUI's first paint is already the window size.
 */

let lastCols = 0
let lastRows = 0

const MIN_COLS = 20
const MIN_ROWS = 8
const STUB_COLS = 80
const STUB_ROWS = 24

export function rememberHostGrid(cols: number, rows: number): void {
  const c = Math.floor(cols)
  const r = Math.floor(rows)
  if (c >= MIN_COLS && r >= MIN_ROWS) {
    lastCols = c
    lastRows = r
  }
}

export function spawnGrid(
  requestedCols: number,
  requestedRows: number
): { cols: number; rows: number } {
  const stub = requestedCols === STUB_COLS && requestedRows === STUB_ROWS
  if (stub && lastCols >= MIN_COLS && lastRows >= MIN_ROWS) {
    return { cols: lastCols, rows: lastRows }
  }
  return {
    cols: Math.max(2, Math.floor(requestedCols) || STUB_COLS),
    rows: Math.max(1, Math.floor(requestedRows) || STUB_ROWS)
  }
}

export function resetHostGrid(): void {
  lastCols = 0
  lastRows = 0
}
