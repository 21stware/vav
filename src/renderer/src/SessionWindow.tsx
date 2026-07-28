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

/**
 * One conversation, in its own window.
 *
 * Same transcript, tools and composer as the main window with the sidebar and
 * its chrome taken away — this window exists to hold a single session, so it
 * has nothing to navigate between.
 */
export default function SessionWindow({
  conversationId
}: {
  conversationId: string
}): React.JSX.Element {
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)

  useEffect(() => {
    void bootstrap(conversationId).then(() => {
      // ⌘⇧↵ / collapseTools=1: start with the tools panel folded.
      if (new URLSearchParams(window.location.search).get('collapseTools') === '1') {
        useSessionStore.getState().setToolsCollapsed(true)
      }
      // Detached windows exist to type into — land in the composer immediately.
      useSessionStore.getState().focusComposer()
    })
  }, [bootstrap, conversationId])

  // Bootstrap bumps the focus tick before <Composer> mounts; re-fire once ready
  // so the textarea actually receives focus after the first paint.
  useEffect(() => {
    if (!ready) return
    const frame = requestAnimationFrame(() => {
      useSessionStore.getState().focusComposer()
    })
    return () => cancelAnimationFrame(frame)
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
      {/* Nothing but drag region and traffic lights; the window title carries
          the conversation name, so repeating it here would be a second header. */}
      <header className="titlebar bare" />
      <SessionDetail />
    </div>
  )
}
