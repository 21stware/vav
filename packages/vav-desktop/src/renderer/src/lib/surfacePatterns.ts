/** Runtime tiles from brand/patterns. */
import grainUrl from '../assets/patterns/grain.svg'
import dotsUrl from '../assets/patterns/dots.svg'
import graphUrl from '../assets/patterns/graph.svg'
import plusUrl from '../assets/patterns/plus.svg'
import hatchUrl from '../assets/patterns/hatch.svg'
import scanUrl from '../assets/patterns/scan.svg'
import fiberUrl from '../assets/patterns/fiber.svg'
import speckleUrl from '../assets/patterns/speckle.svg'
import rippleUrl from '../assets/patterns/ripple.svg'
import heartsUrl from '../assets/patterns/hearts.svg'
import starsUrl from '../assets/patterns/stars.svg'
import {
  SURFACE_PATTERNS,
  SURFACE_PATTERN_STRENGTHS,
  type SurfacePattern,
  type SurfacePatternStrength
} from '@shared/types'
import { isCssTileSize } from '@shared/surfacePattern'

export type SurfacePatternPreset = {
  id: SurfacePattern
  url: string | null
  size: string
  /** Peak alpha at the top of the fade. Bottom of the column goes to 0. */
  opacity: number
}

/**
 * Black-on-transparent tiles, dyed with `--surface-pattern-ink`.
 *
 * `opacity` is the peak alpha at the top of the wash; the CSS fade runs it
 * to 0 inside `--surface-pattern-band`. Sparse tiles (grain, speckle, fiber)
 * can take more alpha than dense line work (hatch, scan), which starts to
 * read as a screen door past ~0.25.
 */
export const SURFACE_PATTERN_PRESETS: readonly SurfacePatternPreset[] = [
  { id: 'none', url: null, size: '0', opacity: 0 },
  { id: 'grain', url: grainUrl, size: '48px', opacity: 0.34 },
  { id: 'dots', url: dotsUrl, size: '18px', opacity: 0.34 },
  { id: 'graph', url: graphUrl, size: '32px', opacity: 0.26 },
  { id: 'plus', url: plusUrl, size: '24px', opacity: 0.34 },
  { id: 'hatch', url: hatchUrl, size: '10px', opacity: 0.2 },
  { id: 'scan', url: scanUrl, size: '8px', opacity: 0.18 },
  { id: 'fiber', url: fiberUrl, size: '96px', opacity: 0.42 },
  { id: 'speckle', url: speckleUrl, size: '64px', opacity: 0.42 },
  { id: 'ripple', url: rippleUrl, size: '48px 24px', opacity: 0.26 },
  { id: 'hearts', url: heartsUrl, size: '80px', opacity: 0.36 },
  { id: 'stars', url: starsUrl, size: '80px', opacity: 0.36 }
]

/** Multiplier on the preset peak alpha — `--surface-pattern-strength`. */
export const SURFACE_PATTERN_STRENGTH_SCALE: Readonly<Record<SurfacePatternStrength, number>> = {
  soft: 0.55,
  normal: 1,
  bold: 1.5
}

export function surfacePatternStrengthScale(value: string | null | undefined): number {
  const known = SURFACE_PATTERN_STRENGTHS.includes(value as SurfacePatternStrength)
    ? (value as SurfacePatternStrength)
    : 'normal'
  return SURFACE_PATTERN_STRENGTH_SCALE[known]
}

export function surfacePatternPreset(id: string | null | undefined): SurfacePatternPreset {
  const known = SURFACE_PATTERNS.includes(id as SurfacePattern) ? (id as SurfacePattern) : 'none'
  return SURFACE_PATTERN_PRESETS.find((preset) => preset.id === known) ?? SURFACE_PATTERN_PRESETS[0]!
}

/** User tile: stream URL + native-aspect `mask-size`. */
export function customSurfaceTile(
  url: string | null | undefined,
  size: string | null | undefined
): SurfacePatternPreset | null {
  if (!url) return null
  return {
    id: 'custom',
    url,
    size: isCssTileSize(size) ? size : 'auto',
    opacity: 0.38
  }
}


