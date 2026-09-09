import { Archive, Clock, FileText, MessageSquare, type LucideIcon } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { SidebarListMode } from '../../state/sessionTypes'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'

const CATEGORIES: {
  mode: SidebarListMode
  icon: LucideIcon
  testId: string
  labelKey: MessageKey
}[] = [
  {
    mode: 'main',
    icon: MessageSquare,
    testId: 'sidebar-category-task',
    labelKey: 'sidebar.category.task'
  },
  {
    mode: 'fileSessions',
    icon: FileText,
    testId: 'sidebar-category-file',
    labelKey: 'sidebar.category.file'
  },
  {
    mode: 'timers',
    icon: Clock,
    testId: 'sidebar-category-scheduled',
    labelKey: 'sidebar.category.scheduled'
  },
  {
    mode: 'archive',
    icon: Archive,
    testId: 'sidebar-category-archived',
    labelKey: 'sidebar.category.archived'
  }
]

export function SidebarCategoryBar(): React.JSX.Element {
  const t = useT()
  const listMode = useSessionStore((s) => s.sidebarListMode)
  const activateSidebarListMode = useSessionStore((s) => s.activateSidebarListMode)

  return (
    <div className="sidebar-service-bar sidebar-category-bar" data-testid="sidebar-category-bar">
      {CATEGORIES.map((category) => {
        const expanded = category.mode === listMode
        const Icon = category.icon
        const label = t(category.labelKey)
        return (
          <button
            key={category.mode}
            type="button"
            className="sidebar-service-chip"
            data-expanded={expanded ? 'true' : 'false'}
            data-testid={category.testId}
            title={label}
            aria-label={label}
            aria-pressed={expanded}
            onClick={() => activateSidebarListMode(category.mode)}
          >
            <Icon size={14} aria-hidden />
            <span className="sidebar-service-label-clip" aria-hidden="true">
              <span className="sidebar-service-label-inner">
                <span className="sidebar-service-label">{label}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
