import { useEffect, useMemo } from 'react'
import { useSessionStore } from './state/sessionStore'
import {
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  installWindowBridge
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge, useWorkspaceStore } from './state/workspaceStore'
import {
  AgentModeChrome,
  SessionDetail,
  useTerminalAppearance
} from './components/SessionDetail'
import { useAppearance } from './lib/appearance'
import { useMenuCommands } from './lib/menuCommands'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { useT } from './i18n/useT'

/**
 * One conversation, in its own window.
 *
 * Same transcript, tools and composer as the main window with the sidebar and
 * its chrome taken away — this window exists to hold a single session, so it
 * has nothing to navigate between. Agent switcher / search / splits sit in the
 * title bar; top-right Reveal in List jumps back to the main window row.
 */
export default function SessionWindow({
  conversationId
}: {
  conversationId: string
}): React.JSX.Element {
  const t = useT()
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const conversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const agentBinaryName = conversation?.agentBinaryName ?? null
  const isVavMode = !agentBinaryName || agentBinaryName === 'vav'

  // CLI splits only when this window already has a live host session.
  const showSplits = useWorkspaceStore((s) => {
    if (isVavMode) return false
    const agentId = agentBinaryName
    if (!agentId) return false
    const host = s.workspaces[conversationId]?.agentHostSessions[agentId]
    return Boolean(host?.layout && host.tabs.length > 0)
  })

  useEffect(() => {
    void bootstrap(conversationId).then(() => {
      // ⌘⇧↵ / collapseTools=1: start with the tools panel folded.
      if (new URLSearchParams(window.location.search).get('collapseTools') === '1') {
        useSessionStore.getState().setToolsCollapsed(true)
      }
      // Do not focus here — Composer may not be mounted yet, and a second
      // focus after paint (below) was causing window activation flicker.
    })
  }, [bootstrap, conversationId])

  // Single deferred focus once the session UI is ready (composer mounted).
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    // Wait two frames so the textarea exists; avoid extra main-process focus.
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => {
        if (!cancelled) useSessionStore.getState().focusComposer()
      })
      // stash for cleanup via cancelled flag only
      void inner
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(outer)
    }
  }, [ready])

  useEffect(() => {
    const offTurn = installTurnEventBridge()
    const offFs = installFsWatchBridge()
    const offPty = installPtyBridge()
    const offSettings = installSettingsBridge()
    const offWindow = installWindowBridge()
    const offUpdates = installUpdateBridge()
    const offMenu = installDefaultContextMenu()
    return () => {
      offTurn()
      offFs()
      offPty()
      offSettings()
      offWindow()
      offUpdates()
      offMenu()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  // Full shortcut surface — not just focus-composer (detached windows used to
  // drop ⌘⇧E / Ctrl+` once a CLI agent host stole keyboard focus).
  useMenuCommands()

  const title = useMemo(() => {
    const name = (conversation?.title || '').trim()
    return name || t('common.session')
  }, [conversation?.title, t])

  useEffect(() => {
    document.title = title
  }, [title])

  if (!ready) return <div className="app-shell" />

  // Change review is inline in the transcript (not a full-screen takeover).
  return (
    <div className="app-shell session-window">
      {/*
        Title bar: traffic lights + agent switcher / search / splits, then
        Reveal in List. Agent chrome used to sit under this bar and felt like
        a second toolbar.
      */}
      <header className="titlebar bare session-window-titlebar">
        <div className="session-window-titlebar-chrome">
          <AgentModeChrome
            conversationId={conversationId}
            agentBinaryName={agentBinaryName}
            showSplits={showSplits}
            showSearch={isVavMode}
          />
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="session-reveal-in-list"
          title={t('session.revealInList')}
          onClick={() => {
            const api = window.vav?.window?.revealInList
            if (typeof api !== 'function') {
              console.error('[session] revealInList unavailable — rebuild preload')
              return
            }
            void api(conversationId)
          }}
        >
          {t('session.revealInList')}
        </button>
      </header>
      <SessionDetail hideChrome />
    </div>
  )
}
