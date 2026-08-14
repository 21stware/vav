import { useEffect } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { applyTerminalAppearance } from './terminalRegistryHandle'

function fontStack(codeFont: string): string {
  return `"${codeFont}", Menlo, Monaco, "Courier New", monospace`
}

/** Keep xterm font + 16-color theme in sync with Settings (code font, size, light/dark, bash bg). */
export function useTerminalAppearance(): void {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const theme = useSessionStore((s) => s.settings.theme)
  const colorTint = useSessionStore((s) => s.settings.colorTint)
  const customAccentColor = useSessionStore((s) => s.settings.customAccentColor)
  const bashBackground = useSessionStore((s) => s.settings.bashBackground ?? 'theme')

  useEffect(() => {
    const apply = (): void => {
      applyTerminalAppearance(fontStack(codeFont), Math.max(11, fontSize - 1), bashBackground)
    }
    apply()
    // CSS tokens (and xterm) settle after data-theme flips; paint twice.
    const raf = requestAnimationFrame(apply)
    const root = document.documentElement
    const obs = new MutationObserver(() => {
      apply()
      requestAnimationFrame(apply)
    })
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
      media.removeEventListener('change', apply)
    }
  }, [codeFont, fontSize, theme, colorTint, customAccentColor, bashBackground])
}
