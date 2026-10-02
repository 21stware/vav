import { Clock, History, LayoutGrid, Plus, StickyNote } from 'lucide-react'
import { KNOWLEDGE_ALL_NOTES_ID } from '@shared/knowledge'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { assignCreatedAppObject } from '../../lib/appFolderLibrary'
import { knowledgeFolderId } from '../../lib/knowledgeFolderSelection'
import { menuAnchor, showMenu, type MenuItem } from '../../lib/nativeMenu'
import { flattenSessionTitle, historyMenuConversations } from '../../lib/sidebarList'

export function SidebarNav(): React.JSX.Element {
  const t = useT()
  const appVisible = useSessionStore((s) => s.applicationsVisible)
  const showApplications = useSessionStore((s) => s.showApplications)
  const toggleApplications = useSessionStore((s) => s.toggleApplications)
  const beginNewSession = useSessionStore((s) => s.beginNewSession)
  const createKnowledgeNote = useSessionStore((s) => s.createKnowledgeNote)
  const createScheduledConversation = useSessionStore((s) => s.createScheduledConversation)
  const conversations = useSessionStore((s) => s.conversations)
  const activeId = useSessionStore((s) => s.activeId)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const servicesActive = appVisible
  const toggleAppPanel = (): void => {
    if (appVisible) {
      toggleApplications()
      return
    }
    showApplications()
  }
  const openHistory = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rows = historyMenuConversations(conversations, windowMachineId)
    const items: MenuItem[] =
      rows.length === 0
        ? [{ label: t('sidebar.historyEmpty'), disabled: true }]
        : rows.map((row) => ({
            label: flattenSessionTitle(row.title, t('common.session')),
            checked: row.id === activeId,
            onSelect: () => {
              void selectConversation(row.id)
            }
          }))
    void showMenu(items, menuAnchor(event.currentTarget))
  }

  return (
    <nav className="sidebar-primary-nav" data-testid="sidebar-primary-nav">
      <button
        type="button"
        className="sidebar-nav-item sidebar-nav-new-session"
        data-testid="new-session"
        onClick={() => beginNewSession()}
      >
        <Plus size={14} aria-hidden />
        <span>{t('common.newSession')}</span>
      </button>
      <button
        type="button"
        className="sidebar-nav-item sidebar-nav-history"
        data-testid="sidebar-history"
        title={t('sidebar.history')}
        onClick={openHistory}
      >
        <History size={14} aria-hidden />
        <span>{t('sidebar.history')}</span>
      </button>
      <button
        type="button"
        className="sidebar-nav-item"
        data-testid="sidebar-services"
        data-app="services"
        data-active={servicesActive ? 'true' : 'false'}
        aria-pressed={servicesActive}
        title={t('sidebar.services')}
        onClick={toggleAppPanel}
      >
        <LayoutGrid size={14} aria-hidden />
        <span>{t('sidebar.services')}</span>
      </button>
      <button
        type="button"
        className="sidebar-nav-item"
        data-testid="sidebar-new-note"
        title={t('sidebar.newNote')}
        onClick={() => {
          const folderId = knowledgeFolderId()
          void createKnowledgeNote(folderId === KNOWLEDGE_ALL_NOTES_ID ? null : folderId)
        }}
      >
        <StickyNote size={14} aria-hidden />
        <span>{t('sidebar.newNote')}</span>
      </button>
      <button
        type="button"
        className="sidebar-nav-item"
        data-testid="sidebar-new-scheduled"
        title={t('sidebar.newScheduled')}
        onClick={() => {
          void createScheduledConversation().then((id) => {
            assignCreatedAppObject('scheduled', id)
          })
        }}
      >
        <Clock size={14} aria-hidden />
        <span>{t('sidebar.newScheduled')}</span>
      </button>
    </nav>
  )
}
