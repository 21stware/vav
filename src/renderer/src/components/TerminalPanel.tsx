import { useEffect, useRef } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { acquireTerminal } from '../lib/terminalRegistry'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'

/**
 * Terminal segment of the tools panel.
 *
 * Every tab is rendered at all times and hidden with opacity, so no PTY is torn
 * down by a tab switch. The PTY surface is always visible
 * (terminal-panel.rpml annotation 3).
 */
export function TerminalPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const tabs = workspace?.tabs ?? []
  const activeTabId = workspace?.activeTabId ?? ''
  const empty = tabs.length === 0

  return (
    <div className="terminal-stack" data-empty={empty}>
      <div className="terminal-surface">
        {tabs.map((tab) => (
          <TerminalHost
            key={`${activeId}:${tab.id}`}
            conversationId={activeId}
            tabId={tab.id}
            hidden={!visible || tab.id !== activeTabId}
          />
        ))}
      </div>

      {empty && (
        <EmptyState title={t('tools.noTerminalTitle')} description={t('tools.bashHint')} />
      )}
    </div>
  )
}

function TerminalHost({
  conversationId,
  tabId,
  hidden
}: {
  conversationId: string
  tabId: string
  hidden: boolean
}): React.JSX.Element {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const entry = acquireTerminal({
      conversationId,
      tabId,
      fontFamily: `"${codeFont}", Menlo, monospace`,
      fontSize: Math.max(9, fontSize - 3)
    })
    host.appendChild(entry.container)

    let raf = 0
    const fit = (): void => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      try {
        entry.fit.fit()
      } catch {
        // Fitting a zero-sized container throws; the next resize retries.
      }
    }
    // Live window resize: skip xterm measure + PTY IPC until the drag settles
    // so chrome paint stays on the pointer. One fit on resize-end is enough.
    const observer = new ResizeObserver(() => {
      if (document.documentElement.dataset.resizing === 'true') return
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        fit()
      })
    })
    observer.observe(host)
    const onResizeEnd = (): void => fit()
    window.addEventListener('vav:resize-end', onResizeEnd)

    return () => {
      observer.disconnect()
      window.removeEventListener('vav:resize-end', onResizeEnd)
      if (raf) cancelAnimationFrame(raf)
      if (entry.container.parentElement === host) host.removeChild(entry.container)
    }
  }, [conversationId, tabId, codeFont, fontSize])

  useEffect(() => {
    if (hidden) return
    const host = hostRef.current
    if (!host) return
    const timer = setTimeout(() => {
      const entry = acquireTerminal({
        conversationId,
        tabId,
        fontFamily: `"${codeFont}", Menlo, monospace`,
        fontSize: Math.max(9, fontSize - 3)
      })
      try {
        entry.fit.fit()
      } catch {
        // Ignored: container still zero-sized.
      }
      entry.term.focus()
    }, 20)
    return () => clearTimeout(timer)
  }, [hidden, conversationId, tabId, codeFont, fontSize])

  return (
    <div
      className="terminal-host"
      data-hidden={hidden}
      ref={hostRef}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        const paths = [...event.dataTransfer.files]
          .map((file) => window.vav.files.pathForFile(file))
          .filter(Boolean)
          .map(quoteIfNeeded)
        if (paths.length) void window.vav.pty.write(tabId, paths.join(' '))
      }}
    />
  )
}

function quoteIfNeeded(path: string): string {
  return /[\s'"\\]/.test(path) ? `'${path.replace(/'/g, `'\\''`)}'` : path
}
