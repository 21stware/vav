import { useEffect } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { applyTerminalAppearance } from './terminalRegistryHandle'

/** Keep xterm font in sync with Settings (code font + size). */
export function useTerminalAppearance(): void {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)

  useEffect(() => {
    // Same formula as TerminalPanel / InlineTerminal use at acquire time.
    applyTerminalAppearance(codeFont, Math.max(11, fontSize - 1))
  }, [codeFont, fontSize])
}
