import { Database, FileSpreadsheet } from 'lucide-react'
import { useT } from '../i18n/useT'
import { useShowShellLeading } from '../lib/sidebarLayout'
import { isDataFilePath } from '@shared/dataFile'
import { useSessionStore } from '../state/sessionStore'
import { ShellLeadingControls } from './ShellLeadingControls'
import { AppEmptyState } from './AppEmptyState'
import { Button } from './ui'

export function DataHomePanel({ embedded = false }: { embedded?: boolean } = {}): React.JSX.Element {
  const t = useT()
  const createDbConversation = useSessionStore((s) => s.createDbConversation)
  const createDataFromFile = useSessionStore((s) => s.createDataFromFile)
  const shellLeading = useShowShellLeading()
  const showShellLeading = !embedded && shellLeading

  const addFile = async (): Promise<void> => {
    const picked = await window.vav.files?.pickAttachments()
    if (!picked || !('ok' in picked) || !picked.ok) return
    const path = picked.paths.find((item) => isDataFilePath(item))
    if (!path) {
      useSessionStore.getState().showToast({
        kind: 'error',
        title: t('data.unsupportedFile')
      })
      return
    }
    await createDataFromFile(path)
  }

  return (
    <main className="detail" data-testid="data-home">
      <header
        className={`terminal-host-chrome agent-mode-chrome${showShellLeading ? ' has-shell-leading' : ''}`}
      >
        <div className="agent-mode-chrome-row">
          {showShellLeading ? (
            <div className="agent-mode-shell-leading">
              <ShellLeadingControls />
            </div>
          ) : null}
          <span className="file-viewer-name">{t('sidebar.category.data')}</span>
          <span className="spacer" />
        </div>
      </header>
      <AppEmptyState title={t('data.emptyTitle')} description={t('data.emptyDesc')} kind="data">
        <Button
          icon={<Database size={14} />}
          variant="secondary"
          testId="empty-create-db"
          title={t('db.new')}
          label={t('db.new')}
          onClick={() => void createDbConversation()}
        />
        <Button
          icon={<FileSpreadsheet size={14} />}
          variant="secondary"
          testId="empty-add-data-file"
          title={t('data.addFile')}
          label={t('data.addFile')}
          onClick={() => void addFile()}
        />
      </AppEmptyState>
    </main>
  )
}
