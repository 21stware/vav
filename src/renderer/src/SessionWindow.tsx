import { useEffect } from 'react'
import { useSessionStore } from './state/sessionStore'
import {
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  installWindowBridge
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge } from './state/workspaceStore'
import {
  SessionDetail,
  useSessionMenuCommands,
  useTerminalAppearance
} from './components/SessionDetail'
import { ChangeReviewPanel } from './components/ChangeReviewPanel'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { useT } from './i18n/useT'

/**
 * One conversation, in its own window.
 *
 * Same transcript, tools and composer as the main window with the sidebar and
 * its chrome taken away — this window exists to hold a single session, so it
 * has nothing to navigate between. Top-right Reveal in List jumps back to the
 * main window sidebar row for this conversation.
 */
export default function SessionWindow({
  conversationId
}: {
  conversationId: string
}): React.JSX.Element {
  const t = useT()
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)

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
  useSessionMenuCommands()

  const changeReviewId = useSessionStore((s) => s.changeReviewId)

  if (!ready) return <div className="app-shell" />

  if (changeReviewId) {
    return (
      <div className="app-shell session-window">
        <ChangeReviewPanel />
      </div>
    )
  }

  return (
    <div className="app-shell session-window">
      {/* Drag region + traffic lights; native title holds the session name.
          Reveal in List: close this companion and select the row in main. */}
      <header className="titlebar bare session-window-titlebar">
        <span className="spacer" />
        <button
          type="button"
          className="session-reveal-in-list"
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
      <SessionDetail />
    </div>
  )
}
