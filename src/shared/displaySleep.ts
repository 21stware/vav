/** Duck-typed display bounds so tests never import Electron. */
export type DisplaySleepBounds = {
  bounds: { width: number; height: number }
}

/**
 * True when AppKit has no usable screen — typical while the panel is
 * powered off / the lid just closed, before `display-added` fires.
 *
 * Electron can emit window `close` in that window. Hide-on-close would
 * park every shell and look like a quit; destroy-on-close would drop
 * companion windows.
 */
export function displaysLookAsleep(displays: readonly DisplaySleepBounds[]): boolean {
  if (displays.length === 0) return true
  return displays.every((display) => display.bounds.width < 8 || display.bounds.height < 8)
}
