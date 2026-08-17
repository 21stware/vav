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
