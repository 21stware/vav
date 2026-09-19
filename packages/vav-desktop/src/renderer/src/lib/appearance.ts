import { useEffect, useState } from 'react'
import { TINT_ACCENT, normalizeAccentHex, type FixedColorTint } from '@shared/colorTints'
import { appearanceBaseForMachine, appearanceForMachine } from '@shared/machineAppearance'
import { COLOR_TINTS, type ColorTint } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { IS_MAC } from './platform'
import { paintTerminalThemes } from './terminalRegistryHandle'
import { customSurfaceTile, surfacePatternPreset } from './surfacePatterns'
import { drivesNativeWindowTheme } from './nativeWindowTheme'
import { applyAccentTintVars, clearSystemTintVars } from './paintAppearance'

/**
 * Theme, colour tint, code font and reduce-motion as document-level tokens.
 *
 * Every window runs this: each has its own document, and the settings window
 * has to restyle itself the moment the user changes appearance.
 */
export function useAppearance(): void {
  const settings = useSessionStore((s) => s.settings)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const hosts = useSessionStore((s) => s.hosts)
  const resolved = appearanceForMachine(
    settings,
    windowMachineId,
    appearanceBaseForMachine(settings, windowMachineId, hosts)
  )
  const theme = resolved.theme
  const colorTint = resolved.colorTint
  const customAccentColor = resolved.customAccentColor
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const reduceMotion = useSessionStore((s) => s.settings.reduceMotion)
  const windowVibrancyEnabled = useSessionStore((s) => s.settings.windowVibrancyEnabled)
  const surfacePattern = resolved.surfacePattern
  const customSurfacePatternUrl = resolved.customSurfacePatternUrl
  const customSurfacePatternSize = resolved.customSurfacePatternSize
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

  // Native vibrancy follows `nativeTheme`, not `data-theme`. Per-connection
  // light appearance otherwise paints dark ink on dark glass.
  useEffect(() => {
    if (!drivesNativeWindowTheme(window.location.search)) return
    void window.vav?.window?.setTheme?.(theme)
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
