import { useEffect } from 'react'
import { useSessionStore } from '../state/sessionStore'

/**
 * Theme, code font and reduce-motion as document-level tokens.
 *
 * Every window runs this: each has its own document, and the settings window
 * has to restyle itself the moment the user changes appearance.
 */
export function useAppearance(): void {
  const theme = useSessionStore((s) => s.settings.theme)
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const reduceMotion = useSessionStore((s) => s.settings.reduceMotion)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-code', `"${codeFont}", Menlo, monospace`)
    root.style.setProperty('--code-size', `${Math.max(10, fontSize)}px`)
    root.dataset.reduceMotion = String(reduceMotion)
  }, [codeFont, fontSize, reduceMotion])
}
