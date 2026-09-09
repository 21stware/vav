import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import { useT } from '../../i18n/useT'
import { EmptyState } from '../ui'

export type GitRefRow = {
  id: string
  title: string
  meta?: string
  sha?: string
  current?: boolean
  track?: string
}

export function GitRefList({
  rows,
  selectedId,
  focusIndex,
  loading,
  error,
  loaded,
  emptyTitle,
  emptyDesc,
  listRef,
  onKeyDown,
  onSelect,
  onPreview,
  onMenu,
  onBackgroundMenu,
  rowAttr,
  testId,
  ariaLabel
}: {
  rows: GitRefRow[]
  selectedId: string | null
  focusIndex: number
  loading: boolean
  error: string | null
  loaded: boolean
  emptyTitle: string
  emptyDesc?: string
  listRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onSelect: (index: number, id: string) => void
  onPreview: (id: string) => void
  onMenu: (id: string, x: number, y: number) => void
  onBackgroundMenu?: (x: number, y: number) => void
  rowAttr: string
  testId?: string
  ariaLabel: string
}): React.JSX.Element {
  const t = useT()
  if (error && (rows.length === 0 || !loaded)) {
    return <EmptyState title={t('git.loadFailed')} description={error} />
  }
  if (!loaded) {
    return <EmptyState title={t('common.loading')} />
  }
  if (rows.length === 0) {
    return (
      <div
        className="git-ref-empty"
        onContextMenu={(event) => {
          if (!onBackgroundMenu) return
          event.preventDefault()
          event.stopPropagation()
          onBackgroundMenu(event.clientX, event.clientY)
        }}
      >
        <EmptyState title={emptyTitle} description={emptyDesc} />
      </div>
    )
  }
  return (
    <div
      ref={listRef}
      className="git-ref-list"
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      data-testid={testId}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => {
        if (!onBackgroundMenu) return
        if ((event.target as HTMLElement).closest('[data-git-ref]')) return
        event.preventDefault()
        event.stopPropagation()
        onBackgroundMenu(event.clientX, event.clientY)
      }}
    >
      {rows.map((row, index) => {
        const selected = selectedId === row.id
        const focused = index === focusIndex
        return (
          <button
            key={row.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-git-ref=""
            {...{ [rowAttr]: index }}
            data-testid={testId ? `${testId}-row` : undefined}
            className={`git-ref-row${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${
              row.current ? ' is-current' : ''
            }`}
            onClick={() => onSelect(index, row.id)}
            onDoubleClick={() => onPreview(row.id)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSelect(index, row.id)
              onMenu(row.id, event.clientX, event.clientY)
            }}
          >
            <span className="git-ref-title" title={row.title}>
              {row.current ? (
                <span className="git-ref-current" title={t('git.current')}>
                  ●
                </span>
              ) : null}
              {row.title}
            </span>
            {row.track ? <span className="git-ref-track">{row.track}</span> : null}
            {row.sha ? (
              <span className="git-ref-sha" title={row.sha}>
                {row.sha}
              </span>
            ) : null}
            {row.meta ? <span className="git-ref-meta">{row.meta}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
