import { PanelLeft, Plus } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * Sidebar toggle + new-session plus. List search is the always-visible field
 * under the category bar. Used in the docked sidebar titlebar, agent chrome,
 * and workspace preview header.
 * Update status lives in the bottom-left {@link UpdateCorner}.
 */
export function ShellLeadingControls(): React.JSX.Element {
  const t = useT()
  const listMode = useSessionStore((s) => s.sidebarListMode)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const createConversation = useSessionStore((s) => s.createConversation)
  const createScheduledConversation = useSessionStore((s) => s.createScheduledConversation)
  const createDbConversation = useSessionStore((s) => s.createDbConversation)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)

  const create =
    listMode === 'timers'
      ? {
          testId: 'new-scheduled',
          title: t('timer.new'),
          onClick: () => void createScheduledConversation()
        }
      : listMode === 'databases'
        ? {
            testId: 'new-db',
            title: t('db.new'),
            onClick: () => void createDbConversation()
          }
        : listMode === 'main' || listMode === 'archive'
          ? {
              testId: 'new-session',
              title: t('app.newSessionTitle', { shortcut: keys('⌘N') }),
              onClick: () => void createConversation({ machineId: windowMachineId })
            }
          : null

  return (
    <div className="shell-leading-controls">
      <Button
        id="sessionsBtn"
        icon={<PanelLeft size={14} />}
        title={`${t('shortcut.toggleSidebar')} ${keys('⌘⇧H')}`}
        onClick={toggleSidebar}
      />
      {create ? (
        <Button
          id={create.testId === 'new-session' ? 'create' : undefined}
          icon={<Plus size={14} />}
          testId={create.testId}
          title={create.title}
          onClick={create.onClick}
        />
      ) : null}
    </div>
  )
}
