import type { GithubActionStatus, GithubPullState, GithubReview } from '@shared/github.ts'

export function githubPullStateClass(state: GithubPullState, draft: boolean): string {
  if (state === 'merged') return 'is-merged'
  if (state === 'closed') return 'is-closed'
  if (draft) return 'is-draft'
  return 'is-open'
}

/** GitHub keeps `status: completed` for every finished run; the real result is `conclusion`. */
export type GithubActionOutcome =
  | 'in_progress'
  | 'queued'
  | 'waiting'
  | 'pending'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'

export function githubActionOutcome(
  status: GithubActionStatus,
  conclusion?: string | null
): GithubActionOutcome {
  if (status === 'in_progress') return 'in_progress'
  if (status === 'queued') return 'queued'
  if (status === 'waiting') return 'waiting'
  if (status === 'pending' || status === 'requested') return 'pending'
  if (status !== 'completed') return 'queued'
  switch (conclusion) {
    case 'failure':
    case 'startup_failure':
      return 'failure'
    case 'cancelled':
      return 'cancelled'
    case 'skipped':
    case 'stale':
    case 'neutral':
      return 'skipped'
    case 'timed_out':
      return 'timed_out'
    case 'action_required':
      return 'action_required'
    default:
      return 'success'
  }
}

export function githubActionStateClass(
  status: GithubActionStatus,
  conclusion?: string | null
): string {
  switch (githubActionOutcome(status, conclusion)) {
    case 'in_progress':
    case 'action_required':
      return 'is-open'
    case 'success':
      return 'is-merged'
    case 'failure':
    case 'timed_out':
      return 'is-closed'
    default:
      return 'is-draft'
  }
}

/** Keep the latest review per author; skip empty comment-only reviews. */
export function latestReviewByUser(reviews: GithubReview[]): GithubReview[] {
  const map = new Map<string, GithubReview>()
  for (const review of reviews) {
    if (review.state === 'commented' && !review.body) continue
    const key = review.author.login || String(review.id)
    map.set(key, review)
  }
  return [...map.values()]
}

export function pagesStatusClass(status: string | null): string {
  if (status === 'built') return 'is-merged'
  if (status === 'building') return 'is-open'
  if (status === 'errored') return 'is-closed'
  return 'is-draft'
}

export function sameSiteHost(
  homepage: string | null,
  url: string | null,
  cname: string | null
): boolean {
  const host = (value: string | null): string | null => {
    if (!value) return null
    try {
      const raw = /^https?:\/\//i.test(value) ? value : `https://${value}`
      return new URL(raw).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      return value.replace(/^www\./, '').toLowerCase()
    }
  }
  const home = host(homepage)
  if (!home) return false
  return home === host(url) || home === host(cname)
}
