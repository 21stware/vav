import type { ColorTint } from './types'

/**
 * Fixed colour-tint accents — single source of truth.
 *
 * Light and dark share the same hue family so the swatch, toggle, slider, and
 * buttons never drift. Dark tokens are the light accent lifted for charcoal
 * chrome (not a different pastel that reads as a second colour).
 *
 * Applied by `appearance.ts` via the same token derivation as system accent.
 */
export type FixedColorTint = Exclude<ColorTint, 'system' | 'custom'>

const HEX6 = /^#([0-9a-fA-F]{6})$/

/** Normalize a colour-well value to `#rrggbb`, or null if it is not a hex. */
export function normalizeAccentHex(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  if (!HEX6.test(withHash)) return null
  return `#${withHash.slice(1).toLowerCase()}`
}

export const TINT_ACCENT: Record<FixedColorTint, { light: string; dark: string }> = {
  // Neutral chrome (base :root tokens when mono is selected).
  mono: { light: '#3a3a42', dark: '#c8c8d0' },
  // Soft violet — not neon purple.
  lavender: { light: '#7c6bc4', dark: '#b4a6f0' },
  // Clear UI blue.
  blue: { light: '#3b82f6', dark: '#7eb0ff' },
  // Soft teal (macaron-ish, not deep pine).
  teal: { light: '#2d9b8f', dark: '#5ed4c6' },
  // Soft rose.
  rose: { light: '#d4637f', dark: '#f094ac' },
  // Claude-like warm coral (not brown amber / not beige).
  amber: { light: '#d97757', dark: '#e8895c' },
  // Macaron sage / pistachio.
  green: { light: '#5fae86', dark: '#7dc9a4' }
}

/** Swatch fill for a fixed tint in the current resolved theme. */
export function tintSwatchColor(tint: FixedColorTint, theme: 'light' | 'dark'): string {
  if (tint === 'mono') {
    return theme === 'dark'
      ? 'linear-gradient(135deg, #c8c8d0 50%, #3a3a42 50%)'
      : 'linear-gradient(135deg, #2a2a30 50%, #e8e8ec 50%)'
  }
  return TINT_ACCENT[tint][theme]
}
