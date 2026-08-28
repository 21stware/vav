import { useEffect, useState } from 'react'
import { TINT_ACCENT, normalizeAccentHex, type FixedColorTint } from '@shared/colorTints'
import { COLOR_TINTS, type ColorTint } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { IS_MAC } from './platform'
import { paintTerminalThemes } from './terminalRegistryHandle'
import { customSurfaceTile, surfacePatternPreset } from './surfacePatterns'

/** CSS custom properties driven by a fixed or system tint. */
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

/** Relative luminance (sRGB), 0…1. */
function luminance({ r, g, b }: Rgb): number {
  const lin = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!
}

/** Mix toward white (amount 0…1). */
function lighten(rgb: Rgb, amount: number): Rgb {
  return {
    r: rgb.r + (255 - rgb.r) * amount,
    g: rgb.g + (255 - rgb.g) * amount,
    b: rgb.b + (255 - rgb.b) * amount
  }
}

/** Mix toward black (amount 0…1). */
function darken(rgb: Rgb, amount: number): Rgb {
  return {
    r: rgb.r * (1 - amount),
    g: rgb.g * (1 - amount),
    b: rgb.b * (1 - amount)
  }
}

/** Ink on solid accent fills — white unless the fill is already very light. */
function accentFg(rgb: Rgb): string {
  return luminance(rgb) > 0.55 ? '#141416' : '#ffffff'
}

/**
 * Derive the full accent token family from an accent hex.
 *
 * @param adapt - When true (OS system accent), lift/deepen extremes so unknown
 *   colours stay readable. When false (fixed palette), keep the hex exact so
 *   swatches match toggle / slider / buttons.
 */
function accentTintVars(
  hex: string,
  theme: 'light' | 'dark',
  adapt: boolean
): Record<string, string> {
  const base = parseHex(hex) ?? { r: 0, g: 122, b: 255 }
  const L = luminance(base)
  const hsl = rgbToHsl(base)

  // Derive a harmonious background companion color (analogous shift).
  // Shift hue by 20 degrees and desaturate for a professional backdrop.
  const bgBase = hslToRgb({
    h: (hsl.h + 20) % 360,
    s: Math.max(0.05, hsl.s * 0.6),
    l: hsl.l
  })

  if (theme === 'dark') {
    // System only: lift very dark OS accents so they read on charcoal chrome.
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
    // Subtle tint mix for base surfaces using the shifted bgBase (4% mix).
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

  // Light: system may deepen pale OS accents; fixed palette stays exact.
  const accent = adapt
    ? L > 0.72
      ? darken(base, 0.18)
      : L > 0.55
        ? darken(base, 0.08)
        : base
    : base
  const hover = darken(accent, 0.1)
  const text = darken(accent, 0.08)

  // Light background: use shifted hue but very high lightness (analogous wash).
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

function clearSystemTintVars(root: HTMLElement): void {
  for (const key of SYSTEM_TINT_VARS) {
    root.style.removeProperty(key)
  }
}

function applyAccentTintVars(
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

/**
 * Theme, colour tint, code font and reduce-motion as document-level tokens.
 *
 * Every window runs this: each has its own document, and the settings window
 * has to restyle itself the moment the user changes appearance.
 */
export function useAppearance(): void {
  const theme = useSessionStore((s) => s.settings.theme)
  const colorTint = useSessionStore((s) => s.settings.colorTint)
  const customAccentColor = useSessionStore((s) => s.settings.customAccentColor)
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const reduceMotion = useSessionStore((s) => s.settings.reduceMotion)
  const windowVibrancyEnabled = useSessionStore((s) => s.settings.windowVibrancyEnabled)
  const surfacePattern = useSessionStore((s) => s.settings.surfacePattern)
  const customSurfacePatternUrl = useSessionStore((s) => s.settings.customSurfacePatternUrl)
  const customSurfacePatternSize = useSessionStore((s) => s.settings.customSurfacePatternSize)
  const storedAccent = useSessionStore((s) => s.systemAccentColor)

  const [systemAccent, setSystemAccent] = useState(storedAccent || '#007aff')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  // Keep local accent in sync with store (bootstrap / multi-window broadcast).
  useEffect(() => {
    if (storedAccent) setSystemAccent(storedAccent)
  }, [storedAccent])

  useEffect(() => {
    // Preload only reloads on full app restart — guard so HMR cannot white-screen.
    const win = window.vav?.window as
      | {
          getAccentColor?: () => Promise<string>
          onAccentColorChanged?: (handler: (hex: string) => void) => () => void
        }
      | undefined
    if (!win?.getAccentColor) return

    let cancelled = false
    void win.getAccentColor().then((hex) => {
      if (cancelled || !hex) return
      setSystemAccent(hex)
      useSessionStore.setState({ systemAccentColor: hex })
    })
    const unsub = win.onAccentColorChanged?.((hex) => {
      setSystemAccent(hex)
      useSessionStore.setState({ systemAccentColor: hex })
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
      // Native range / checkbox follow color-scheme, not data-theme.
      // Bootstrap sets an inline value — keep it in lockstep or light
      // mode keeps a dark charcoal slider track.
      document.documentElement.style.colorScheme = resolved
      setResolvedTheme(resolved)
      // Same turn as data-theme: xterm's injected fg otherwise stays the
      // previous appearance (black glyphs on the new dark plate).
      paintTerminalThemes()
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    const tint: ColorTint = COLOR_TINTS.includes(colorTint) ? colorTint : 'system'
    root.dataset.tint = tint
    delete root.dataset.bg
    delete root.dataset.bgHex

    if (tint === 'system') {
      // Live OS accent — adapt extremes so unknown colours stay readable.
      applyAccentTintVars(root, systemAccent, resolvedTheme, true)
    } else if (tint === 'custom') {
      const hex = normalizeAccentHex(customAccentColor) ?? systemAccent
      applyAccentTintVars(root, hex, resolvedTheme, true)
    } else if (tint === 'mono') {
      // Drop inline overrides so base :root / dark mono tokens apply.
      clearSystemTintVars(root)
    } else {
      // Fixed hues: exact palette hex (swatch === toggle/slider), then soft tokens.
      const fixed = tint as FixedColorTint
      const hex = TINT_ACCENT[fixed][resolvedTheme]
      applyAccentTintVars(root, hex, resolvedTheme, false)
    }
  }, [colorTint, customAccentColor, systemAccent, resolvedTheme])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-code', `"${codeFont}", Menlo, monospace`)
    root.style.setProperty('--code-size', `${Math.max(10, fontSize)}px`)
    root.dataset.reduceMotion = String(reduceMotion)
    // macOS system glass: CSS must stay clear when on, solid when Settings turns it off.
    root.dataset.vibrancy =
      IS_MAC && windowVibrancyEnabled !== false ? 'true' : 'false'
  }, [codeFont, fontSize, reduceMotion, windowVibrancyEnabled])

  useEffect(() => {
    const root = document.documentElement
    const custom =
      surfacePattern === 'custom'
        ? customSurfaceTile(customSurfacePatternUrl, customSurfacePatternSize)
        : null
    const preset = custom ?? surfacePatternPreset(surfacePattern === 'custom' ? 'none' : surfacePattern)
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
  }, [surfacePattern, customSurfacePatternUrl, customSurfacePatternSize])

  useEffect(() => {
    return window.vav.onFullscreen((fullscreen) => {
      document.documentElement.dataset.fullscreen = fullscreen ? 'true' : 'false'
    })
  }, [])
}
