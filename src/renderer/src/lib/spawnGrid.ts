import { estimateGridFromBox, isStubTerminalGrid } from './terminalFit'
import { lastTerminalFontSize, peekLiveTerminalGrid } from './terminalRegistryHandle'

/**
 * Real cols/rows for a PTY spawn. Callers still pass 80×24; this measures
 * a live agent xterm or the CLI surface box so the TUI's first paint matches
 * the window. Main `lastHostGrid` remains the fallback when the renderer
 * cannot measure (tests, hidden window).
 */
export function resolveSpawnGrid(
  requestedCols = 80,
  requestedRows = 24,
  surface: 'agent' | 'bash' = 'agent'
): { cols: number; rows: number } {
  if (
    Number.isFinite(requestedCols) &&
    Number.isFinite(requestedRows) &&
    !isStubTerminalGrid(requestedCols, requestedRows)
  ) {
    return {
      cols: Math.max(2, Math.floor(requestedCols)),
      rows: Math.max(1, Math.floor(requestedRows))
    }
  }
  if (typeof document !== 'undefined') {
    const live = peekLiveTerminalGrid()
    if (live) return live
    const el = document.querySelector(`.terminal-stack[data-terminal-surface="${surface}"]`)
    if (el instanceof HTMLElement && el.clientWidth >= 40 && el.clientHeight >= 40) {
      return estimateGridFromBox(el.clientWidth, el.clientHeight, lastTerminalFontSize())
    }
  }
  return {
    cols: Math.max(2, Math.floor(requestedCols) || 80),
    rows: Math.max(1, Math.floor(requestedRows) || 24)
  }
}
