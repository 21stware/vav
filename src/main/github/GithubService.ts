import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type {
  GithubActionJob,
  GithubActionRun,
  GithubActionRunDetail,
  GithubActionStatus,
  GithubActionsPage,
  GithubActionsScope,
  GithubRelease,
  GithubReleasesPage,
  GithubCheck,
  GithubCheckConclusion,
  GithubComment,
  GithubCommit,
  GithubErrorCode,
  GithubPullDetail,
  GithubPullFile,
  GithubPullFileStatus,
  GithubPullListItem,
  GithubPullStateFilter,
  GithubPullsPage,
  GithubRepoRef,
  GithubResult,
  GithubReview,
  GithubReviewState,
  GithubSite,
  GithubUserRef
} from '@shared/github'
import {
  fillGithubSiteGaps,
  isRunningGithubActionStatus,
  mapGithubSite,
  parseGithubRemote
} from '@shared/github'
import { loginPath, resolveOnLoginPath } from '../terminal/loginPath'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 20_000
const API_TIMEOUT_MS = 20_000
const API_LIST_TIMEOUT_MS = 45_000
const GH_TOKEN_TIMEOUT_MS = 8_000
const TOKEN_CACHE_MS = 60_000
const LIST_PAGE_SIZE = 50
const FILES_PAGE_SIZE = 100
const THREAD_PAGE_SIZE = 100
const MAX_LIST_PAGES = 10
const MAX_CONCURRENT_GITHUB = 3
const FETCH_RETRY_MS = [250, 800]
const TRANSIENT_HTTP = new Set([502, 503, 504])

async function git(
  cwd: string,
  args: string[],
  opts?: { allowFail?: boolean }
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PATH: loginPath(),
        GIT_TERMINAL_PROMPT: '0',
        LANG: 'C'
      }
    })
    return { stdout: stdout.toString(), stderr: stderr.toString(), code: 0 }
  } catch (err) {
    const e = err as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      code?: number | string
      message?: string
    }
    if (opts?.allowFail) {
      return {
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? e.message ?? '',
        code: typeof e.code === 'number' ? e.code : 1
      }
    }
    const detail = (e.stderr?.toString() || e.message || 'git failed').trim()
    throw new Error(detail.slice(0, 400))
  }
}

function pickGithubRemote(stdout: string): GithubRepoRef | null {
  const byName = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line.trim())
    if (!m) continue
    byName.set(m[1]!, m[2]!)
  }
  const order = ['origin', 'upstream', ...byName.keys()]
  const seen = new Set<string>()
  for (const name of order) {
    if (seen.has(name)) continue
    seen.add(name)
    const url = byName.get(name)
    if (!url) continue
    const ref = parseGithubRemote(url)
    if (ref) return ref
  }
  return null
}

async function detectGithubRepo(cwd: string): Promise<GithubResult<GithubRepoRef>> {
  const abs = resolve(cwd)
  if (!existsSync(abs)) {
    return { ok: false, error: 'Working directory not found', code: 'network' }
  }
  const { stdout, code } = await git(abs, ['remote', '-v'], { allowFail: true })
  if (code !== 0) {
    return { ok: false, error: 'Not a git repository', code: 'no-remote' }
  }
  if (!stdout.trim()) {
    return { ok: false, error: 'No git remotes', code: 'no-remote' }
  }
  const ref = pickGithubRemote(stdout)
  if (!ref) {
    return { ok: false, error: 'No GitHub remote', code: 'not-github' }
  }
  return { ok: true, data: ref }
}

function envToken(): string | null {
  const raw =
    process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_ENTERPRISE_TOKEN || ''
  const token = raw.trim()
  return token || null
}

async function ghAuthToken(host: string): Promise<string | null> {
  const gh = resolveOnLoginPath('gh')
  if (!gh) return null
  const args = ['auth', 'token']
  if (host !== 'github.com') args.push('--hostname', host)
  try {
    const { stdout } = await execFileAsync(gh, args, {
      timeout: GH_TOKEN_TIMEOUT_MS,
      env: {
        ...process.env,
        PATH: loginPath()
      }
    })
    const token = stdout.toString().trim()
    return token || null
  } catch {
    return null
  }
}

let cachedToken: { host: string; token: string | null; at: number } | null = null

async function resolveToken(host: string): Promise<string | null> {
  const fromEnv = envToken()
  if (fromEnv) return fromEnv
  if (cachedToken && cachedToken.host === host && Date.now() - cachedToken.at < TOKEN_CACHE_MS) {
    return cachedToken.token
  }
  const token = await ghAuthToken(host)
  cachedToken = { host, token, at: Date.now() }
  return token
}

type GhUser = { login?: string; avatar_url?: string }
type GhLabel = { name?: string; color?: string }
type GhPull = {
  number: number
  title: string
  state: string
  draft?: boolean
  html_url: string
  user?: GhUser | null
  created_at: string
  updated_at: string
  merged_at?: string | null
  merged?: boolean
  body?: string | null
  additions?: number
  deletions?: number
  changed_files?: number
  commits?: number
  head?: { ref?: string; sha?: string }
  base?: { ref?: string }
  labels?: GhLabel[]
  requested_reviewers?: GhUser[]
  assignees?: GhUser[]
  merged_by?: GhUser | null
  mergeable?: boolean | null
  mergeable_state?: string | null
}
type GhFile = {
  filename: string
  status?: string
  additions?: number
  deletions?: number
  previous_filename?: string
}

function mapUser(user: GhUser | null | undefined): GithubUserRef {
  return {
    login: user?.login ?? '',
    avatarUrl: user?.avatar_url ?? null
  }
}

function mapListItem(p: GhPull): GithubPullListItem {
  const merged = Boolean(p.merged_at) || p.merged === true
  return {
    number: p.number,
    title: p.title,
    state: merged ? 'merged' : p.state === 'closed' ? 'closed' : 'open',
    draft: Boolean(p.draft),
    url: p.html_url,
    author: mapUser(p.user),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    headRef: p.head?.ref ?? '',
    baseRef: p.base?.ref ?? '',
    labels: (p.labels ?? [])
      .filter((l): l is GhLabel & { name: string } => Boolean(l.name))
      .map((l) => ({ name: l.name, color: l.color ?? 'ededed' }))
  }
}

function mapFileStatus(status: string | undefined): GithubPullFileStatus {
  switch (status) {
    case 'added':
    case 'removed':
    case 'modified':
    case 'renamed':
    case 'copied':
    case 'changed':
    case 'unchanged':
      return status
    default:
      return 'modified'
  }
}

function mapFile(f: GhFile): GithubPullFile {
  return {
    path: f.filename,
    status: mapFileStatus(f.status),
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    previousPath: f.previous_filename ?? null
  }
}

type GhComment = {
  id: number
  user?: GhUser | null
  body?: string | null
  created_at?: string
  path?: string
  line?: number | null
  original_line?: number | null
  pull_request_review_id?: number | null
}

type GhReview = {
  id: number
  user?: GhUser | null
  body?: string | null
  state?: string
  submitted_at?: string | null
}

type GhCheckRun = {
  name?: string
  status?: string
  conclusion?: string | null
  html_url?: string | null
  details_url?: string | null
}

type GhStatus = {
  context?: string
  state?: string
  target_url?: string | null
}

type GhCommit = {
  sha: string
  html_url?: string
  author?: GhUser | null
  commit?: {
    message?: string
    author?: { name?: string; date?: string }
    committer?: { date?: string }
  }
}

function mapComment(c: GhComment): GithubComment {
  return {
    id: c.id,
    author: mapUser(c.user),
    body: c.body ?? '',
    createdAt: c.created_at ?? '',
    path: c.path ?? null,
    line: c.line ?? c.original_line ?? null,
    reviewId: c.pull_request_review_id ?? null
  }
}

function mapCommit(c: GhCommit): GithubCommit {
  const login = c.author?.login || c.commit?.author?.name || ''
  return {
    sha: c.sha,
    message: (c.commit?.message ?? '').split('\n')[0] ?? '',
    author: {
      login,
      avatarUrl: c.author?.avatar_url ?? null
    },
    committedAt: c.commit?.committer?.date || c.commit?.author?.date || '',
    url: c.html_url ?? ''
  }
}

function mapReviewState(state: string | undefined): GithubReviewState {
  switch ((state ?? '').toLowerCase()) {
    case 'approved':
      return 'approved'
    case 'changes_requested':
      return 'changes_requested'
    case 'dismissed':
      return 'dismissed'
    case 'pending':
      return 'pending'
    default:
      return 'commented'
  }
}

function mapReview(r: GhReview): GithubReview {
  return {
    id: r.id,
    author: mapUser(r.user),
    state: mapReviewState(r.state),
    body: r.body?.trim() ? r.body : null,
    submittedAt: r.submitted_at ?? null
  }
}

function mapCheckRunConclusion(
  status: string | undefined,
  conclusion: string | null | undefined
): GithubCheckConclusion {
  if (status && status !== 'completed') return 'pending'
  switch (conclusion) {
    case 'success':
    case 'failure':
    case 'neutral':
    case 'cancelled':
    case 'skipped':
    case 'timed_out':
    case 'action_required':
      return conclusion
    case 'stale':
      return 'neutral'
    default:
      return 'pending'
  }
}

function mapCommitStatus(state: string | undefined): GithubCheckConclusion {
  if (state === 'success') return 'success'
  if (state === 'pending') return 'pending'
  if (state === 'error') return 'error'
  return 'failure'
}

function overallChecks(checks: GithubCheck[]): GithubCheckConclusion {
  if (
    checks.some(
      (c) =>
        c.conclusion === 'failure' ||
        c.conclusion === 'error' ||
        c.conclusion === 'timed_out' ||
        c.conclusion === 'action_required'
    )
  ) {
    return 'failure'
  }
  if (checks.some((c) => c.conclusion === 'pending')) return 'pending'
  if (checks.length === 0) return 'neutral'
  return 'success'
}

function mergeChecks(runs: GhCheckRun[], statuses: GhStatus[]): GithubCheck[] {
  const byName = new Map<string, GithubCheck>()
  for (const st of statuses) {
    const name = st.context?.trim()
    if (!name) continue
    byName.set(name, {
      name,
      conclusion: mapCommitStatus(st.state),
      detailsUrl: st.target_url ?? null
    })
  }
  for (const run of runs) {
    const name = run.name?.trim()
    if (!name) continue
    byName.set(name, {
      name,
      conclusion: mapCheckRunConclusion(run.status, run.conclusion),
      detailsUrl: run.html_url ?? run.details_url ?? null
    })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function asArray<T>(json: unknown, key?: string): T[] {
  if (Array.isArray(json)) return json as T[]
  if (key && json && typeof json === 'object' && key in json) {
    const inner = (json as Record<string, unknown>)[key]
    if (Array.isArray(inner)) return inner as T[]
  }
  return []
}

type GithubFetchOk = { ok: true; res: Response; json: unknown }
type GithubFetchFail = { ok: false; error: string; code?: GithubErrorCode }
type GithubFetchResult = GithubFetchOk | GithubFetchFail

function optionalJson(fetched: GithubFetchResult): unknown | null {
  return fetched.ok ? fetched.json : null
}

function fail(error: string, code?: GithubErrorCode): GithubFetchFail {
  return { ok: false, error, code }
}

let githubInflight = 0
const githubWaiters: Array<() => void> = []

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withGithubSlot<T>(fn: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    const tryAcquire = (): void => {
      if (githubInflight < MAX_CONCURRENT_GITHUB) {
        githubInflight += 1
        resolve()
        return
      }
      githubWaiters.push(tryAcquire)
    }
    tryAcquire()
  })
  try {
    return await fn()
  } finally {
    githubInflight -= 1
    githubWaiters.shift()?.()
  }
}

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = 'cause' in err && err.cause instanceof Error ? ` ${err.cause.message}` : ''
  return `${err.name} ${err.message}${cause}`
}

function isTransientNetwork(err: unknown): boolean {
  const name = err instanceof Error ? err.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return true
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|UND_ERR|other side closed|socket|EOF|ConnectTimeout|HeadersTimeout|BodyTimeout|network/i.test(
    errorText(err)
  )
}

function describeNetworkError(err: unknown): string {
  const text = errorText(err)
  if (/timeout|aborted|TimeoutError|AbortError/i.test(text)) return 'GitHub request timed out'
  return 'Could not reach GitHub'
}

function failFromHttp(
  status: number,
  json: unknown,
  token: string | null,
  headers: Headers
): GithubFetchFail {
  const message =
    json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
      ? json.message
      : `GitHub ${status}`
  if (status === 401) return fail(message, 'auth')
  if (status === 403) {
    const remaining = headers.get('x-ratelimit-remaining')
    if (remaining === '0' || /rate limit/i.test(message)) {
      return fail(message, 'rate-limit')
    }
    return fail(message, 'auth')
  }
  if (status === 404) return fail(message, token ? 'not-found' : 'auth')
  return fail(message)
}

async function githubFetch(
  url: string,
  token: string | null,
  timeoutMs = API_TIMEOUT_MS
): Promise<GithubFetchResult> {
  return withGithubSlot(async () => {
    let last: GithubFetchFail | null = null
    for (let attempt = 0; attempt <= FETCH_RETRY_MS.length; attempt++) {
      try {
        const headers: Record<string, string> = {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'vav'
        }
        if (token) headers.Authorization = `Bearer ${token}`
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs)
        })
        let json: unknown = null
        const text = await res.text()
        if (text) {
          try {
            json = JSON.parse(text) as unknown
          } catch {
            json = { message: text.slice(0, 400) }
          }
        }
        if (!res.ok) {
          if (TRANSIENT_HTTP.has(res.status) && attempt < FETCH_RETRY_MS.length) {
            last = fail(`GitHub ${res.status}`, 'network')
            await sleep(FETCH_RETRY_MS[attempt]!)
            continue
          }
          return failFromHttp(res.status, json, token, res.headers)
        }
        return { ok: true, res, json }
      } catch (err) {
        last = fail(describeNetworkError(err), 'network')
        if (attempt < FETCH_RETRY_MS.length && isTransientNetwork(err)) {
          await sleep(FETCH_RETRY_MS[attempt]!)
          continue
        }
        return last
      }
    }
    return last ?? fail('Could not reach GitHub', 'network')
  })
}

function parseGithubLinkNext(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (m) return m[1]!
  }
  return null
}

async function githubFetchPages(
  url: string,
  token: string | null,
  innerKey?: string
): Promise<unknown[]> {
  const items: unknown[] = []
  let next: string | null = url
  let pages = 0
  while (next && pages < MAX_LIST_PAGES) {
    const fetched = await githubFetch(next, token, API_LIST_TIMEOUT_MS)
    if (!fetched.ok) break
    items.push(...asArray<unknown>(fetched.json, innerKey))
    next = parseGithubLinkNext(fetched.res.headers.get('link'))
    pages += 1
  }
  return items
}

function graphqlUrl(repo: GithubRepoRef): string {
  if (repo.host === 'github.com') return 'https://api.github.com/graphql'
  return `${repo.apiBase.replace(/\/api\/v3$/, '')}/api/graphql`
}

type GqlActor = { login?: string | null; avatarUrl?: string | null }
type GqlCommentNode = {
  databaseId?: number | null
  body?: string | null
  createdAt?: string | null
  path?: string | null
  line?: number | null
  originalLine?: number | null
  author?: GqlActor | null
  pullRequestReview?: { databaseId?: number | null } | null
}
type GqlConnection<T> = {
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
  nodes?: T[] | null
}

const THREADS_QUERY = `query ($owner: String!, $repo: String!, $number: Int!, $threadsCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $threadsCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          comments(first: 50) {
            nodes {
              databaseId body createdAt path line originalLine
              author { login avatarUrl }
              pullRequestReview { databaseId }
            }
          }
        }
      }
    }
  }
}`

function mapGqlActor(actor: GqlActor | null | undefined): GithubUserRef {
  return {
    login: actor?.login ?? '',
    avatarUrl: actor?.avatarUrl ?? null
  }
}

function mapGqlReviewComment(node: GqlCommentNode): GithubComment | null {
  const id = node.databaseId
  if (id == null) return null
  return {
    id,
    author: mapGqlActor(node.author),
    body: node.body ?? '',
    createdAt: node.createdAt ?? '',
    path: node.path ?? null,
    line: node.line ?? node.originalLine ?? null,
    reviewId: node.pullRequestReview?.databaseId ?? null
  }
}

async function githubGraphql(
  repo: GithubRepoRef,
  token: string,
  variables: Record<string, unknown>
): Promise<unknown | null> {
  return withGithubSlot(async () => {
    for (let attempt = 0; attempt <= FETCH_RETRY_MS.length; attempt++) {
      try {
        const res = await fetch(graphqlUrl(repo), {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'vav'
          },
          body: JSON.stringify({ query: THREADS_QUERY, variables }),
          signal: AbortSignal.timeout(API_LIST_TIMEOUT_MS)
        })
        const json = (await res.json()) as { data?: unknown }
        if (res.ok && json.data) return json.data
        if (TRANSIENT_HTTP.has(res.status) && attempt < FETCH_RETRY_MS.length) {
          await sleep(FETCH_RETRY_MS[attempt]!)
          continue
        }
        return null
      } catch (err) {
        if (attempt < FETCH_RETRY_MS.length && isTransientNetwork(err)) {
          await sleep(FETCH_RETRY_MS[attempt]!)
          continue
        }
        return null
      }
    }
    return null
  })
}

type PullConversation = {
  comments: GithubComment[]
  reviews: GithubReview[]
  reviewComments: GithubComment[]
}

async function fetchReviewThreadsGraphql(
  repo: GithubRepoRef,
  token: string,
  number: number
): Promise<GithubComment[] | null> {
  const reviewComments: GithubComment[] = []
  let threadsCursor: string | undefined
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const variables: Record<string, unknown> = {
      owner: repo.owner,
      repo: repo.repo,
      number
    }
    if (threadsCursor) variables.threadsCursor = threadsCursor
    const data = await githubGraphql(repo, token, variables)
    if (!data) return page === 0 ? null : reviewComments
    const conn = (
      data as {
        repository?: {
          pullRequest?: {
            reviewThreads?: GqlConnection<{ comments?: { nodes?: GqlCommentNode[] | null } | null }>
          }
        }
      }
    ).repository?.pullRequest?.reviewThreads
    if (!conn) return page === 0 ? null : reviewComments
    for (const thread of conn.nodes ?? []) {
      for (const node of thread.comments?.nodes ?? []) {
        const mapped = mapGqlReviewComment(node)
        if (mapped) reviewComments.push(mapped)
      }
    }
    if (conn.pageInfo?.hasNextPage && conn.pageInfo.endCursor) {
      threadsCursor = conn.pageInfo.endCursor
    } else {
      return reviewComments
    }
  }
  return reviewComments
}

async function fetchPullConversation(
  repo: GithubRepoRef,
  token: string | null,
  number: number
): Promise<PullConversation> {
  const base = repoApi(repo)
  const q = `per_page=${THREAD_PAGE_SIZE}`
  const [commentsRaw, reviewsRaw, gqlThreads] = await Promise.all([
    githubFetchPages(`${base}/issues/${number}/comments?${q}`, token),
    githubFetchPages(`${base}/pulls/${number}/reviews?${q}`, token),
    token ? fetchReviewThreadsGraphql(repo, token, number) : Promise.resolve(null)
  ])
  return {
    comments: asArray<GhComment>(commentsRaw).map(mapComment),
    reviews: asArray<GhReview>(reviewsRaw)
      .map(mapReview)
      .filter((r) => r.state !== 'pending'),
    reviewComments: gqlThreads ?? []
  }
}

function pullsUrl(repo: GithubRepoRef, state: GithubPullStateFilter): string {
  const params = new URLSearchParams({
    state,
    sort: 'updated',
    direction: 'desc',
    per_page: String(LIST_PAGE_SIZE)
  })
  return `${repo.apiBase}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls?${params}`
}

function pullUrl(repo: GithubRepoRef, number: number): string {
  return `${repo.apiBase}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${number}`
}

function pullFilesUrl(repo: GithubRepoRef, number: number): string {
  const params = new URLSearchParams({ per_page: String(FILES_PAGE_SIZE) })
  return `${repo.apiBase}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${number}/files?${params}`
}

function repoApi(repo: GithubRepoRef): string {
  return `${repo.apiBase}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
}

export async function listGithubPulls(
  cwd: string,
  state: GithubPullStateFilter = 'open'
): Promise<GithubResult<GithubPullsPage>> {
  const filter: GithubPullStateFilter =
    state === 'closed' || state === 'all' ? state : 'open'
  const detected = await detectGithubRepo(cwd)
  if (!detected.ok) return detected
  const repo = detected.data
  const token = await resolveToken(repo.host)
  const fetched = await githubFetch(pullsUrl(repo, filter), token)
  if (!fetched.ok) return fetched
  if (!Array.isArray(fetched.json)) {
    return fail('Unexpected GitHub response')
  }
  const pulls = (fetched.json as GhPull[]).map(mapListItem)
  return {
    ok: true,
    data: {
      repo,
      state: filter,
      pulls,
      authenticated: Boolean(token),
      truncated: pulls.length >= LIST_PAGE_SIZE
    }
  }
}

type GhWorkflowRun = {
  id: number
  name?: string
  display_title?: string
  status?: string
  conclusion?: string | null
  html_url?: string
  url?: string
  event?: string
  head_branch?: string
  actor?: GhUser | null
  created_at?: string
  updated_at?: string
  run_started_at?: string | null
}

type GhWorkflowJob = {
  id: number
  name?: string
  status?: string
  conclusion?: string | null
  html_url?: string
  started_at?: string | null
  completed_at?: string | null
}

function mapActionStatus(status: string | undefined): GithubActionStatus {
  if (status === 'completed') return 'completed'
  if (isRunningGithubActionStatus(status ?? '')) return status as GithubActionStatus
  return 'queued'
}

function mapActionRun(run: GhWorkflowRun): GithubActionRun {
  return {
    id: run.id,
    name: run.name ?? '',
    title: (run.display_title || run.name || '').trim(),
    status: mapActionStatus(run.status),
    conclusion: run.conclusion ?? null,
    url: run.url ?? '',
    htmlUrl: run.html_url ?? '',
    event: run.event ?? '',
    headBranch: run.head_branch ?? '',
    actor: mapUser(run.actor),
    createdAt: run.created_at ?? '',
    updatedAt: run.updated_at ?? '',
    runStartedAt: run.run_started_at ?? null
  }
}

function mapActionJob(job: GhWorkflowJob): GithubActionJob {
  return {
    id: job.id,
    name: job.name ?? '',
    status: mapActionStatus(job.status),
    conclusion: job.conclusion ?? null,
    htmlUrl: job.html_url ?? '',
    startedAt: job.started_at ?? null,
    completedAt: job.completed_at ?? null
  }
}

const RUNNING_ACTION_STATUSES = [
  'in_progress',
  'queued',
  'waiting',
  'pending',
  'requested'
] as const

export async function listGithubActions(
  cwd: string,
  scope: GithubActionsScope = 'running'
): Promise<GithubResult<GithubActionsPage>> {
  const detected = await detectGithubRepo(cwd)
  if (!detected.ok) return detected
  const repo = detected.data
  const token = await resolveToken(repo.host)
  const base = repoApi(repo)
  if (scope === 'history') {
    const page = await githubFetch(
      `${base}/actions/runs?status=completed&per_page=${LIST_PAGE_SIZE}`,
      token
    )
    if (!page.ok) return page
    const runs = asArray<GhWorkflowRun>(page.json, 'workflow_runs')
      .filter((run) => run?.id)
      .map(mapActionRun)
      .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
    return {
      ok: true,
      data: { repo, runs, authenticated: Boolean(token), scope }
    }
  }
  const fetched = await Promise.all(
    RUNNING_ACTION_STATUSES.map((status) =>
      githubFetch(`${base}/actions/runs?status=${status}&per_page=${LIST_PAGE_SIZE}`, token)
    )
  )
  const byId = new Map<number, GithubActionRun>()
  for (const page of fetched) {
    if (!page.ok) {
      if (page.code === 'not-found') continue
      return page
    }
    const runs = asArray<GhWorkflowRun>(page.json, 'workflow_runs')
    for (const run of runs) {
      if (!run?.id || !isRunningGithubActionStatus(run.status ?? '')) continue
      byId.set(run.id, mapActionRun(run))
    }
  }
  const runs = [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.updatedAt) || 0
    const tb = Date.parse(b.updatedAt) || 0
    return tb - ta
  })
  return {
    ok: true,
    data: { repo, runs, authenticated: Boolean(token), scope: 'running' }
  }
}

type GhRelease = {
  id: number
  tag_name?: string
  name?: string | null
  draft?: boolean
  prerelease?: boolean
  html_url?: string
  url?: string
  body?: string | null
  author?: GhUser | null
  published_at?: string | null
  created_at?: string
}

function mapRelease(row: GhRelease): GithubRelease {
  return {
    id: row.id,
    tag: row.tag_name ?? '',
    name: (row.name || row.tag_name || '').trim(),
    draft: row.draft === true,
    prerelease: row.prerelease === true,
    url: row.url ?? '',
    htmlUrl: row.html_url ?? '',
    author: mapUser(row.author),
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at ?? '',
    body: row.body ?? null
  }
}

export async function listGithubReleases(cwd: string): Promise<GithubResult<GithubReleasesPage>> {
  const detected = await detectGithubRepo(cwd)
  if (!detected.ok) return detected
  const repo = detected.data
  const token = await resolveToken(repo.host)
  const fetched = await githubFetch(
    `${repoApi(repo)}/releases?per_page=${LIST_PAGE_SIZE}`,
    token
  )
  if (!fetched.ok) return fetched
  if (!Array.isArray(fetched.json)) return fail('Unexpected GitHub response')
  const releases = (fetched.json as GhRelease[]).filter((row) => row?.id).map(mapRelease)
  return {
    ok: true,
    data: {
      repo,
      releases,
      authenticated: Boolean(token),
      truncated: releases.length >= LIST_PAGE_SIZE
    }
  }
}

export async function getGithubActionRun(
  cwd: string,
  runId: number
): Promise<GithubResult<GithubActionRunDetail>> {
  const id = Math.floor(runId)
  if (!Number.isFinite(id) || id <= 0) return fail('Invalid workflow run')
  const detected = await detectGithubRepo(cwd)
  if (!detected.ok) return detected
  const repo = detected.data
  const token = await resolveToken(repo.host)
  const base = repoApi(repo)
  const [runFetched, jobsFetched] = await Promise.all([
    githubFetch(`${base}/actions/runs/${id}`, token),
    githubFetch(`${base}/actions/runs/${id}/jobs?per_page=100`, token)
  ])
  if (!runFetched.ok) return runFetched
  if (!runFetched.json || typeof runFetched.json !== 'object') {
    return fail('Unexpected GitHub response')
  }
  const run = mapActionRun(runFetched.json as GhWorkflowRun)
  const jobs = jobsFetched.ok
    ? asArray<GhWorkflowJob>(jobsFetched.json, 'jobs').map(mapActionJob)
    : []
  return { ok: true, data: { ...run, jobs } }
}

type GhRepoInfo = { homepage?: string | null; has_pages?: boolean }

export async function getGithubSite(cwd: string): Promise<GithubResult<GithubSite>> {
  const detected = await detectGithubRepo(cwd)
  if (!detected.ok) return detected
  const repo = detected.data
  const token = await resolveToken(repo.host)
  const base = repoApi(repo)
  const [repoFetched, pagesFetched, buildFetched, deployFetched] = await Promise.all([
    githubFetch(base, token),
    githubFetch(`${base}/pages`, token),
    githubFetch(`${base}/pages/builds/latest`, token),
    githubFetch(`${base}/deployments?environment=github-pages&per_page=1`, token)
  ])
  if (!repoFetched.ok) return repoFetched
  const info =
    repoFetched.json && typeof repoFetched.json === 'object'
      ? (repoFetched.json as GhRepoInfo)
      : {}
  const homepage = typeof info.homepage === 'string' ? info.homepage : null
  const pages =
    pagesFetched.ok && pagesFetched.json && typeof pagesFetched.json === 'object'
      ? pagesFetched.json
      : null
  const latestBuild =
    (buildFetched.ok && buildFetched.json && typeof buildFetched.json === 'object'
      ? buildFetched.json
      : null) ??
    (deployFetched.ok ? deployFetched.json : null)
  const hints = await readLocalPagesHints(cwd)
  return {
    ok: true,
    data: fillGithubSiteGaps(
      mapGithubSite({
        repo,
        homepage,
        hasPages: Boolean(info.has_pages),
        pages,
        latestBuild,
        authenticated: Boolean(token)
      }),
      hints
    )
  }
}

async function readLocalPagesHints(
  cwd: string
): Promise<{ cname: string | null; workflow: boolean }> {
  const readCname = async (rel: string): Promise<string | null> => {
    try {
      const line = (await readFile(join(cwd, rel), 'utf8')).trim().split(/\s+/)[0] ?? ''
      return line || null
    } catch {
      return null
    }
  }
  const cname = (await readCname('site/CNAME')) || (await readCname('CNAME'))
  const workflow = existsSync(join(cwd, '.github/workflows/pages.yml'))
  return { cname, workflow }
}

export async function getGithubPull(
  cwd: string,
  number: number
): Promise<GithubResult<GithubPullDetail>> {
  const n = Math.floor(number)
  if (!Number.isFinite(n) || n <= 0) return fail('Invalid pull request number')
  const detected = await detectGithubRepo(cwd)
  if (!detected.ok) return detected
  const repo = detected.data
  const token = await resolveToken(repo.host)
  const base = repoApi(repo)
  const q = `per_page=${THREAD_PAGE_SIZE}`
  const pullFetched = await githubFetch(pullUrl(repo, n), token)
  if (!pullFetched.ok) return pullFetched
  if (!pullFetched.json || typeof pullFetched.json !== 'object') {
    return fail('Unexpected GitHub response')
  }
  const p = pullFetched.json as GhPull
  const sha = p.head?.sha ?? ''
  const [filesFetched, commitsRaw, conversation, checkRunsRaw, statusFetched] = await Promise.all([
    githubFetch(pullFilesUrl(repo, n), token),
    githubFetchPages(`${base}/pulls/${n}/commits?${q}`, token),
    fetchPullConversation(repo, token, n),
    sha
      ? githubFetchPages(
          `${base}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100&filter=latest`,
          token,
          'check_runs'
        )
      : Promise.resolve([]),
    sha
      ? githubFetch(`${base}/commits/${encodeURIComponent(sha)}/status`, token)
      : Promise.resolve(fail('skip'))
  ])
  const files: GithubPullFile[] =
    !filesFetched.ok || !Array.isArray(filesFetched.json)
      ? []
      : (filesFetched.json as GhFile[]).map(mapFile)
  const { comments, reviews, reviewComments } = conversation
  let commitList = asArray<GhCommit>(commitsRaw).map(mapCommit).filter((c) => c.sha)
  if (commitList.length === 0 && sha) {
    commitList = [
      {
        sha,
        message: p.title,
        author: mapUser(p.user),
        committedAt: p.updated_at || p.created_at,
        url: `${p.html_url}/commits/${sha}`
      }
    ]
  }
  const checkRuns = asArray<GhCheckRun>(checkRunsRaw)
  const statuses = asArray<GhStatus>(optionalJson(statusFetched), 'statuses')
  const checks = mergeChecks(checkRuns, statuses)
  const item = mapListItem(p)
  return {
    ok: true,
    data: {
      ...item,
      body: p.body ?? null,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      changedFiles: p.changed_files ?? files.length,
      commits: p.commits ?? 0,
      merged: Boolean(p.merged) || Boolean(p.merged_at),
      mergedAt: p.merged_at ?? null,
      mergedBy: p.merged_by ? mapUser(p.merged_by) : null,
      mergeable: typeof p.mergeable === 'boolean' ? p.mergeable : null,
      mergeableState: p.mergeable_state ?? null,
      assignees: (p.assignees ?? []).map(mapUser).filter((u) => u.login),
      reviewers: (p.requested_reviewers ?? []).map(mapUser).filter((u) => u.login),
      checks,
      checksState: overallChecks(checks),
      reviews,
      comments,
      reviewComments,
      commitList,
      files
    }
  }
}
