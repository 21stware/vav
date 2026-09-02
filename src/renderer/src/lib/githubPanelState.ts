import type { GithubActionStatus, GithubPullState, GithubReview } from '../../../shared/github.ts'

export function githubPullStateClass(state: GithubPullState, draft: boolean): string {
  if (state === 'merged') return 'is-merged'
  if (state === 'closed') return 'is-closed'
  if (draft) return 'is-draft'
  return 'is-open'
}

export function githubActionStateClass(status: GithubActionStatus): string {
  if (status === 'in_progress') return 'is-open'
  if (status === 'completed') return 'is-merged'
  return 'is-draft'
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
