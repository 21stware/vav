import { useEffect, useRef } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { acquireTerminal, disposeTerminal } from '../lib/terminalRegistry'

/**
 * Single-pane xterm host for a known PTY tabId.
 * Used by the agent install card so install stays inline (not a full host jump).
 */
export function InlineTerminal({
  conversationId,
  tabId,
  active = true
}: {
  conversationId: string
  tabId: string
  active?: boolean
}): React.JSX.Element {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !tabId) return
    const entry = acquireTerminal({
      conversationId,
      tabId,
      fontFamily: `"${codeFont}", Menlo, Monaco, "Courier New", monospace`,
      fontSize: Math.max(11, fontSize - 1)
    })
    host.appendChild(entry.container)

    let raf = 0
    const fit = (): void => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      try {
        entry.fit.fit()
      } catch {
        // ignore
      }
    }
    const observer = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        fit()
      })
    })
    observer.observe(host)
    fit()

    return () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
      if (entry.container.parentElement === host) host.removeChild(entry.container)
    }
  }, [conversationId, tabId, codeFont, fontSize])

  useEffect(() => {
    if (!active) return
    const ta = hostRef.current?.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement | null
    ta?.focus()
  }, [active, tabId])

  return <div className="inline-terminal-host" ref={hostRef} />
}

/** Kill PTY + drop xterm instance (install cancel / unmount). */
export function teardownInlineTerminal(conversationId: string, tabId: string): void {
  disposeTerminal(conversationId, tabId)
  void window.vav.pty.kill(tabId)
}
