/** Filename under the app userData directory. */
export const SURFACE_PATTERN_FILENAME = 'surface-pattern.png'

/** Longest edge of the stored tile, in CSS pixels / PNG pixels. */
export const SURFACE_PATTERN_MAX_EDGE = 192

/** CSS `mask-size` that matches the PNG’s pixel aspect (never a single square). */
export function cssTileSize(width: number, height: number): string {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  return `${w}px ${h}px`
}

export function isCssTileSize(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d+px \d+px$/.test(value)
}

/** Longest edge of a settings swatch tile. */
const SWATCH_TILE_MAX = 40

/** Scale a wash `mask-size` so one cell fits the 52px swatch. */
export function swatchPatternSize(size: string): string {
  const match = /^(\d+)px(?: (\d+)px)?$/.exec(size.trim())
  if (!match) return size
  const width = Number(match[1])
  const height = Number(match[2] ?? width)
  const long = Math.max(width, height)
  if (long <= SWATCH_TILE_MAX) return `${width}px ${height}px`
  const scale = SWATCH_TILE_MAX / long
  return `${Math.max(1, Math.round(width * scale))}px ${Math.max(1, Math.round(height * scale))}px`
}

export type SurfacePatternPickFailure = 'no-alpha' | 'invalid'

/** Native picker result. `null` means the user cancelled. */
export type SurfacePatternPickResult =
  | { ok: true; url: string; size: string }
  | { ok: false; reason: SurfacePatternPickFailure }
