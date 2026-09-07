const STUB_COLS = 80
const STUB_ROWS = 24
const MIN_SPAWN_COLS = 20
const MIN_SPAWN_ROWS = 8

/** Renderer still passes 80×24 before xterm measures the host. */
export function isStubTerminalGrid(cols: number, rows: number): boolean {
  return cols === STUB_COLS && rows === STUB_ROWS
}

/**
 * Approximate an xterm cell grid from a host box.
 * Cell aspect matches a typical 12–14px monospace (Menlo / SF Mono).
 */
export function estimateGridFromBox(
  width: number,
  height: number,
  fontSize: number
): { cols: number; rows: number } {
  const size = Math.max(11, fontSize)
  const cellW = size * 0.61
  const cellH = size * 1.15
  return {
    cols: Math.max(MIN_SPAWN_COLS, Math.floor(Math.max(0, width) / cellW) || MIN_SPAWN_COLS),
    rows: Math.max(MIN_SPAWN_ROWS, Math.floor(Math.max(0, height) / cellH) || MIN_SPAWN_ROWS)
  }
}

/** True when FitAddon proposes a different cell grid than the live terminal. */
export function proposedCellsDiffer(
  cols: number,
  rows: number,
  proposed: { cols: number; rows: number } | null | undefined
): boolean {
  if (!proposed) return false
  return proposed.cols !== cols || proposed.rows !== rows
}

/**
 * Agent TUIs own the full cell grid (alt-screen / viewport redraw).
 * Scrollback would grow a native scrollbar and steal wheel from the TUI.
 */
export function scrollbackForSurface(surface: 'bash' | 'agent'): number {
  return surface === 'agent' ? 0 : 10_000
}
