import { Archive, Clock, Database, FileText, MessageSquare, Settings2, type LucideIcon } from 'lucide-react'
import {
  isSidebarCategoryVisible,
  parseSidebarVisibleCategories,
  SIDEBAR_OPTIONAL_CATEGORIES,
  toggleSidebarVisibleCategory,
  type SidebarOptionalCategory
} from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import type { SidebarListMode } from '../../state/sessionTypes'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { menuAnchor, showMenu, type MenuItem } from '../../lib/nativeMenu'

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
    mode: 'databases',
    icon: Database,
    testId: 'sidebar-category-db',
    labelKey: 'sidebar.category.db'
  },
  {
    mode: 'archive',
    icon: Archive,
    testId: 'sidebar-category-archived',
    labelKey: 'sidebar.category.archived'
  }
]

const OPTIONAL_LABEL: Record<SidebarOptionalCategory, MessageKey> = {
  timers: 'sidebar.category.scheduled',
  fileSessions: 'sidebar.category.file',
  databases: 'sidebar.category.db',
  archive: 'sidebar.category.archived'
}

export function SidebarCategoryBar(): React.JSX.Element {
  const t = useT()
  const listMode = useSessionStore((s) => s.sidebarListMode)
  const activateSidebarListMode = useSessionStore((s) => s.activateSidebarListMode)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const visibleCategories = parseSidebarVisibleCategories(
    useSessionStore((s) => s.settings.sidebarVisibleCategories)
  )
  const compact = visibleCategories.length >= 3

  const openSettings = (anchor: HTMLElement): void => {
    const items: MenuItem[] = [
      { label: t('sidebar.categorySettingsHeader'), header: true },
      ...SIDEBAR_OPTIONAL_CATEGORIES.map((mode) => ({
        label: t(OPTIONAL_LABEL[mode]),
        checked: visibleCategories.includes(mode),
        onSelect: () => {
          const next = toggleSidebarVisibleCategory(visibleCategories, mode)
          void updateSettings({ sidebarVisibleCategories: next })
          if (next.includes(mode)) activateSidebarListMode(mode)
          else if (!isSidebarCategoryVisible(listMode, next)) activateSidebarListMode('main')
        }
      }))
    ]
    void showMenu(items, menuAnchor(anchor))
  }

  return (
    <div
      className="sidebar-category-bar"
      data-testid="sidebar-category-bar"
      data-compact={compact ? 'true' : 'false'}
    >
      <div className="sidebar-service-bar sidebar-category-chips">
        {CATEGORIES.filter((category) => isSidebarCategoryVisible(category.mode, visibleCategories)).map(
          (category) => {
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
          }
        )}
      </div>
      <button
        type="button"
        className="sidebar-category-config"
        data-testid="sidebar-category-config"
        title={t('sidebar.categorySettings')}
        aria-label={t('sidebar.categorySettings')}
        onClick={(event) => openSettings(event.currentTarget)}
      >
        <Settings2 size={14} aria-hidden />
      </button>
    </div>
  )
}
