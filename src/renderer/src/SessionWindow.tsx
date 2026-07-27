import { useEffect } from 'react'
import { useSessionStore } from './state/sessionStore'
import {
  installSettingsBridge,
  installTurnEventBridge,
  installWindowBridge
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge, useWorkspaceStore } from './state/workspaceStore'
import { Transcript } from './components/Transcript'
import { Composer } from './components/Composer'
import { ToolsPanel } from './components/ToolsPanel'
import { SearchStrip } from './components/SearchStrip'
import { PlanOverlay } from './components/PlanOverlay'
import { ErrorBanner } from './components/ErrorBanner'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { applyTerminalAppearance } from './lib/terminalRegistry'
import { useT } from './i18n/useT'

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
    const offMenu = installDefaultContextMenu()
    return () => {
      offTurn()
      offFs()
      offPty()
      offSettings()
      offWindow()
      offMenu()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  useMenuCommands()

  if (!ready) return <div className="app-shell" />

  return (
    <div className="app-shell session-window">
      {/* Nothing but drag region and traffic lights; the window title carries
          the conversation name, so repeating it here would be a second header. */}
      <header className="titlebar bare" />
      <Detail />
    </div>
  )
}

function Detail(): React.JSX.Element {
  const t = useT()
  const searchOpen = useSessionStore((s) => s.search.open)
  const errorBanner = useSessionStore((s) => s.errorBanner)
  const setErrorBanner = useSessionStore((s) => s.setErrorBanner)
  const openSettings = useSessionStore((s) => s.openSettings)

  const isKeyProblem = !!errorBanner && /401|API Key/i.test(errorBanner)

  return (
    <main className="detail">
      {errorBanner && (
        <ErrorBanner
          message={errorBanner}
          actionLabel={isKeyProblem ? t('error.openSettings') : undefined}
          onAction={isKeyProblem ? () => openSettings('api') : undefined}
          onDismiss={() => setErrorBanner(null)}
        />
      )}
      <div className="detail-stream" data-search={searchOpen}>
        {searchOpen && <SearchStrip />}
        <PlanOverlay />
        <Transcript />
      </div>
      {/* Tools and prompt share one surface: what the agent can touch and what
          you tell it to do are one control area, not two. */}
      <div className="dock">
        <ToolsPanel />
        <Composer />
      </div>
    </main>
  )
}

function useTerminalAppearance(): void {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)

  useEffect(() => {
    applyTerminalAppearance(codeFont, Math.max(9, fontSize - 3))
  }, [codeFont, fontSize])
}

/** The subset of the menu that means anything without a sidebar. */
function useMenuCommands(): void {
  useEffect(() => {
    return window.vav.onMenuCommand((command) => {
      const store = useSessionStore.getState()
      switch (command) {
        case 'focus-composer':
          store.focusComposer()
          break
        case 'find':
          store.openSearch()
          break
        case 'find-next':
          store.stepSearch(1)
          break
        case 'find-previous':
          store.stepSearch(-1)
          break
        case 'open-settings':
          store.openSettings()
          break
        case 'toggle-tools-panel':
          store.toggleToolsPanel()
          break
        case 'toggle-panel-segment':
          store.togglePanelSegment()
          break
        case 'new-terminal':
          store.setPanelSegment('terminal')
          void useWorkspaceStore.getState().newBash(store.activeId, 80, 24)
          break
        case 'switch-workdir':
          store.openWorkspaceSwitcher()
          break
        case 'send': {
          const draft = store.drafts[store.activeId] ?? ''
          const attachments = store.attachments[store.activeId] ?? []
          void store.send(draft.trim(), attachments)
          break
        }
        case 'focus-tools-1':
        case 'focus-tools-2':
        case 'focus-tools-3':
        case 'focus-tools-4':
        case 'focus-tools-5':
        case 'focus-tools-6':
        case 'focus-tools-7':
        case 'focus-tools-8':
        case 'focus-tools-9':
          store.focusToolsSlot(Number(command.slice('focus-tools-'.length)))
          break
      }
    })
  }, [])
}
