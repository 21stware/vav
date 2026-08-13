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
