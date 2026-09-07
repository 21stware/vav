import { PanelLeft, Plus } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * Sidebar toggle + new session.
 * Used in the docked sidebar titlebar, agent chrome (session, sidebar collapsed),
 * and the workspace preview header (sidebar collapsed).
 * Update status lives in the bottom-left {@link UpdateCorner}.
 */
export function ShellLeadingControls(): React.JSX.Element {
  const t = useT()
  const createConversation = useSessionStore((s) => s.createConversation)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)

  return (
    <div className="shell-leading-controls">
      <Button
        id="sessionsBtn"
        icon={<PanelLeft size={14} />}
        title={`${t('shortcut.toggleSidebar')} ${keys('⌘⇧H')}`}
        onClick={toggleSidebar}
      />
      <Button
        id="create"
        icon={<Plus size={14} />}
        testId="new-session"
        title={t('app.newSessionTitle', { shortcut: keys('⌘N') })}
        onClick={() => void createConversation()}
      />
    </div>
  )
}
