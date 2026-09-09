import { PanelLeft, Plus, Search } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * Sidebar toggle + session search. New session lives at the top of the list
 * while the sidebar is open; this row keeps the plus when the list is hidden.
 * Used in the docked sidebar titlebar, agent chrome, and workspace preview header.
 * Update status lives in the bottom-left {@link UpdateCorner}.
 */
export function ShellLeadingControls(): React.JSX.Element {
  const t = useT()
  const createConversation = useSessionStore((s) => s.createConversation)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const searchOpen = useSessionStore((s) => s.sidebarSearchOpen)
  const toggleSidebarSearch = useSessionStore((s) => s.toggleSidebarSearch)
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)

  return (
    <div className="shell-leading-controls">
      <Button
        id="sessionsBtn"
        icon={<PanelLeft size={14} />}
        title={`${t('shortcut.toggleSidebar')} ${keys('⌘⇧H')}`}
        onClick={toggleSidebar}
      />
      <Button
        icon={<Search size={14} />}
        testId="sidebar-search-toggle"
        title={t('sidebar.search')}
        pressed={searchOpen}
        onClick={toggleSidebarSearch}
      />
      {!sidebarVisible ? (
        <Button
          id="create"
          icon={<Plus size={14} />}
          testId="new-session"
          title={t('app.newSessionTitle', { shortcut: keys('⌘N') })}
          onClick={() => void createConversation()}
        />
      ) : null}
    </div>
  )
}
