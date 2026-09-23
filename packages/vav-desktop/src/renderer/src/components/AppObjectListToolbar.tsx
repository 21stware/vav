import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ListFilter, MessageSquarePlus, Search, X } from 'lucide-react'
import { appSearchPrompt, insertAgentPrompt } from '../lib/insertAgentPrompt'
import type { MessageKey } from '@shared/i18n'
import { useT } from '../i18n/useT'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import {
  appObjectListKeyAction,
  appObjectRowClassName,
  appObjectSelectionMods,
  type AppListSort
} from '../lib/appObjectList'
import { useSessionStore } from '../state/sessionStore'

export type AppListFilterOption = {
  id: string
  labelKey: MessageKey
}

const DEFAULT_SORTS: { id: AppListSort; labelKey: MessageKey }[] = [
  { id: 'updated', labelKey: 'app.list.sort.updated' },
  { id: 'name', labelKey: 'app.list.sort.name' },
  { id: 'created', labelKey: 'app.list.sort.created' }
]

export function useAppObjectList(opts?: { defaultSort?: AppListSort }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState<AppListSort>(opts?.defaultSort ?? 'updated')
  const constrained = query.trim().length > 0 || filter !== 'all'
  return { query, setQuery, filter, setFilter, sort, setSort, constrained }
}

export function useAppObjectListSelection(orderedIds: string[]) {
  const focusedId = useSessionStore((s) => s.focusedAppObjectId)
  const selectedIds = useSessionStore((s) => s.selectedAppObjectIds)
  const focusAppObject = useSessionStore((s) => s.focusAppObject)

  const select = (
    id: string,
    event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
  ): void => {
    focusAppObject(id, {
      additive: !!(event?.metaKey || event?.ctrlKey),
      range: !!event?.shiftKey,
      rangeIds: orderedIds
    })
  }

  const selectAll = (): void => {
    if (orderedIds.length === 0) return
    useSessionStore.setState({ selectedAppObjectIds: [...orderedIds] })
  }

  const selectionMods = (id: string): string => appObjectSelectionMods(id, selectedIds, orderedIds)

  const rowClass = (id: string, base = 'applications-object-row'): string =>
    appObjectRowClassName(id, selectedIds, orderedIds, base)

  return { focusedId, selectedIds, select, selectAll, rowClass, selectionMods }
}

export function useAppObjectListKeys(opts: {
  listRef: RefObject<HTMLElement | null>
  orderedIds: string[]
  focusedId: string | null
  selectedIds: string[]
  onMove: (id: string, range: boolean) => void
  onDelete?: (ids: string[]) => void
  onSelectAll?: () => void
}): void {
  const { listRef, orderedIds, focusedId, selectedIds, onMove, onDelete, onSelectAll } = opts
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const editing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        !!target?.isContentEditable
      if (editing) return
      if (!listRef.current?.contains(document.activeElement)) return
      const action = appObjectListKeyAction(event, orderedIds, focusedId)
      if (!action) return
      event.preventDefault()
      if (action.type === 'move') onMove(action.id, action.range)
      else if (action.type === 'delete') {
        const ids = selectedIds.length ? selectedIds : focusedId ? [focusedId] : []
        if (ids.length) onDelete?.(ids)
      } else {
        onSelectAll?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedId, listRef, onDelete, onMove, onSelectAll, orderedIds, selectedIds])
}

export function AppObjectListToolbar({
  query,
  onQueryChange,
  filter,
  filters,
  onFilterChange,
  sort,
  sorts = DEFAULT_SORTS,
  onSortChange,
  askKind,
  testIdPrefix = 'app-list',
  leading,
  searchFixed = false,
  listControls = true
}: {
  query: string
  onQueryChange: (query: string) => void
  filter: string
  filters: AppListFilterOption[]
  onFilterChange: (filter: string) => void
  sort: AppListSort
  sorts?: { id: AppListSort; labelKey: MessageKey }[]
  onSortChange: (sort: AppListSort) => void
  /** When set, a non-empty query can insert a search prompt into the agent. */
  askKind?: string
  testIdPrefix?: string
  leading?: ReactNode
  searchFixed?: boolean
  listControls?: boolean
}): React.JSX.Element {
  const t = useT()
  const searchRef = useRef<HTMLInputElement>(null)
  const defaultSort = sorts[0]?.id ?? 'updated'
  const menuActive = filter !== 'all' || sort !== defaultSort

  const openMenu = (anchor: HTMLElement): void => {
    const items: MenuItem[] = [
      { label: t('common.filter'), header: true },
      ...filters.map((option) => ({
        label: t(option.labelKey),
        checked: filter === option.id,
        onSelect: () => onFilterChange(option.id)
      })),
      { label: '', divider: true },
      { label: t('common.sort'), header: true },
      ...sorts.map((option) => ({
        label: t(option.labelKey),
        checked: sort === option.id,
        onSelect: () => onSortChange(option.id)
      }))
    ]
    void showMenu(items, menuAnchor(anchor))
  }

  return (
    <div
      className={`sidebar-search applications-object-toolbar${searchFixed ? ' is-search-fixed' : ''}`}
      data-testid={`${testIdPrefix}-toolbar`}
    >
      {leading}
      {leading && listControls ? <span className="spacer" aria-hidden="true" /> : null}
      {listControls ? (
      <>
      <div className="sidebar-search-field">
        <Search
          size={12}
          style={{
            position: 'absolute',
            left: 8,
            top: 8,
            opacity: 0.5,
            pointerEvents: 'none'
          }}
        />
        <input
          ref={searchRef}
          className="text-field"
          data-testid={`${testIdPrefix}-search`}
          style={{ paddingLeft: 24, paddingRight: query ? 24 : 8 }}
          placeholder={t('app.list.searchPlaceholder')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            if (query) onQueryChange('')
            else searchRef.current?.blur()
          }}
        />
        {query ? (
          <button
            type="button"
            className="btn icon-only sm"
            style={{ position: 'absolute', right: 2, top: 2 }}
            title={t('common.clear')}
            aria-label={t('common.clear')}
            onClick={() => onQueryChange('')}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      {askKind && query.trim() ? (
        <button
          type="button"
          className="btn icon-only sm"
          data-testid={`${testIdPrefix}-ask-agent`}
          title={t('app.askAgentTitle')}
          aria-label={t('app.askAgent')}
          onClick={() => insertAgentPrompt(appSearchPrompt(askKind, query))}
        >
          <MessageSquarePlus size={14} aria-hidden />
        </button>
      ) : null}
      <button
        type="button"
        className={`sidebar-list-menu${menuActive ? ' is-active' : ''}`}
        data-testid={`${testIdPrefix}-menu`}
        data-filter={filter}
        data-sort={sort}
        title={t('sidebar.listMenu')}
        aria-label={t('sidebar.listMenu')}
        aria-haspopup="menu"
        onClick={(event) => openMenu(event.currentTarget)}
      >
        <ListFilter size={14} aria-hidden />
      </button>
      </>
      ) : null}
    </div>
  )
}
