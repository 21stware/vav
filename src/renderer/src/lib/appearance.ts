import { useEffect, useState } from 'react'
import { TINT_ACCENT, type FixedColorTint } from '@shared/colorTints'
import { COLOR_TINTS, type ColorTint } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { IS_MAC } from './platform'

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
  '--bg-sunken'
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
      r: 0x12 + accent.r * 0.22,
      g: 0x12 + accent.g * 0.22,
      b: 0x13 + accent.b * 0.22
    }
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
      // Web tool labels / links track the accent (same as Agent role colour).
      '--tone-web': textHex,
      '--bg-selected': toHex(selected),
      // Keep dark surfaces neutral.
      '--bg-window': '#121213',
      '--bg-sunken': '#161617'
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
  const wash = lighten(accent, 0.9)
  const selected = lighten(accent, 0.82)
  const sunken = lighten(accent, 0.93)
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
    '--bg-sunken': toHex(sunken)
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
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const reduceMotion = useSessionStore((s) => s.settings.reduceMotion)
  const windowVibrancyEnabled = useSessionStore((s) => s.settings.windowVibrancyEnabled)
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
      setResolvedTheme(resolved)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    const tint: ColorTint = COLOR_TINTS.includes(colorTint) ? colorTint : 'system'
    root.dataset.tint = tint

    if (tint === 'system') {
      // Live OS accent — adapt extremes so unknown colours stay readable.
      applyAccentTintVars(root, systemAccent, resolvedTheme, true)
    } else if (tint === 'mono') {
      // Drop inline overrides so base :root / dark mono tokens apply.
      clearSystemTintVars(root)
    } else {
      // Fixed hues: exact palette hex (swatch === toggle/slider), then soft tokens.
      const fixed = tint as FixedColorTint
      const hex = TINT_ACCENT[fixed][resolvedTheme]
      applyAccentTintVars(root, hex, resolvedTheme, false)
    }
  }, [colorTint, systemAccent, resolvedTheme])

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
    return window.vav.onFullscreen((fullscreen) => {
      document.documentElement.dataset.fullscreen = fullscreen ? 'true' : 'false'
    })
  }, [])
}
