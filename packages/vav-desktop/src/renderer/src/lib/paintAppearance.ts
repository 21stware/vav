/**
 * Document-level appearance tokens. Shared by every renderer, including the
 * faaaaast overlay which has no session store.
 */

import { TINT_ACCENT, normalizeAccentHex, type FixedColorTint } from '@shared/colorTints'
import { appearanceForMachine, type AppearanceSettingsPick } from '@shared/machineAppearance'
import { COLOR_TINTS, type AppSettings, type ColorTint, type SurfacePattern } from '@shared/types'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost'
import { customSurfaceTile, surfacePatternPreset } from './surfacePatterns'

const SYSTEM_TINT_VARS = [
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--accent-veil',
  '--accent-text',
  '--accent-fg',
  '--tone-list',
  '--tone-web',
  '--bg-selected',
  '--bg-window',
  '--bg-sunken',
  '--bg-content',
  '--bg-raised',
  '--border',
  '--border-strong',
  '--surface-pattern-color'
] as const

type Rgb = { r: number; g: number; b: number }

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function parseHex(hex: string): Rgb | null {
  const cleaned = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(cleaned)) return null
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16)
  }
}

function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`
}

function toRgba({ r, g, b }: Rgb, a: number): string {
  return `rgba(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)}, ${a})`
}

type Hsl = { h: number; s: number; l: number }

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }
  return { h: h * 360, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  h /= 360
  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return { r: r * 255, g: g * 255, b: b * 255 }
}

function luminance({ r, g, b }: Rgb): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}

function lighten(rgb: Rgb, amount: number): Rgb {
  return {
    r: rgb.r + (255 - rgb.r) * amount,
    g: rgb.g + (255 - rgb.g) * amount,
    b: rgb.b + (255 - rgb.b) * amount
  }
}

function darken(rgb: Rgb, amount: number): Rgb {
  return {
    r: rgb.r * (1 - amount),
    g: rgb.g * (1 - amount),
    b: rgb.b * (1 - amount)
  }
}

function accentFg(rgb: Rgb): string {
  return luminance(rgb) > 0.55 ? '#141416' : '#ffffff'
}

function accentTintVars(
  hex: string,
  theme: 'light' | 'dark',
  adapt: boolean
): Record<string, string> {
  const base = parseHex(hex) ?? { r: 0, g: 122, b: 255 }
  const L = luminance(base)
  const hsl = rgbToHsl(base)
  const bgBase = hslToRgb({
    h: (hsl.h + 20) % 360,
    s: Math.max(0.05, hsl.s * 0.6),
    l: hsl.l
  })

  if (theme === 'dark') {
    const accent = adapt
      ? L < 0.2
        ? lighten(base, 0.45)
        : L < 0.45
          ? lighten(base, 0.22)
          : base
      : base
    const hover = lighten(accent, 0.12)
    const text = lighten(accent, 0.18)
    const selected = {
      r: 18 + accent.r * 0.22,
      g: 18 + accent.g * 0.22,
      b: 19 + accent.b * 0.22
    }
    const mix = (baseVal: number, accVal: number) => Math.round(baseVal * 0.96 + accVal * 0.04)
    const window = { r: mix(18, bgBase.r), g: mix(18, bgBase.g), b: mix(19, bgBase.b) }
    const sunken = { r: mix(22, bgBase.r), g: mix(22, bgBase.g), b: mix(23, bgBase.b) }
    const content = { r: mix(27, bgBase.r), g: mix(27, bgBase.g), b: mix(29, bgBase.b) }
    const raised = { r: mix(36, bgBase.r), g: mix(36, bgBase.g), b: mix(39, bgBase.b) }
    const accentHex = toHex(accent)
    const textHex = toHex(text)
    return {
      '--accent': accentHex,
      '--accent-hover': toHex(hover),
      '--accent-soft': toRgba(accent, 0.2),
      '--accent-veil': toRgba(accent, 0.09),
      '--accent-text': textHex,
      '--accent-fg': accentFg(accent),
      '--tone-list': accentHex,
      '--tone-web': textHex,
      '--bg-selected': toHex(selected),
      '--bg-window': toHex(window),
      '--bg-sunken': toHex(sunken),
      '--bg-content': toHex(content),
      '--bg-raised': toHex(raised),
      '--border': toRgba(bgBase, 0.15),
      '--border-strong': toRgba(bgBase, 0.25),
      '--surface-pattern-color': accentHex
    }
  }

  const accent = adapt
    ? L > 0.72
      ? darken(base, 0.18)
      : L > 0.55
        ? darken(base, 0.08)
        : base
    : base
  const hover = darken(accent, 0.1)
  const text = darken(accent, 0.08)
  const washBase = hslToRgb({
    h: (hsl.h + 20) % 360,
    s: Math.max(0.05, hsl.s * 0.3),
    l: 0.96
  })
  const wash = lighten(washBase, 0.1)
  const selected = darken(washBase, 0.08)
  const sunken = darken(washBase, 0.02)
  const content = lighten(washBase, 0.6)
  const accentHex = toHex(accent)
  const textHex = toHex(text)
  return {
    '--accent': accentHex,
    '--accent-hover': toHex(hover),
    '--accent-soft': toRgba(accent, 0.12),
    '--accent-veil': toRgba(accent, 0.055),
    '--accent-text': textHex,
    '--accent-fg': accentFg(accent),
    '--tone-list': accentHex,
    '--tone-web': textHex,
    '--bg-selected': toHex(selected),
    '--bg-window': toHex(wash),
    '--bg-sunken': toHex(sunken),
    '--bg-content': toHex(content),
    '--bg-raised': '#ffffff',
    '--border': toRgba(bgBase, 0.12),
    '--border-strong': toRgba(bgBase, 0.22),
    '--surface-pattern-color': accentHex
  }
}

export function clearSystemTintVars(root: HTMLElement): void {
  for (const key of SYSTEM_TINT_VARS) {
    root.style.removeProperty(key)
  }
}

export function applyAccentTintVars(
  root: HTMLElement,
  hex: string,
  theme: 'light' | 'dark',
  adapt: boolean
): void {
  const vars = accentTintVars(hex, theme, adapt)
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}

export function resolvePaintTheme(
  theme: 'light' | 'dark' | 'system',
  osDark: boolean
): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return osDark ? 'dark' : 'light'
}

export function paintDocumentLook(opts: {
  settings: AppearanceSettingsPick &
    Pick<AppSettings, 'codeFont' | 'fontSize' | 'reduceMotion' | 'windowVibrancyEnabled'>
  osDark: boolean
  systemAccent?: string
  machineId?: string
  vibrancy?: boolean
}): 'light' | 'dark' {
  const root = document.documentElement
  const look = appearanceForMachine(opts.settings, opts.machineId ?? LOCAL_MACHINE_ID)
  const theme = resolvePaintTheme(look.theme, opts.osDark)
  root.dataset.theme = theme
  root.style.colorScheme = theme

  const tint: ColorTint = COLOR_TINTS.includes(look.colorTint) ? look.colorTint : 'system'
  root.dataset.tint = tint
  delete root.dataset.bg
  delete root.dataset.bgHex
  const accent = opts.systemAccent?.trim() || '#007aff'
  if (tint === 'system') {
    applyAccentTintVars(root, accent, theme, true)
  } else if (tint === 'custom') {
    applyAccentTintVars(root, normalizeAccentHex(look.customAccentColor) ?? accent, theme, true)
  } else if (tint === 'mono') {
    clearSystemTintVars(root)
  } else {
    const hex = TINT_ACCENT[tint as FixedColorTint][theme]
    applyAccentTintVars(root, hex, theme, false)
  }

  root.style.setProperty('--font-code', `"${opts.settings.codeFont}", Menlo, monospace`)
  root.style.setProperty('--code-size', `${Math.max(10, opts.settings.fontSize)}px`)
  root.dataset.reduceMotion = String(opts.settings.reduceMotion)
  if (opts.vibrancy != null) {
    root.dataset.vibrancy = opts.vibrancy ? 'true' : 'false'
  }

  const pattern = look.surfacePattern as SurfacePattern
  const custom =
    pattern === 'custom'
      ? customSurfaceTile(look.customSurfacePatternUrl, look.customSurfacePatternSize)
      : null
  const preset = custom ?? surfacePatternPreset(pattern === 'custom' ? 'none' : pattern)
  root.dataset.surfacePattern = preset.id
  root.removeAttribute('data-surface-pattern-mode')
  if (preset.url) {
    root.style.setProperty('--surface-pattern-url', `url("${preset.url}")`)
    root.style.setProperty('--surface-pattern-size', preset.size)
    root.style.setProperty('--surface-pattern-opacity', String(preset.opacity))
  } else {
    root.style.removeProperty('--surface-pattern-url')
    root.style.removeProperty('--surface-pattern-size')
    root.style.removeProperty('--surface-pattern-opacity')
  }

  return theme
}
