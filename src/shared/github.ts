/** Shared GitHub PR types for main ↔ renderer. */

export type GithubPullStateFilter = 'open' | 'closed' | 'all'

export type GithubPullState = 'open' | 'closed' | 'merged'

export type GithubPullFileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged'

export type GithubErrorCode =
  | 'no-remote'
  | 'not-github'
  | 'auth'
  | 'rate-limit'
  | 'not-found'
  | 'network'

export interface GithubRepoRef {
  host: string
  owner: string
  repo: string
  fullName: string
  htmlUrl: string
  apiBase: string
}

export interface GithubLabel {
  name: string
  color: string
}

export interface GithubUserRef {
  login: string
  avatarUrl: string | null
}

export interface GithubPullListItem {
  number: number
  title: string
  state: GithubPullState
  draft: boolean
  url: string
  author: GithubUserRef
  createdAt: string
  updatedAt: string
  headRef: string
  baseRef: string
  labels: GithubLabel[]
}

export interface GithubPullFile {
  path: string
  status: GithubPullFileStatus
  additions: number
  deletions: number
  previousPath: string | null
}

export type GithubCheckConclusion =
  | 'success'
  | 'failure'
  | 'pending'
  | 'error'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'

export interface GithubCheck {
  name: string
  conclusion: GithubCheckConclusion
  detailsUrl: string | null
}

export type GithubReviewState =
  | 'approved'
  | 'changes_requested'
  | 'commented'
  | 'dismissed'
  | 'pending'

export interface GithubReview {
  id: number
  author: GithubUserRef
  state: GithubReviewState
  body: string | null
  submittedAt: string | null
}

export interface GithubComment {
  id: number
  author: GithubUserRef
  body: string
  createdAt: string
  path: string | null
  line: number | null
  /** Parent pull-request review, when this is an inline thread comment. */
  reviewId: number | null
}

export interface GithubCommit {
  sha: string
  message: string
  author: GithubUserRef
  committedAt: string
  url: string
}

export interface GithubPullDetail extends GithubPullListItem {
  body: string | null
  additions: number
  deletions: number
  changedFiles: number
  commits: number
  merged: boolean
  mergedAt: string | null
  mergedBy: GithubUserRef | null
  mergeable: boolean | null
  mergeableState: string | null
  assignees: GithubUserRef[]
  reviewers: GithubUserRef[]
  checks: GithubCheck[]
  checksState: GithubCheckConclusion
  reviews: GithubReview[]
  comments: GithubComment[]
  reviewComments: GithubComment[]
  commitList: GithubCommit[]
  files: GithubPullFile[]
}

export interface GithubPullsPage {
  repo: GithubRepoRef
  state: GithubPullStateFilter
  pulls: GithubPullListItem[]
  /** True when a token was sent (gh / env). Public repos may still succeed without. */
  authenticated: boolean
  /** List was capped at the request page size. */
  truncated: boolean
}

export type GithubResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: GithubErrorCode }

export type GithubTrayTab = 'pulls' | 'actions' | 'releases' | 'site'

export type GithubActionsScope = 'running' | 'history'

export type GithubActionStatus =
  | 'queued'
  | 'in_progress'
  | 'waiting'
  | 'pending'
  | 'requested'
  | 'completed'

export interface GithubActionRun {
  id: number
  name: string
  title: string
  status: GithubActionStatus
  conclusion: string | null
  url: string
  htmlUrl: string
  event: string
  headBranch: string
  actor: GithubUserRef
  createdAt: string
  updatedAt: string
  runStartedAt: string | null
}

export interface GithubActionJob {
  id: number
  name: string
  status: GithubActionStatus
  conclusion: string | null
  htmlUrl: string
  startedAt: string | null
  completedAt: string | null
}

export interface GithubActionRunDetail extends GithubActionRun {
  jobs: GithubActionJob[]
}

export interface GithubActionsPage {
  repo: GithubRepoRef
  runs: GithubActionRun[]
  authenticated: boolean
  scope?: GithubActionsScope
}

export interface GithubReleaseAsset {
  id: number
  name: string
  size: number
  browserDownloadUrl: string
}

export interface GithubRelease {
  id: number
  tag: string
  name: string
  draft: boolean
  prerelease: boolean
  url: string
  htmlUrl: string
  author: GithubUserRef
  publishedAt: string | null
  createdAt: string
  body: string | null
  assets: GithubReleaseAsset[]
}

export interface GithubReleasesPage {
  repo: GithubRepoRef
  releases: GithubRelease[]
  authenticated: boolean
  truncated: boolean
}

export type GithubSiteKind = 'pages' | 'homepage'

export type GithubPagesBuildType = 'legacy' | 'workflow'

export interface GithubPagesSource {
  branch: string
  path: string
}

export interface GithubPagesBuild {
  status: string
  commit: string | null
  pusher: string | null
  durationMs: number | null
  createdAt: string | null
  error: string | null
}

export interface GithubSite {
  repo: GithubRepoRef
  url: string | null
  kind: GithubSiteKind | null
  pagesStatus: string | null
  homepage: string | null
  authenticated: boolean
  hasPages: boolean
  settingsUrl: string
  buildType: GithubPagesBuildType | null
  source: GithubPagesSource | null
  cname: string | null
  httpsEnforced: boolean | null
  protectedDomainState: string | null
  custom404: boolean | null
  public: boolean | null
  latestBuild: GithubPagesBuild | null
}

const RUNNING_ACTION_STATUS = new Set<GithubActionStatus>([
  'queued',
  'in_progress',
  'waiting',
  'pending',
  'requested'
])

export function isRunningGithubActionStatus(status: string): status is GithubActionStatus {
  return RUNNING_ACTION_STATUS.has(status as GithubActionStatus)
}

/** Default public Pages URL when the Pages API is hidden but `has_pages` is set. */
export function defaultGithubPagesUrl(repo: GithubRepoRef): string | null {
  if (repo.host !== 'github.com') return null
  const owner = repo.owner
  const name = repo.repo
  if (name.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return `https://${owner}.github.io/`
  }
  return `https://${owner}.github.io/${name}/`
}

export function githubPagesSettingsUrl(repo: GithubRepoRef): string {
  return `${repo.htmlUrl.replace(/\/$/, '')}/settings/pages`
}

export function githubRepoSectionUrl(
  repo: GithubRepoRef,
  section: 'pulls' | 'actions' | 'releases'
): string {
  return `${repo.htmlUrl.replace(/\/$/, '')}/${section}`
}

/** Browser-facing source archives for a release tag (not the API zipball URLs). */
export function githubReleaseArchiveUrls(
  htmlUrl: string,
  tag: string
): { zip: string; tar: string } | null {
  const tagName = tag.trim()
  if (!tagName || !htmlUrl.trim()) return null
  try {
    const url = new URL(htmlUrl)
    const segs = url.pathname.split('/').filter(Boolean)
    if (segs.length < 2) return null
    const owner = segs[0]!
    const repo = segs[1]!
    const encoded = encodeURIComponent(tagName)
    const base = `${url.origin}/${owner}/${repo}/archive/refs/tags/${encoded}`
    return { zip: `${base}.zip`, tar: `${base}.tar.gz` }
  } catch {
    return null
  }
}

export function githubClosedPullsUrl(repo: GithubRepoRef): string {
  return `${githubRepoSectionUrl(repo, 'pulls')}?q=is%3Apr+is%3Aclosed`
}

function trimStr(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function httpUrl(value: unknown): string | null {
  const raw = trimStr(value)
  if (!raw || !/^https?:\/\//i.test(raw)) return null
  return raw
}

export function mapGithubPagesSource(raw: unknown): GithubPagesSource | null {
  if (!raw || typeof raw !== 'object') return null
  const branch = trimStr((raw as { branch?: unknown }).branch)
  if (!branch) return null
  const path = trimStr((raw as { path?: unknown }).path) ?? '/'
  return { branch, path }
}

export function mapGithubPagesBuild(raw: unknown): GithubPagesBuild | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as {
    status?: unknown
    commit?: unknown
    duration?: unknown
    created_at?: unknown
    updated_at?: unknown
    error?: unknown
    pusher?: unknown
  }
  const status = trimStr(rec.status)
  if (!status) return null
  const error =
    rec.error && typeof rec.error === 'object'
      ? trimStr((rec.error as { message?: unknown }).message)
      : null
  const pusher =
    rec.pusher && typeof rec.pusher === 'object'
      ? trimStr((rec.pusher as { login?: unknown }).login)
      : null
  return {
    status,
    commit: trimStr(rec.commit),
    pusher,
    durationMs: typeof rec.duration === 'number' ? rec.duration : null,
    createdAt: trimStr(rec.created_at) ?? trimStr(rec.updated_at),
    error
  }
}

export function mapGithubPagesDeployment(raw: unknown): GithubPagesBuild | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as {
    sha?: unknown
    created_at?: unknown
    updated_at?: unknown
    creator?: unknown
  }
  const pusher =
    rec.creator && typeof rec.creator === 'object'
      ? trimStr((rec.creator as { login?: unknown }).login)
      : null
  const commit = trimStr(rec.sha)
  const createdAt = trimStr(rec.updated_at) ?? trimStr(rec.created_at)
  if (!commit && !pusher && !createdAt) return null
  return {
    status: 'built',
    commit,
    pusher,
    durationMs: null,
    createdAt,
    error: null
  }
}

export function mapGithubSite(input: {
  repo: GithubRepoRef
  homepage: string | null
  hasPages: boolean
  pages: unknown | null
  latestBuild: unknown | null
  authenticated: boolean
}): GithubSite {
  const pages =
    input.pages && typeof input.pages === 'object' ? (input.pages as Record<string, unknown>) : null
  const cname = trimStr(pages?.cname)
  const pagesUrl = httpUrl(pages?.html_url)
  const cnameUrl = cname && !/^https?:\/\//i.test(cname) ? `https://${cname}/` : httpUrl(cname)
  const fallback = input.hasPages || pages ? defaultGithubPagesUrl(input.repo) : null
  const url = pagesUrl || cnameUrl || fallback
  const hasPages = Boolean(pages || input.hasPages || cname || pagesUrl)
  const kind = hasPages ? 'pages' : input.homepage ? 'homepage' : null
  const rec = pages as Record<string, unknown> | null
  const buildTypeRaw = trimStr(rec?.build_type) ?? trimStr(rec?.buildType)
  const buildType: GithubPagesBuildType | null =
    buildTypeRaw === 'workflow' || buildTypeRaw === 'legacy' ? buildTypeRaw : null
  const pagesStatus = trimStr(pages?.status) ?? (hasPages && url ? 'built' : null)
  return {
    repo: input.repo,
    url,
    kind,
    pagesStatus,
    homepage: httpUrl(input.homepage),
    authenticated: input.authenticated,
    hasPages,
    settingsUrl: githubPagesSettingsUrl(input.repo),
    buildType,
    source: mapGithubPagesSource(rec?.source),
    cname,
    httpsEnforced:
      rec && ('https_enforced' in rec || 'httpsEnforced' in rec)
        ? Boolean(rec.https_enforced ?? rec.httpsEnforced)
        : null,
    protectedDomainState: trimStr(pages?.protected_domain_state),
    custom404: pages && 'custom_404' in pages ? Boolean(pages.custom_404) : null,
    public: pages && 'public' in pages ? Boolean(pages.public) : null,
    latestBuild:
      mapGithubPagesBuild(input.latestBuild) || mapGithubPagesDeployment(firstRecord(input.latestBuild))
  }
}

function firstRecord(raw: unknown): unknown | null {
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw
}

/** Live Pages site — including workflow Pages where `status` is null. */
export function isGithubPagesLive(site: {
  hasPages?: boolean
  kind?: GithubSiteKind | null
  cname?: string | null
  url?: string | null
  pagesStatus?: string | null
}): boolean {
  return Boolean(
    site.hasPages || site.kind === 'pages' || site.cname || (site.url && site.kind !== 'homepage')
  )
}

export function githubPagesCustomDomain(site: {
  cname?: string | null
  url?: string | null
}): string | null {
  if (site.cname) return site.cname
  if (!site.url) return null
  try {
    const host = new URL(site.url).hostname.replace(/^www\./i, '')
    if (!host || host.endsWith('.github.io')) return null
    return host
  } catch {
    return null
  }
}

export function fillGithubSiteGaps(
  site: GithubSite,
  hints?: { cname?: string | null; workflow?: boolean }
): GithubSite {
  const cname = site.cname || hints?.cname || githubPagesCustomDomain(site)
  const buildType = site.buildType || (hints?.workflow ? 'workflow' : null)
  let httpsEnforced = site.httpsEnforced
  if (httpsEnforced == null && site.url) {
    if (/^https:\/\//i.test(site.url)) httpsEnforced = true
    else if (/^http:\/\//i.test(site.url)) httpsEnforced = false
  }
  const url = site.url || (cname ? `https://${cname.replace(/\/$/, '')}/` : null)
  const hasPages = Boolean(site.hasPages || cname || (url && site.kind !== 'homepage'))
  return {
    ...site,
    cname,
    buildType,
    httpsEnforced,
    url,
    hasPages,
    kind: hasPages ? 'pages' : site.kind
  }
}

export type GithubConversationItem =
  | { kind: 'comment'; at: number; comment: GithubComment }
  | { kind: 'inline'; at: number; comment: GithubComment }
  | { kind: 'review'; at: number; review: GithubReview; comments: GithubComment[] }

/**
 * GitHub.com conversation order: issue comments, submitted reviews (with their
 * inline threads nested), then orphan inline comments whose parent review is
 * missing. Empty "commented" reviews with no body and no threads are dropped —
 * review bots often emit those as shells around the real inline findings.
 */
export function mergePullConversation(
  comments: GithubComment[],
  reviews: GithubReview[],
  reviewComments: GithubComment[]
): GithubConversationItem[] {
  const nested = new Map<number, GithubComment[]>()
  const orphans: GithubComment[] = []
  const reviewIds = new Set(reviews.map((review) => review.id))
  for (const comment of reviewComments) {
    if (!(comment.body ?? '').trim()) continue
    const parent = comment.reviewId
    if (parent != null && reviewIds.has(parent)) {
      const list = nested.get(parent)
      if (list) list.push(comment)
      else nested.set(parent, [comment])
    } else {
      orphans.push(comment)
    }
  }
  const items: GithubConversationItem[] = [
    ...comments
      .filter((comment) => (comment.body ?? '').trim())
      .map((comment) => ({
        kind: 'comment' as const,
        at: Date.parse(comment.createdAt) || 0,
        comment
      })),
    ...reviews
      .filter((review) => {
        if (review.state === 'pending') return false
        const threads = nested.get(review.id) ?? []
        return Boolean(
          review.body ||
            threads.length > 0 ||
            review.state === 'approved' ||
            review.state === 'changes_requested' ||
            review.state === 'dismissed'
        )
      })
      .map((review) => ({
        kind: 'review' as const,
        at: Date.parse(review.submittedAt ?? '') || 0,
        review,
        comments: nested.get(review.id) ?? []
      })),
    ...orphans.map((comment) => ({
      kind: 'inline' as const,
      at: Date.parse(comment.createdAt) || 0,
      comment
    }))
  ]
  return items.sort((a, b) => a.at - b.at)
}

export function githubApiBase(host: string): string {
  const h = host.toLowerCase()
  if (h === 'github.com' || h === 'www.github.com' || h === 'ssh.github.com') {
    return 'https://api.github.com'
  }
  return `https://${host}/api/v3`
}

function stripGitPath(path: string): string {
  return path.replace(/^\//, '').replace(/\/+$/, '').replace(/\.git$/i, '')
}

function isGithubLikeHost(host: string): boolean {
  const h = host.toLowerCase()
  if (h === 'github.com' || h === 'www.github.com' || h === 'ssh.github.com') return true
  return h.split('.').includes('github')
}

function displayHost(host: string): string {
  const h = host.toLowerCase()
  if (h === 'www.github.com' || h === 'ssh.github.com') return 'github.com'
  return h
}

/**
 * Parse a git remote URL into owner/repo when the host is GitHub.com or
 * GitHub Enterprise (`github.company.com`, `company.github.com`, …).
 */
export function parseGithubRemote(url: string): GithubRepoRef | null {
  const raw = url.trim()
  if (!raw) return null

  let host: string
  let owner: string
  let repo: string

  const scp = /^git@([^:]+):(.+)$/i.exec(raw)
  if (scp) {
    host = scp[1]!
    const segs = stripGitPath(scp[2]!).split('/').filter(Boolean)
    if (segs.length < 2) return null
    owner = segs[0]!
    repo = segs[1]!
  } else {
    let href = raw
    if (/^ssh:\/\/(?:git@)?/i.test(href)) {
      href = href.replace(/^ssh:\/\/(?:git@)?/i, 'https://')
    } else if (/^git:\/\//i.test(href)) {
      href = href.replace(/^git:\/\//i, 'https://')
    } else if (!/^https?:\/\//i.test(href)) {
      return null
    }
    let parsed: URL
    try {
      parsed = new URL(href)
    } catch {
      return null
    }
    host = parsed.hostname
    const segs = stripGitPath(parsed.pathname).split('/').filter(Boolean)
    if (segs.length < 2) return null
    owner = segs[0]!
    repo = segs[1]!
  }

  if (!isGithubLikeHost(host)) return null
  const hostName = displayHost(host)
  try {
    owner = decodeURIComponent(owner)
    repo = decodeURIComponent(repo)
  } catch {
    return null
  }
  if (!owner || !repo) return null

  return {
    host: hostName,
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    htmlUrl: `https://${hostName}/${owner}/${repo}`,
    apiBase: githubApiBase(hostName)
  }
}
