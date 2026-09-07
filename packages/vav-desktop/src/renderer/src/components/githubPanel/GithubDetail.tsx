import { useMemo } from 'react'
import { Check, Download, ExternalLink, LoaderCircle, MessageSquare, Tag, X } from 'lucide-react'
import type {
  GithubActionJob,
  GithubActionRun,
  GithubActionRunDetail,
  GithubComment,
  GithubErrorCode,
  GithubPullDetail,
  GithubPullListItem,
  GithubRelease,
  GithubReview,
  GithubReviewState,
  GithubSite
} from '@shared/github'
import {
  fillGithubSiteGaps,
  githubPagesCustomDomain,
  githubReleaseArchiveUrls,
  isGithubPagesLive,
  mergePullConversation
} from '@shared/github'
import { useT, tt } from '../../i18n/useT'
import { formatBytes, relativeTime } from '../../lib/format'
import { Button, EmptyState } from '../ui'
import { renderGithubMarkdown } from '../../lib/githubMarkdown'
import { SafariIcon } from '../SafariIcon'
import { showMenu, type MenuItem } from '../../lib/nativeMenu'
import {
  githubActionStateClass,
  githubPullStateClass,
  latestReviewByUser,
  pagesStatusClass,
  sameSiteHost
} from '../../lib/githubPanelState'
import {
  actionStatusLabel,
  emptyForCode,
  pagesStatusLabel,
  reviewStateLabel
} from '../../lib/githubPanelCopy'
import { ActionStatusIcon, PullStateIcon } from './GithubList'

export function ReleaseDetail({
  release,
  showOpen = true
}: {
  release: GithubRelease
  showOpen?: boolean
}): React.JSX.Element {
  const t = useT()
  const published = Date.parse(release.publishedAt || release.createdAt)
  const body = release.body?.trim() ?? ''
  const assets = release.assets ?? []
  const archives = githubReleaseArchiveUrls(release.htmlUrl, release.tag)
  const hasAssets = assets.length > 0 || Boolean(archives)
  return (
    <div className="github-detail-scroll">
      <div className="github-detail-hero">
        <div className="github-detail-title-row">
          <span className="github-pr-state is-tag" aria-hidden>
            <Tag size={13} />
          </span>
          <h2 className="github-detail-heading" title={release.name || release.tag}>
            {release.name || release.tag}
          </h2>
          {showOpen ? (
            <Button
              icon={<SafariIcon size={14} />}
              size="sm"
              className="github-open-web"
              title={t('github.openOnGithub')}
              onClick={() => window.open(release.htmlUrl, '_blank', 'noopener,noreferrer')}
            />
          ) : null}
        </div>
        <div className="github-detail-status-row">
          <span
            className={`github-detail-state ${
              release.draft ? 'is-draft' : release.prerelease ? 'is-open' : 'is-merged'
            }`}
          >
            {release.draft
              ? t('github.releaseDraft')
              : release.prerelease
                ? t('github.releasePrerelease')
                : release.tag}
          </span>
          <p className="github-merge-prose">
            {release.author.login ? <span>{release.author.login}</span> : null}
            {Number.isFinite(published) ? ` · ${relativeTime(published)}` : ''}
          </p>
        </div>
      </div>
      <div className="github-detail-body">
        {hasAssets ? (
          <div className="github-release-assets">
            <div className="github-release-assets-title">{t('github.releaseAssets')}</div>
            {assets.map((asset) => (
              <ReleaseAssetRow
                key={asset.id}
                name={asset.name}
                url={asset.browserDownloadUrl}
                size={asset.size}
              />
            ))}
            {archives ? (
              <>
                <ReleaseAssetRow name={t('github.releaseSourceZip')} url={archives.zip} />
                <ReleaseAssetRow name={t('github.releaseSourceTar')} url={archives.tar} />
              </>
            ) : null}
          </div>
        ) : null}
        {body ? (
          <div className="github-pr-body">
            <GithubMarkdown source={body} />
          </div>
        ) : (
          <div className="github-no-body">{t('github.noReleaseBody')}</div>
        )}
      </div>
    </div>
  )
}

function ReleaseAssetRow({
  name,
  url,
  size
}: {
  name: string
  url: string
  size?: number
}): React.JSX.Element {
  const t = useT()
  const sizeLabel = size && size > 0 ? formatBytes(size) : null
  return (
    <button
      type="button"
      className="github-release-asset"
      title={t('github.releaseDownload', { name })}
      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
    >
      <span className="github-release-asset-icon" aria-hidden>
        <Download size={12} />
      </span>
      <span className="github-release-asset-name">{name}</span>
      {sizeLabel ? <span className="github-release-asset-meta">{sizeLabel}</span> : null}
    </button>
  )
}

export function ActionDetail({
  run,
  detail,
  loading,
  error,
  showOpen = true
}: {
  run: GithubActionRun
  detail: GithubActionRunDetail | null
  loading: boolean
  error: string | null
  showOpen?: boolean
}): React.JSX.Element {
  const t = useT()
  const jobs = detail?.jobs ?? []
  const started = Date.parse(run.runStartedAt || run.createdAt)
  return (
    <div className="github-detail-scroll">
      <div className="github-detail-hero">
        <div className="github-detail-title-row">
          <span className={`github-pr-state ${githubActionStateClass(run.status)}`} aria-hidden>
            <ActionStatusIcon status={run.status} size={13} />
          </span>
          <h2 className="github-detail-heading" title={run.title || run.name}>
            {run.title || run.name}
          </h2>
          {showOpen ? (
            <Button
              icon={<SafariIcon size={14} />}
              size="sm"
              className="github-open-web"
              title={t('github.openOnGithub')}
              onClick={() => window.open(run.htmlUrl, '_blank', 'noopener,noreferrer')}
            />
          ) : null}
        </div>
        <div className="github-detail-status-row">
          <span className={`github-detail-state ${githubActionStateClass(run.status)}`}>
            {actionStatusLabel(run.status, t)}
          </span>
          <p className="github-merge-prose">
            {run.name ? <span>{run.name}</span> : null}
            {run.headBranch ? (
              <>
                {' · '}
                <code>{run.headBranch}</code>
              </>
            ) : null}
            {run.event ? ` · ${run.event}` : ''}
            {run.actor.login ? ` · ${run.actor.login}` : ''}
            {Number.isFinite(started) ? ` · ${relativeTime(started)}` : ''}
          </p>
        </div>
      </div>
      <div className="github-detail-body">
        {loading && !detail ? (
          <GithubDetailLoading label={t('common.loading')} />
        ) : error ? (
          <div className="github-detail-error">{error}</div>
        ) : jobs.length === 0 ? (
          <div className="github-no-body">{t('github.noActionJobs')}</div>
        ) : (
          <div className="github-action-jobs">
            {jobs.map((job) => (
              <ActionJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionJobRow({ job }: { job: GithubActionJob }): React.JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      className="github-action-job"
      onClick={() => {
        if (job.htmlUrl) window.open(job.htmlUrl, '_blank', 'noopener,noreferrer')
      }}
    >
      <span className={`github-pr-state ${githubActionStateClass(job.status)}`} aria-hidden>
        <ActionStatusIcon status={job.status} />
      </span>
      <span className="github-action-job-name">{job.name}</span>
      <span className="github-action-job-status">{actionStatusLabel(job.status, t)}</span>
    </button>
  )
}


export function SitePane({
  site,
  loading,
  error,
  code,
  showOpen = true,
  onPreview
}: {
  site: GithubSite | null
  loading: boolean
  error: string | null
  code: GithubErrorCode | undefined
  showOpen?: boolean
  onPreview?: () => void
}): React.JSX.Element {
  const t = useT()
  if (error && !site) {
    return <EmptyState {...emptyForCode(code, error, t)} />
  }
  if (!site) {
    return (
      <EmptyState
        title={loading ? t('common.loading') : t('github.loadFailedSite')}
        description={loading ? undefined : t('github.apiMissing')}
      />
    )
  }
  if (!isGithubPagesLive(site) && !site.homepage) {
    return (
      <EmptyState title={t('github.noSite')} description={t('github.noSiteDesc')}>
        <SiteConfigLink
          url={site.settingsUrl}
          label={t('github.siteConfig')}
          title={t('github.openPagesSettings')}
        />
      </EmptyState>
    )
  }
  return (
    <div
      className="github-site-host"
      onDoubleClick={() => onPreview?.()}
      onContextMenu={(event) => {
        if (!onPreview) return
        event.preventDefault()
        const items: MenuItem[] = [{ label: tt('common.preview'), onSelect: onPreview }]
        void showMenu(items, { x: event.clientX, y: event.clientY })
      }}
    >
      <SiteConfig site={site} showOpen={showOpen} />
    </div>
  )
}

function SiteConfigLink({
  url,
  label,
  title
}: {
  url: string
  label: string
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="github-site-config"
      title={title ?? label}
      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
    >
      <span>{label}</span>
      <ExternalLink size={11} aria-hidden />
    </button>
  )
}

function SiteConfig({
  site,
  showOpen
}: {
  site: GithubSite
  showOpen: boolean
}): React.JSX.Element {
  const t = useT()
  const view = fillGithubSiteGaps(site)
  const live = isGithubPagesLive(view)
  const customDomain = githubPagesCustomDomain(view)
  let urlHost: string | null = null
  if (view.url) {
    try {
      urlHost = new URL(view.url).hostname.replace(/^www\./i, '')
    } catch {
      urlHost = null
    }
  }
  const showDomain = Boolean(customDomain && customDomain !== urlHost)
  const sourceLabel = view.buildType === 'workflow'
    ? t('github.siteSourceWorkflow')
    : view.buildType === 'legacy' || view.source
      ? t('github.siteSourceLegacy')
      : null
  const branchLabel = view.source
    ? `${view.source.branch}${view.source.path === '/' ? '' : ` ${view.source.path}`}`
    : null
  const showHomepage = Boolean(
    view.homepage && !sameSiteHost(view.homepage, view.url, view.cname)
  )
  const deployedAt = view.latestBuild?.createdAt ? Date.parse(view.latestBuild.createdAt) : Number.NaN
  return (
    <div className="github-site">
      <div className="github-detail-scroll">
        <div className="github-detail-hero">
          <div className="github-detail-status-row">
            <span
              className={`github-detail-state ${pagesStatusClass(live ? view.pagesStatus ?? 'built' : null)}`}
            >
              {live ? pagesStatusLabel(view.pagesStatus ?? 'built', t) : t('github.noSite')}
            </span>
            {live && view.url ? (
              <button
                type="button"
                className="github-site-link"
                onClick={() => window.open(view.url!, '_blank', 'noopener,noreferrer')}
              >
                {view.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </button>
            ) : (
              <p className="github-merge-prose">{t('github.noSiteDesc')}</p>
            )}
            {showOpen ? (
              <SiteConfigLink
                url={view.settingsUrl}
                label={t('github.siteConfig')}
                title={t('github.openPagesSettings')}
              />
            ) : null}
          </div>
          {live && view.latestBuild ? (
            <p className="github-merge-prose">
              {t('github.siteLastDeployed', {
                user: view.latestBuild.pusher || t('github.authorUnknown')
              })}
              {Number.isFinite(deployedAt) ? ` · ${relativeTime(deployedAt)}` : ''}
            </p>
          ) : null}
        </div>
        <div className="github-detail-body">
          {live && (sourceLabel || branchLabel || showDomain || showHomepage) ? (
            <div className="github-site-fields-wrap">
              {sourceLabel ? <SiteField label={t('github.siteSource')}>{sourceLabel}</SiteField> : null}
              {branchLabel ? <SiteField label={t('github.siteBranch')}>{branchLabel}</SiteField> : null}
              {showDomain ? (
                <SiteField label={t('github.siteCustomDomain')}>{customDomain}</SiteField>
              ) : null}
              {showHomepage ? (
                <SiteField label={t('github.siteHomepage')}>
                  <button
                    type="button"
                    className="github-site-link"
                    onClick={() => window.open(view.homepage!, '_blank', 'noopener,noreferrer')}
                  >
                    {view.homepage}
                  </button>
                </SiteField>
              ) : null}
            </div>
          ) : !live ? (
            <div className="github-no-body">{t('github.noSiteDesc')}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SiteField({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="github-site-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}


export function PullDetail({
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

  return (
    <div className="github-detail-scroll">
      <div className="github-detail-hero">
        <div className="github-detail-title-row">
          <span
            className={`github-pr-state ${githubPullStateClass(item.state, item.draft)}`}
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
          <span className={`github-detail-state ${githubPullStateClass(item.state, item.draft)}`}>
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
      <div className="github-detail-body">
        {loading && !detail ? (
          <GithubDetailLoading label={t('common.loading')} />
        ) : error ? (
          <div className="github-detail-error">{error}</div>
        ) : detail ? (
          <ConversationTab detail={detail} />
        ) : null}
      </div>
    </div>
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

function GithubDetailLoading({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="github-detail-loading" aria-busy="true" aria-live="polite">
      <LoaderCircle size={14} className="github-action-spin" aria-hidden />
      <span>{label}</span>
    </div>
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

function ReviewStateIcon({ state }: { state: GithubReviewState }): React.JSX.Element {
  if (state === 'approved') return <Check size={11} />
  if (state === 'changes_requested') return <X size={11} />
  return <MessageSquare size={11} />
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
    <div className="markdown preview-markdown" dangerouslySetInnerHTML={{ __html: html }} />
  )
}
