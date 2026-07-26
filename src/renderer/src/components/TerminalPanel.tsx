import { useEffect, useRef } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { acquireTerminal } from '../lib/terminalRegistry'
import { EmptyState } from './ui'

/**
 * Terminal segment of the tools panel.
 *
 * Every tab is rendered at all times and hidden with opacity, so no PTY is torn
 * down by a tab switch. The tab strip itself lives in the shared tools header
 * (terminal-panel.rpml annotation 1).
 *
 * There are no tabs until something asks for one: the agent opens its own bash
 * on its first command, and the user opens theirs with New bash.
 */
export function TerminalPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const tabs = workspace?.tabs ?? []
  const activeTabId = workspace?.activeTabId ?? ''

  const showingAgent = tabs.some((tab) => tab.isAgent && tab.id === activeTabId)

  return (
    <div className="terminal-stack" data-empty={tabs.length === 0}>
      {tabs.map((tab) => (
        <TerminalHost
          key={`${activeId}:${tab.id}`}
          conversationId={activeId}
          tabId={tab.id}
          isAgent={tab.isAgent}
          hidden={!visible || tab.id !== activeTabId}
        />
      ))}

      {showingAgent && <span className="terminal-hint">Agent bash · 只读镜像</span>}

      {tabs.length === 0 && (
        <EmptyState
          title="还没有终端"
          description="Agent 执行命令时会自动开一个它自己的 bash；你也可以点 New bash 开一个属于自己的。"
        />
      )}
    </div>
  )
}

function TerminalHost({
  conversationId,
  tabId,
  isAgent,
  hidden
}: {
  conversationId: string
  tabId: string
  isAgent: boolean
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
      isAgent,
      fontFamily: `"${codeFont}", Menlo, monospace`,
      fontSize: Math.max(9, fontSize - 3)
    })
    host.appendChild(entry.container)

    const observer = new ResizeObserver(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      try {
        entry.fit.fit()
      } catch {
        // Fitting a zero-sized container throws; the next resize retries.
      }
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      // Detach only. The terminal and its PTY stay alive for the next mount.
      if (entry.container.parentElement === host) host.removeChild(entry.container)
    }
  }, [conversationId, tabId, isAgent, codeFont, fontSize])

  useEffect(() => {
    if (hidden) return
    const host = hostRef.current
    if (!host) return
    // Refit when the tab becomes visible: it was sized to zero while hidden.
    const timer = setTimeout(() => {
      const entry = acquireTerminal({
        conversationId,
        tabId,
        isAgent,
        fontFamily: `"${codeFont}", Menlo, monospace`,
        fontSize: Math.max(9, fontSize - 3)
      })
      try {
        entry.fit.fit()
      } catch {
        // Ignored: container still collapsed.
      }
      if (!isAgent) entry.term.focus()
    }, 20)
    return () => clearTimeout(timer)
  }, [hidden, conversationId, tabId, isAgent, codeFont, fontSize])

  return (
    <div
      className="terminal-host"
      data-hidden={hidden}
      ref={hostRef}
      onDragOver={(event) => {
        if (!isAgent) event.preventDefault()
      }}
      onDrop={(event) => {
        // Dropping files types their paths at the prompt rather than running
        // anything (terminal-panel.rpml annotation 2).
        if (isAgent) return
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
