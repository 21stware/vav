import { BookOpen, Clock, Database, HardDrive, MessageSquarePlus } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { ApplicationsMode } from '../../state/sessionTypes'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'

const APP_NAV: {
  mode: ApplicationsMode
  testId: string
  labelKey: MessageKey
  Icon: typeof Clock
}[] = [
  { mode: 'scheduled', testId: 'new-scheduled', labelKey: 'sidebar.nav.scheduledTask', Icon: Clock },
  { mode: 'storage', testId: 'applications-tab-storage', labelKey: 'sidebar.category.storage', Icon: HardDrive },
  { mode: 'data', testId: 'applications-tab-data', labelKey: 'sidebar.category.data', Icon: Database },
  {
    mode: 'knowledge',
    testId: 'applications-tab-knowledge',
    labelKey: 'sidebar.category.knowledge',
    Icon: BookOpen
  }
]

export function SidebarNav(): React.JSX.Element {
  const t = useT()
  const appMode = useSessionStore((s) => s.applicationsMode)
  const setApplicationsMode = useSessionStore((s) => s.setApplicationsMode)
  const beginNewSession = useSessionStore((s) => s.beginNewSession)

  return (
    <nav className="sidebar-primary-nav" data-testid="sidebar-primary-nav">
      <button
        type="button"
        className="sidebar-nav-item sidebar-nav-new-session"
        data-testid="new-session"
        onClick={() => beginNewSession()}
      >
        <MessageSquarePlus size={14} aria-hidden />
        <span>{t('common.newSession')}</span>
      </button>
      {APP_NAV.map((item) => {
        const Icon = item.Icon
        const label = t(item.labelKey)
        return (
          <button
            key={item.mode}
            type="button"
            className="sidebar-nav-item"
            data-testid={item.testId}
            data-app={item.mode}
            data-active={appMode === item.mode ? 'true' : 'false'}
            aria-pressed={appMode === item.mode}
            title={label}
            onClick={() => setApplicationsMode(item.mode)}
          >
            <Icon size={14} aria-hidden />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
