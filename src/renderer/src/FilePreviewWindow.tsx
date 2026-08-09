import { Suspense, lazy, useEffect } from 'react'
import { basename } from './lib/path'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import {
  installSettingsBridge,
  installTurnEventBridge,
  installUpdateBridge,
  useSessionStore
} from './state/sessionStore'
import { installFsWatchBridge, installPtyBridge } from './state/workspaceStore'
import { tt } from './i18n/useT'
import { AppToast } from './components/AppToast'
import { useTerminalAppearance } from './lib/useTerminalAppearance'
import { useMenuCommands } from './lib/menuCommands'

const FileViewer = lazy(() =>
  import('./components/FileViewer').then((m) => ({ default: m.FileViewer }))
)

/**
 * Standalone file preview window — one path per window; reopen focuses it.
 * (file-preview.rpml)
 */
export default function FilePreviewWindow({ path }: { path: string }): React.JSX.Element {
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const params = new URLSearchParams(window.location.search)
  const origin = (params.get('origin') === 'dock' ? 'dock' : 'session') as 'dock' | 'session'
  const parentConversationId = params.get('conversationId')

  useEffect(() => {
    document.title = basename(path) || tt('common.preview')
    // Light bootstrap: settings only — skip selectConversation so open is fast.
    void bootstrap(parentConversationId ?? undefined, { light: true })
  }, [bootstrap, path, parentConversationId])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offMenu = installDefaultContextMenu()
    const offTurn = installTurnEventBridge()
    const offFs = installFsWatchBridge()
    const offPty = installPtyBridge()
    const offUpdates = installUpdateBridge()
    return () => {
      offSettings()
      offMenu()
      offTurn()
      offFs()
      offPty()
      offUpdates()
    }
  }, [])

  useAppearance()
  useTerminalAppearance()
  useMenuCommands()

  if (!ready) {
    return (
      <div className="file-preview-shell">
        <div className="file-viewer-header titlebar-drag">
          <div className="file-viewer-lead">
            <span className="file-viewer-name">{basename(path) || tt('common.preview')}</span>
          </div>
          <span className="spacer" />
        </div>
        <div className="file-viewer-body muted" data-pad="text">
          {tt('common.loading')}
        </div>
      </div>
    )
  }

  return (
    <>
      <Suspense
        fallback={
          <div className="file-viewer-body muted" data-pad="text">
            {tt('common.loading')}
          </div>
        }
      >
        <FileViewer
          path={path}
          origin={origin}
          parentConversationId={parentConversationId}
        />
      </Suspense>
      <AppToast />
    </>
  )
}
