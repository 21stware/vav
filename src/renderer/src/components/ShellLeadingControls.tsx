import { Download, PanelLeft, Plus, RotateCw } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * Sidebar toggle + new session (+ update chip when available).
 * Used in the docked sidebar titlebar, agent chrome (session, sidebar collapsed),
 * and the workspace preview header (sidebar collapsed).
 */
export function ShellLeadingControls(): React.JSX.Element {
  const t = useT()
  const createConversation = useSessionStore((s) => s.createConversation)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const updateState = useSessionStore((s) => s.updateState)
  const downloadUpdate = useSessionStore((s) => s.downloadUpdate)
  const installUpdate = useSessionStore((s) => s.installUpdate)

  const updateButton =
    updateState.phase === 'available' ? (
      <Button
        icon={<Download size={14} />}
        label={t('update.availableButton', { version: updateState.latestVersion ?? '' })}
        variant="primary"
        size="sm"
        onClick={() => void downloadUpdate()}
      />
    ) : updateState.phase === 'downloading' ? (
      <Button
        icon={<Download size={14} />}
        label={t('update.downloading', { progress: updateState.progress })}
        variant="primary"
        size="sm"
        disabled
      />
    ) : updateState.phase === 'ready' ? (
      <Button
        icon={<RotateCw size={14} />}
        label={t('update.restartInstall')}
        variant="primary"
        size="sm"
        onClick={() => void installUpdate()}
      />
    ) : null

  return (
    <div className="shell-leading-controls">
      <Button
        icon={<PanelLeft size={14} />}
        title={`${t('shortcut.toggleSidebar')} ${keys('⌘⇧H')}`}
        onClick={toggleSidebar}
      />
      <Button
        icon={<Plus size={14} />}
        title={t('app.newSessionTitle', { shortcut: keys('⌘N') })}
        onClick={() => void createConversation()}
      />
      {updateButton}
    </div>
  )
}
