import { useEffect } from 'react'
import { basename } from './lib/path'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { installSettingsBridge, useSessionStore } from './state/sessionStore'
import { tt } from './i18n/useT'
import { FileViewer } from './components/FileViewer'

/**
 * Standalone file preview window — one path per window; reopen focuses it.
 */
export default function FilePreviewWindow({ path }: { path: string }): React.JSX.Element {
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)

  useEffect(() => {
    document.title = basename(path) || tt('common.preview')
    void bootstrap()
  }, [bootstrap, path])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offMenu = installDefaultContextMenu()
    return () => {
      offSettings()
      offMenu()
    }
  }, [])

  useAppearance()

  if (!ready) {
    return (
      <div className="file-viewer-window">
        <div className="file-viewer-header titlebar-drag">
          <div className="file-viewer-titles">
            <div className="file-viewer-name">{basename(path) || tt('common.preview')}</div>
            <div className="file-viewer-meta muted tiny">{tt('common.loading')}</div>
          </div>
        </div>
        <div className="file-viewer-body muted">{tt('common.loading')}</div>
      </div>
    )
  }

  return <FileViewer path={path} />
}
