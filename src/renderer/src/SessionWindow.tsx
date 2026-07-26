import { useEffect } from 'react'
import { X } from 'lucide-react'
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
import { Button, Modal } from './components/ui'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { applyTerminalAppearance } from './lib/terminalRegistry'

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
    void bootstrap(conversationId)
  }, [bootstrap, conversationId])

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
      <Overlays />
    </div>
  )
}

function Detail(): React.JSX.Element {
  const searchOpen = useSessionStore((s) => s.search.open)
  const errorBanner = useSessionStore((s) => s.errorBanner)
  const setErrorBanner = useSessionStore((s) => s.setErrorBanner)
  const openSettings = useSessionStore((s) => s.openSettings)

  const isKeyProblem = !!errorBanner && /401|API Key/i.test(errorBanner)

  return (
    <main className="detail">
      {errorBanner && (
        <div className="banner error">
          <span>{errorBanner}</span>
          <span className="spacer" />
          {isKeyProblem && (
            <Button label="打开 Settings" size="sm" onClick={() => openSettings('api')} />
          )}
          <Button icon={<X size={12} />} size="sm" onClick={() => setErrorBanner(null)} />
        </div>
      )}
      {searchOpen && <SearchStrip />}
      <Transcript />
      {/* Tools and prompt share one surface: what the agent can touch and what
          you tell it to do are one control area, not two. */}
      <div className="dock">
        <ToolsPanel />
        <Composer />
      </div>
    </main>
  )
}

function Overlays(): React.JSX.Element | null {
  const dialog = useSessionStore((s) => s.dialog)
  const closeDialog = useSessionStore((s) => s.closeDialog)
  if (!dialog) return null

  return (
    <Modal
      title={dialog.title}
      onDismiss={closeDialog}
      actions={
        <>
          {dialog.onConfirm && <Button label="取消" onClick={closeDialog} />}
          <Button
            label={dialog.confirmLabel}
            variant={dialog.destructive ? 'danger' : 'primary'}
            onClick={() => {
              closeDialog()
              dialog.onConfirm?.()
            }}
          />
        </>
      }
    >
      {dialog.body}
    </Modal>
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
          void useWorkspaceStore.getState().newUserTerminal(store.activeId, 80, 24)
          break
        case 'switch-workdir':
          void store.pickWorkingDirectory(store.activeId)
          break
        case 'send': {
          const draft = store.drafts[store.activeId] ?? ''
          const attachments = store.attachments[store.activeId] ?? []
          void store.send(draft.trim(), attachments)
          break
        }
      }
    })
  }, [])
}
