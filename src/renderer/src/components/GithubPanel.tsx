import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  Check,
  FileDiff,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  ListChecks,
  MessageSquare,
  X
} from 'lucide-react'
import type {
  GithubComment,
  GithubErrorCode,
  GithubPullDetail,
  GithubPullListItem,
  GithubPullsPage,
  GithubPullState,
  GithubPullStateFilter,
  GithubReview,
  GithubReviewState
} from '@shared/github'
import { mergePullConversation } from '@shared/github'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { relativeTime } from '../lib/format'
import { Button, EmptyState, Segmented } from './ui'
import { renderGithubMarkdown } from '../lib/githubMarkdown'
import { SafariIcon } from './SafariIcon'

export type GithubPanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
}

/** Session-right preview: selected pull request conversation. */
export function GithubPullPreview({
  cwd,
  pull,
  onClose
}: {
  cwd: string
  pull: GithubPullListItem
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [detail, setDetail] = useState<GithubPullDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!window.vav?.github?.getPull) {
      setDetail(null)
      setError(t('github.apiMissing'))
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getPull(cwd, pull.number)
        if (cancelled) return
        if (!result.ok) {
          setDetail(null)
          setError(result.error)
          return
        }
        setDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, pull.number, t])

  const item = detail && detail.number === pull.number ? detail : pull

  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={item.title}>
          #{item.number} {item.title}
        </span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={t('github.openOnGithub')}
          onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <PullDetail
          item={item}
          detail={detail}
          loading={loading}
          error={error}
          showOpen={false}
        />
      </div>
    </div>
  )
}

function PullStateIcon({
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

function stateClass(state: GithubPullState, draft: boolean): string {
  if (state === 'merged') return 'is-merged'
  if (state === 'closed') return 'is-closed'
  if (draft) return 'is-draft'
  return 'is-open'
}

function emptyForCode(
  code: GithubErrorCode | undefined,
  fallback: string,
  t: ReturnType<typeof useT>
): { title: string; description: string } {
  if (code === 'not-github' || code === 'no-remote') {
    return { title: t('github.notGithub'), description: t('github.notGithubDesc') }
  }
  if (code === 'auth') {
    return { title: t('github.needAuth'), description: t('github.needAuthDesc') }
  }
  if (code === 'rate-limit') {
    return { title: t('github.rateLimit'), description: t('github.rateLimitDesc') }
  }
  if (code === 'not-found') {
    return { title: t('github.notFound'), description: t('github.notFoundDesc') }
  }
  if (code === 'network') {
    return { title: t('github.loadFailed'), description: t('github.networkDesc') }
  }
  return { title: t('github.loadFailed'), description: fallback }
}

function openGithubPrTab(prUrl: string, tab: 'commits' | 'checks' | 'files'): void {
  const base = prUrl.replace(/\/+$/, '')
  window.open(`${base}/${tab}`, '_blank', 'noopener,noreferrer')
}

/** Files tray → GitHub: pull request list + selected PR details. */
export function GithubPanel({
  visible,
  onChrome
}: {
  visible: boolean
  onChrome?: (chrome: GithubPanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const previewHost = useSessionStore((s) => s.filePreviewHost)
  const setSessionPreview = useSessionStore((s) => s.setSessionPreview)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)

  const [page, setPage] = useState<GithubPullsPage | null>(null)
  const [filter, setFilter] = useState<GithubPullStateFilter>('open')
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<GithubPullDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCode, setLoadCode] = useState<GithubErrorCode | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!root) {
      setPage(null)
      setSelected(null)
      setDetail(null)
      setLoadError(null)
      setLoadCode(undefined)
      return
    }
    if (!window.vav?.github?.listPulls) {
      setPage(null)
      setLoadError(tt('github.apiMissing'))
      setLoadCode(undefined)
      return
    }
    setLoading(true)
    setLoadError(null)
    setLoadCode(undefined)
    try {
      const result = await window.vav.github.listPulls(root, filter)
      if (!result.ok) {
        setPage(null)
        setSelected(null)
        setDetail(null)
        setLoadError(result.error)
        setLoadCode(result.code)
        return
      }
      setPage(result.data)
      setSelected((prev) => {
        if (prev && result.data.pulls.some((p) => p.number === prev)) return prev
        return result.data.pulls[0]?.number ?? null
      })
    } catch (err) {
      setPage(null)
      setLoadError(err instanceof Error ? err.message : String(err))
      setLoadCode('network')
    } finally {
      setLoading(false)
    }
  }, [root, filter])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const stableRefresh = useCallback(() => {
    void refreshRef.current()
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  useEffect(() => {
    if (!onChrome) return
    if (!visible || !root) {
      onChrome(null)
      return
    }
    const meta = page
      ? `${page.repo.fullName} · ${
          page.truncated
            ? t('github.pullCountTruncated', { n: page.pulls.length })
            : t('github.pullCount', { n: page.pulls.length })
        }`
      : null
    onChrome({ meta, loading, refresh: stableRefresh })
  }, [onChrome, visible, root, page, loading, stableRefresh, t])

  useEffect(() => {
    return () => onChrome?.(null)
  }, [onChrome])

  useEffect(() => {
    if (!visible || !previewHost || !root || selected == null) return
    const pull = (page?.pulls ?? []).find((p) => p.number === selected)
    if (!pull) return
    setSessionPreview({ kind: 'github', cwd: root, pull })
  }, [visible, previewHost, root, selected, page, setSessionPreview])

  useEffect(() => {
    if (previewHost || !visible || !root || selected == null) {
      setDetail(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }
    if (!window.vav?.github?.getPull) {
      setDetail(null)
      setDetailError(t('github.apiMissing'))
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getPull(root, selected)
        if (cancelled) return
        if (!result.ok) {
          setDetail(null)
          setDetailError(result.error)
          return
        }
        setDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setDetailError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [previewHost, visible, root, selected, t])

  const pulls = page?.pulls ?? []

  useEffect(() => {
    if (selected == null) return
    const idx = pulls.findIndex((p) => p.number === selected)
    if (idx >= 0) setFocusIndex(idx)
  }, [selected, pulls])

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (pulls.length === 0) return
    const move = (delta: number): void => {
      event.preventDefault()
      setFocusIndex((prev) => {
        const next = Math.max(0, Math.min(pulls.length - 1, prev + delta))
        const row = pulls[next]
        if (row) setSelected(row.number)
        requestAnimationFrame(() => {
          listRef.current
            ?.querySelector(`[data-github-row="${next}"]`)
            ?.scrollIntoView({ block: 'nearest' })
        })
        return next
      })
    }
    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Home') {
      event.preventDefault()
      setFocusIndex(0)
      const row = pulls[0]
      if (row) setSelected(row.number)
    } else if (event.key === 'End') {
      event.preventDefault()
      const last = pulls.length - 1
      setFocusIndex(last)
      const row = pulls[last]
      if (row) setSelected(row.number)
    } else if (event.key === 'Enter' || event.key === ' ') {
      const row = pulls[focusIndex]
      if (!row) return
      event.preventDefault()
      setSelected(row.number)
    }
  }

  if (!root) {
    return (
      <div className="github-panel">
        <EmptyState title={t('github.needProject')} description={t('github.needProjectDesc')} />
      </div>
    )
  }

  if (loadError && !page) {
    const empty = emptyForCode(loadCode, loadError, t)
    return (
      <div className="github-panel">
        <EmptyState title={empty.title} description={empty.description} />
      </div>
    )
  }

  if (!page) {
    return (
      <div className="github-panel">
        <EmptyState
          title={loading ? t('common.loading') : t('github.loadFailed')}
          description={loading ? undefined : t('github.apiMissing')}
        />
      </div>
    )
  }

  const selectedItem = pulls.find((p) => p.number === selected) ?? null
  const shown = detail && detail.number === selected ? detail : selectedItem

  return (
    <div className="github-panel">
      <div className={`github-panel-body${previewHost ? ' is-list-only' : ''}`}>
        <div className="github-list-pane">
          <div className="github-filter">
            <Segmented<GithubPullStateFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: t('github.filterOpen') },
                { value: 'closed', label: t('github.filterClosed') },
                { value: 'all', label: t('github.filterAll') }
              ]}
            />
          </div>
          {pulls.length === 0 ? (
            <EmptyState title={t('github.noPulls')} description={t('github.noPullsDesc')} />
          ) : (
            <div
              ref={listRef}
              className="github-pr-list"
              role="listbox"
              tabIndex={0}
              aria-label={t('github.pulls')}
              onKeyDown={onListKeyDown}
            >
              {pulls.map((pull, index) => {
                const selectedRow = selected === pull.number
                const focused = index === focusIndex
                const updated = Date.parse(pull.updatedAt)
                return (
                  <button
                    key={pull.number}
                    type="button"
                    role="option"
                    aria-selected={selectedRow}
                    data-github-row={index}
                    className={`github-pr-row${selectedRow ? ' is-selected' : ''}${
                      focused ? ' is-focused' : ''
                    }`}
                    onClick={() => {
                      setFocusIndex(index)
                      setSelected(pull.number)
                    }}
                    onDoubleClick={() => {
                      window.open(pull.url, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    <span
                      className={`github-pr-state ${stateClass(pull.state, pull.draft)}`}
                      aria-hidden
                    >
                      <PullStateIcon state={pull.state} draft={pull.draft} />
                    </span>
                    <span className="github-pr-num">#{pull.number}</span>
                    <span className="github-pr-title" title={pull.title}>
                      {pull.title}
                    </span>
                    <span className="github-pr-age">
                      {Number.isFinite(updated) ? relativeTime(updated) : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        {!previewHost ? (
          <div className="github-detail-pane">
            {!shown ? (
              pulls.length > 0 ? (
                <div className="github-detail-empty">{t('github.selectPull')}</div>
              ) : null
            ) : (
              <PullDetail
                item={shown}
                detail={detail && detail.number === selected ? detail : null}
                loading={detailLoading}
                error={detailError}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PullDetail({
  item,
  detail,
  loading,
  error,
  showOpen = true
}: {
  item: GithubPullListItem
  detail: GithubPullDetail | null
  loading: boolean
  error: string | null
  /** Tray split: open control in the title row. Preview chrome owns it. */
  showOpen?: boolean
}): React.JSX.Element {
  const t = useT()
  const comments = detail?.comments ?? []
  const reviews = detail?.reviews ?? []
  const reviewComments = detail?.reviewComments ?? []
  const conversationCount = mergePullConversation(comments, reviews, reviewComments).length
  const commitCount = detail?.commits || 0
  const fileCount = detail?.changedFiles || 0
  const checkCount = detail?.checks?.length || 0

  return (
    <div className="github-detail-scroll">
      <div className="github-detail-hero">
        <div className="github-detail-title-row">
          <span
            className={`github-pr-state ${stateClass(item.state, item.draft)}`}
            aria-hidden
          >
            <PullStateIcon state={item.state} draft={item.draft} size={13} />
          </span>
          <h2 className="github-detail-heading" title={item.title}>
            {item.title}
          </h2>
          <span className="github-detail-num">#{item.number}</span>
          {showOpen ? (
            <Button
              icon={<SafariIcon size={14} />}
              size="sm"
              className="github-open-web"
              title={t('github.openOnGithub')}
              onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
            />
          ) : null}
        </div>
        <div className="github-detail-status-row">
          <span className={`github-detail-state ${stateClass(item.state, item.draft)}`}>
            {item.state === 'merged'
              ? t('github.merged')
              : item.state === 'closed'
                ? t('github.closed')
                : item.draft
                  ? t('github.draft')
                  : t('github.open')}
          </span>
          <MergeProse item={item} detail={detail} />
        </div>
        {(item.labels ?? []).length > 0 && (
          <div className="github-labels">
            {(item.labels ?? []).map((label) => (
              <span key={label.name} className="github-label">
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="github-pr-tabs">
        <div className="github-pr-tablist" role="tablist">
          <TabButton
            active
            icon={<MessageSquare size={12} />}
            label={t('github.tabConversation')}
            count={conversationCount}
          />
          <TabButton
            icon={<GitCommitHorizontal size={12} />}
            label={t('github.tabCommits')}
            count={commitCount}
            title={t('github.openOnGithub')}
            onClick={() => openGithubPrTab(item.url, 'commits')}
          />
          <TabButton
            icon={<ListChecks size={12} />}
            label={t('github.tabChecks')}
            count={checkCount}
            title={t('github.openOnGithub')}
            onClick={() => openGithubPrTab(item.url, 'checks')}
          />
          <TabButton
            icon={<FileDiff size={12} />}
            label={t('github.tabFiles')}
            count={fileCount}
            title={t('github.openOnGithub')}
            onClick={() => openGithubPrTab(item.url, 'files')}
          />
        </div>
      </div>
      <div className="github-detail-body">
        {loading && !detail ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : error ? (
          <div className="github-detail-error">{error}</div>
        ) : detail ? (
          <ConversationTab detail={detail} />
        ) : null}
      </div>
    </div>
  )
}

function TabButton({
  active,
  icon,
  label,
  count,
  title,
  onClick
}: {
  active?: boolean
  icon: React.ReactNode
  label: string
  count: number
  title?: string
  onClick?: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={Boolean(active)}
      className={`github-pr-tab${active ? ' is-active' : ''}`}
      title={title ?? `${label} ${count}`}
      onClick={onClick}
    >
      {icon}
      <span className="github-pr-tab-label">{label}</span>
      {count > 0 ? <span className="github-pr-tab-count">{count}</span> : null}
    </button>
  )
}

function MergeProse({
  item,
  detail
}: {
  item: GithubPullListItem
  detail: GithubPullDetail | null
}): React.JSX.Element {
  const t = useT()
  const who =
    detail?.mergedBy?.login ||
    item.author.login ||
    t('github.authorUnknown')
  const n = detail?.commits || 0
  const when = Date.parse(detail?.mergedAt || item.updatedAt)
  const lead =
    item.state === 'merged'
      ? t('github.mergedBy', { user: who, n })
      : t('github.wantsToMerge', { user: who, n })
  return (
    <p className="github-merge-prose">
      {lead}{' '}
      <code>{item.baseRef || 'main'}</code>
      {' '}
      {t('github.fromBranch')}{' '}
      <code>{item.headRef || '?'}</code>
      {Number.isFinite(when) ? ` · ${relativeTime(when)}` : ''}
    </p>
  )
}

function ConversationTab({ detail }: { detail: GithubPullDetail }): React.JSX.Element {
  const t = useT()
  const body = detail.body?.trim() ?? ''
  const comments = detail.comments ?? []
  const reviews = detail.reviews ?? []
  const reviewComments = detail.reviewComments ?? []
  const reviewers = detail.reviewers ?? []
  const assignees = detail.assignees ?? []
  const timeline = mergePullConversation(comments, reviews, reviewComments)
  const latestReviews = latestReviewByUser(reviews)
  return (
    <div className="github-conversation">
      {(latestReviews.length > 0 || reviewers.length > 0 || assignees.length > 0) && (
        <div className="github-people">
          {latestReviews.length > 0 && (
            <div className="github-review-summary">
              {latestReviews.map((review) => (
                <span
                  key={review.author.login || review.id}
                  className={`github-review-chip is-${review.state}`}
                >
                  <ReviewStateIcon state={review.state} />
                  {review.author.login || t('github.authorUnknown')}
                </span>
              ))}
            </div>
          )}
          {reviewers.length > 0 && (
            <div className="github-reviewers">
              <span className="github-reviewers-label">{t('github.reviewers')}</span>
              {reviewers.map((user) => (
                <span key={user.login} className="github-reviewer">
                  {user.avatarUrl ? (
                    <img className="github-avatar" src={user.avatarUrl} alt="" />
                  ) : null}
                  {user.login}
                </span>
              ))}
            </div>
          )}
          {assignees.length > 0 && (
            <div className="github-reviewers">
              <span className="github-reviewers-label">{t('github.assignees')}</span>
              {assignees.map((user) => (
                <span key={user.login} className="github-reviewer">
                  {user.avatarUrl ? (
                    <img className="github-avatar" src={user.avatarUrl} alt="" />
                  ) : null}
                  {user.login}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="github-thread-item github-op">
        <div className="github-thread-head">
          {detail.author?.avatarUrl ? (
            <img className="github-avatar" src={detail.author.avatarUrl} alt="" />
          ) : null}
          <span className="github-author">{detail.author?.login || t('github.authorUnknown')}</span>
          <span className="github-detail-time">
            {Number.isFinite(Date.parse(detail.createdAt))
              ? relativeTime(Date.parse(detail.createdAt))
              : ''}
          </span>
        </div>
        {body ? (
          <div className="github-pr-body">
            <GithubMarkdown source={body} />
          </div>
        ) : (
          <div className="github-no-body">{t('github.noBody')}</div>
        )}
      </div>
      {timeline.length === 0 ? (
        <div className="github-no-body">{t('github.noConversation')}</div>
      ) : (
        timeline.map((item) =>
          item.kind === 'review' ? (
            <ThreadReview key={`r-${item.review.id}`} review={item.review} comments={item.comments} />
          ) : (
            <ThreadComment
              key={`${item.kind}-${item.comment.id}`}
              comment={item.comment}
              showLine={item.kind === 'inline'}
            />
          )
        )
      )}
    </div>
  )
}

function latestReviewByUser(reviews: GithubReview[]): GithubReview[] {
  const map = new Map<string, GithubReview>()
  for (const review of reviews) {
    if (review.state === 'commented' && !review.body) continue
    const key = review.author.login || String(review.id)
    map.set(key, review)
  }
  return [...map.values()]
}

function ReviewStateIcon({ state }: { state: GithubReviewState }): React.JSX.Element {
  if (state === 'approved') return <Check size={11} />
  if (state === 'changes_requested') return <X size={11} />
  return <MessageSquare size={11} />
}

function reviewStateLabel(
  state: GithubReviewState,
  t: ReturnType<typeof useT>
): string {
  if (state === 'approved') return t('github.approved')
  if (state === 'changes_requested') return t('github.changesRequested')
  if (state === 'dismissed') return t('github.dismissed')
  return t('github.commented')
}

function ThreadComment({
  comment,
  showLine,
  nested
}: {
  comment: GithubComment
  showLine?: boolean
  nested?: boolean
}): React.JSX.Element {
  const t = useT()
  const at = Date.parse(comment.createdAt)
  const author = comment.author
  const body = (comment.body ?? '').trim()
  return (
    <div className={nested ? 'github-thread-item github-thread-nested' : 'github-thread-item'}>
      <div className="github-thread-head">
        {author?.avatarUrl ? (
          <img className="github-avatar" src={author.avatarUrl} alt="" />
        ) : null}
        <span className="github-author">{author?.login || t('github.authorUnknown')}</span>
        {showLine && comment.line != null ? (
          <span className="github-thread-line">L{comment.line}</span>
        ) : null}
        {nested && comment.path ? (
          <span className="github-thread-path" title={comment.path}>
            {comment.path}
          </span>
        ) : null}
        {Number.isFinite(at) ? (
          <span className="github-detail-time">{relativeTime(at)}</span>
        ) : null}
      </div>
      {body ? (
        <div className="github-pr-body github-thread-body">
          <GithubMarkdown source={comment.body} />
        </div>
      ) : null}
    </div>
  )
}

function ThreadReview({
  review,
  comments
}: {
  review: GithubReview
  comments: GithubComment[]
}): React.JSX.Element {
  const t = useT()
  const at = Date.parse(review.submittedAt ?? '')
  const author = review.author
  return (
    <div className="github-thread-item">
      <div className="github-thread-head">
        {author?.avatarUrl ? (
          <img className="github-avatar" src={author.avatarUrl} alt="" />
        ) : null}
        <span className="github-author">{author?.login || t('github.authorUnknown')}</span>
        <span className={`github-review-chip is-${review.state}`}>
          <ReviewStateIcon state={review.state} />
          {reviewStateLabel(review.state, t)}
        </span>
        {Number.isFinite(at) ? (
          <span className="github-detail-time">{relativeTime(at)}</span>
        ) : null}
      </div>
      {review.body ? (
        <div className="github-pr-body github-thread-body">
          <GithubMarkdown source={review.body} />
        </div>
      ) : null}
      {comments.map((comment) => (
        <ThreadComment key={comment.id} comment={comment} showLine nested />
      ))}
    </div>
  )
}

function GithubMarkdown({ source }: { source: string }): React.JSX.Element {
  const html = useMemo(() => {
    try {
      return renderGithubMarkdown(source)
    } catch {
      return ''
    }
  }, [source])
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
  )
}
