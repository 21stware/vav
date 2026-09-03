import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import {
  Check,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  Play,
  Tag
} from 'lucide-react'
import type {
  GithubActionRun,
  GithubActionStatus,
  GithubErrorCode,
  GithubPullListItem,
  GithubPullState,
  GithubRelease,
  GithubRepoRef
} from '@shared/github'
import { githubRepoSectionUrl } from '@shared/github'
import { useT } from '../../i18n/useT'
import { relativeTime } from '../../lib/format'
import { githubActionStateClass, githubPullStateClass } from '../../lib/githubPanelState'
import { emptyForCode } from '../../lib/githubPanelCopy'
import { makeListKeyDown } from '../../lib/githubPanelNav'
import { EmptyState } from '../ui'

export { makeListKeyDown }

export function PullStateIcon({
  state,
  draft,
  size = 12
}: {
  state: GithubPullState
  draft: boolean
  size?: number
}): React.JSX.Element {
  if (state === 'merged') return <GitMerge size={size} />
  if (state === 'closed') return <GitPullRequestClosed size={size} />
  if (draft && state === 'open') return <GitPullRequestDraft size={size} />
  return <GitPullRequest size={size} />
}

export function ActionStatusIcon({
  status,
  size = 12
}: {
  status: GithubActionStatus
  size?: number
}): React.JSX.Element {
  if (status === 'in_progress') return <LoaderCircle size={size} className="github-action-spin" />
  if (status === 'queued' || status === 'pending' || status === 'requested') {
    return <CircleDashed size={size} />
  }
  if (status === 'completed') return <Check size={size} />
  return <Play size={size} />
}

export function ListGroupHead({
  label,
  expanded,
  loading,
  onToggle,
  onOpenWeb,
  openWebLabel
}: {
  label: string
  expanded: boolean
  loading: boolean
  onToggle: () => void
  onOpenWeb?: () => void
  openWebLabel?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="github-group-head">
      <button
        type="button"
        className="github-group-toggle"
        title={expanded ? t('common.collapse') : t('common.expand')}
        onClick={onToggle}
      >
        <ChevronRight size={12} className={expanded ? 'is-open' : undefined} aria-hidden />
        <span>{label}</span>
        {loading ? <LoaderCircle size={11} className="github-action-spin" aria-hidden /> : null}
      </button>
      {onOpenWeb ? (
        <button
          type="button"
          className="github-group-web"
          title={openWebLabel}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onOpenWeb()
          }}
        >
          <ExternalLink size={11} />
        </button>
      ) : null}
    </div>
  )
}

export function PullRow({
  pull,
  index,
  selected,
  focused,
  onSelect,
  onPreview,
  onMenu
}: {
  pull: GithubPullListItem
  index?: number
  selected: boolean
  focused?: boolean
  onSelect: () => void
  onPreview: () => void
  onMenu: (x: number, y: number) => void
}): React.JSX.Element {
  const updated = Date.parse(pull.updatedAt)
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-github-row={index}
      className={`github-pr-row${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onClick={onSelect}
      onDoubleClick={onPreview}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
        onMenu(event.clientX, event.clientY)
      }}
    >
      <span className={`github-pr-state ${githubPullStateClass(pull.state, pull.draft)}`} aria-hidden>
        <PullStateIcon state={pull.state} draft={pull.draft} />
      </span>
      <span className="github-pr-title" title={pull.title}>
        {pull.title}
      </span>
      <span className="github-pr-age">{Number.isFinite(updated) ? relativeTime(updated) : ''}</span>
    </button>
  )
}

export function ActionRunRow({
  run,
  index,
  selected,
  focused,
  onSelect,
  onPreview,
  onMenu
}: {
  run: GithubActionRun
  index?: number
  selected: boolean
  focused?: boolean
  onSelect: () => void
  onPreview?: (run: GithubActionRun) => void
  onMenu?: (run: GithubActionRun, x: number, y: number) => void
}): React.JSX.Element {
  const updated = Date.parse(run.updatedAt || run.runStartedAt || '')
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-github-run-row={index}
      className={`github-pr-row${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => onPreview?.(run)}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
        onMenu?.(run, event.clientX, event.clientY)
      }}
    >
      <span className={`github-pr-state ${githubActionStateClass(run.status)}`} aria-hidden>
        <ActionStatusIcon status={run.status} />
      </span>
      <span className="github-pr-title" title={run.title || run.name}>
        {run.title || run.name}
      </span>
      <span className="github-pr-age">{Number.isFinite(updated) ? relativeTime(updated) : ''}</span>
    </button>
  )
}

export function ActionsList({
  runs,
  history,
  historyOpen,
  historyLoading,
  historyError,
  selectedId,
  focusIndex,
  loading,
  error,
  code,
  loaded,
  repo,
  listRef,
  onKeyDown,
  onToggleHistory,
  onSelect,
  onPreview,
  onMenu
}: {
  runs: GithubActionRun[]
  history: GithubActionRun[]
  historyOpen: boolean
  historyLoading: boolean
  historyError: string | null
  selectedId: number | null
  focusIndex: number
  loading: boolean
  error: string | null
  code: GithubErrorCode | undefined
  loaded: boolean
  repo: GithubRepoRef | null
  listRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onToggleHistory: () => void
  onSelect: (index: number, id: number) => void
  onPreview?: (run: GithubActionRun) => void
  onMenu?: (run: GithubActionRun, x: number, y: number) => void
}): React.JSX.Element {
  const t = useT()
  if (error && !loaded) {
    return <EmptyState {...emptyForCode(code, error, t)} />
  }
  if (!loaded) {
    return (
      <EmptyState
        title={loading ? t('common.loading') : t('github.loadFailedActions')}
        description={loading ? undefined : t('github.apiMissing')}
      />
    )
  }
  return (
    <div
      ref={listRef}
      className="github-pr-list"
      role="listbox"
      tabIndex={0}
      aria-label={t('github.actions')}
      onKeyDown={onKeyDown}
    >
      {runs.length === 0 ? (
        <div className="github-group-empty">{t('github.noActions')}</div>
      ) : (
        runs.map((run, index) => (
          <ActionRunRow
            key={run.id}
            run={run}
            index={index}
            selected={selectedId === run.id}
            focused={index === focusIndex}
            onSelect={() => onSelect(index, run.id)}
            onPreview={onPreview}
            onMenu={onMenu}
          />
        ))
      )}
      {repo ? (
        <ListGroupHead
          label={t('github.actionHistory')}
          expanded={historyOpen}
          loading={historyLoading}
          onToggle={onToggleHistory}
          onOpenWeb={() =>
            window.open(githubRepoSectionUrl(repo, 'actions'), '_blank', 'noopener,noreferrer')
          }
          openWebLabel={t('github.openActionsOnGithub')}
        />
      ) : null}
      {historyOpen ? (
        historyError && history.length === 0 ? (
          <div className="github-group-empty">{historyError}</div>
        ) : historyLoading && history.length === 0 ? (
          <div className="github-group-empty">{t('common.loading')}</div>
        ) : history.length === 0 ? (
          <div className="github-group-empty">{t('github.actionHistoryEmpty')}</div>
        ) : (
          history.map((run) => (
            <ActionRunRow
              key={`h-${run.id}`}
              run={run}
              selected={selectedId === run.id}
              onSelect={() => onSelect(-1, run.id)}
              onPreview={onPreview}
              onMenu={onMenu}
            />
          ))
        )
      ) : null}
    </div>
  )
}

export function ReleasesList({
  releases,
  selectedId,
  focusIndex,
  loading,
  error,
  code,
  loaded,
  listRef,
  onKeyDown,
  onSelect,
  onPreview,
  onMenu,
  onOpenWeb
}: {
  releases: GithubRelease[]
  selectedId: number | null
  focusIndex: number
  loading: boolean
  error: string | null
  code: GithubErrorCode | undefined
  loaded: boolean
  listRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onSelect: (index: number, id: number) => void
  onPreview: (release: GithubRelease) => void
  onMenu: (release: GithubRelease, x: number, y: number) => void
  onOpenWeb?: () => void
}): React.JSX.Element {
  const t = useT()
  if (error && !loaded) {
    return <EmptyState {...emptyForCode(code, error, t)} />
  }
  if (!loaded) {
    return (
      <EmptyState
        title={loading ? t('common.loading') : t('github.loadFailedReleases')}
        description={loading ? undefined : t('github.apiMissing')}
      />
    )
  }
  const latestId = releases.find((row) => !row.draft && !row.prerelease)?.id ?? null
  return (
    <div
      ref={listRef}
      className="github-pr-list"
      role="listbox"
      tabIndex={0}
      aria-label={t('github.releases')}
      onKeyDown={onKeyDown}
    >
      {releases.length === 0 ? (
        <div className="github-group-empty">
          <span>{t('github.noReleases')}</span>
          {onOpenWeb ? (
            <button
              type="button"
              className="github-site-link"
              title={t('github.openReleasesOnGithub')}
              onClick={onOpenWeb}
            >
              {t('github.openReleasesOnGithub')}
            </button>
          ) : null}
        </div>
      ) : (
        releases.map((release, index) => {
          const selectedRow = selectedId === release.id
          const published = Date.parse(release.publishedAt || release.createdAt)
          return (
            <button
              key={release.id}
              type="button"
              role="option"
              aria-selected={selectedRow}
              data-github-release-row={index}
              className={`github-pr-row${selectedRow ? ' is-selected' : ''}${
                index === focusIndex ? ' is-focused' : ''
              }`}
              onClick={() => onSelect(index, release.id)}
              onDoubleClick={() => onPreview(release)}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onSelect(index, release.id)
                onMenu(release, event.clientX, event.clientY)
              }}
            >
              <span className="github-pr-state is-tag" aria-hidden>
                <Tag size={12} />
              </span>
              <span className="github-pr-title" title={release.name || release.tag}>
                {release.name || release.tag}
              </span>
              {release.draft ? (
                <span className="github-pr-age">{t('github.releaseDraft')}</span>
              ) : release.prerelease ? (
                <span className="github-pr-age">{t('github.releasePrerelease')}</span>
              ) : release.id === latestId ? (
                <span className="github-pr-age">{t('github.releaseLatest')}</span>
              ) : Number.isFinite(published) ? (
                <span className="github-pr-age">{relativeTime(published)}</span>
              ) : null}
            </button>
          )
        })
      )}
    </div>
  )
}
