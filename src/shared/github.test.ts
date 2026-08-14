import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  defaultGithubPagesUrl,
  fillGithubSiteGaps,
  githubApiBase,
  githubPagesCustomDomain,
  githubPagesSettingsUrl,
  isGithubPagesLive,
  isRunningGithubActionStatus,
  mapGithubSite,
  mergePullConversation,
  parseGithubRemote
} from './github.ts'

describe('parseGithubRemote', () => {
  it('parses scp-style github.com remotes', () => {
    const ref = parseGithubRemote('git@github.com:oboo/vav.git')
    assert.deepEqual(ref, {
      host: 'github.com',
      owner: 'oboo',
      repo: 'vav',
      fullName: 'oboo/vav',
      htmlUrl: 'https://github.com/oboo/vav',
      apiBase: 'https://api.github.com'
    })
  })

  it('parses https remotes with and without .git', () => {
    const a = parseGithubRemote('https://github.com/oboo/vav.git')
    const b = parseGithubRemote('https://github.com/oboo/vav')
    const c = parseGithubRemote('https://github.com/oboo/vav.git/')
    assert.equal(a?.fullName, 'oboo/vav')
    assert.equal(b?.fullName, 'oboo/vav')
    assert.equal(c?.fullName, 'oboo/vav')
  })

  it('parses ssh:// and git:// remotes', () => {
    const ssh = parseGithubRemote('ssh://git@github.com/oboo/vav.git')
    const git = parseGithubRemote('git://github.com/oboo/vav.git')
    assert.equal(ssh?.fullName, 'oboo/vav')
    assert.equal(git?.fullName, 'oboo/vav')
  })

  it('keeps dots in the repo name', () => {
    const ref = parseGithubRemote('git@github.com:owner/foo.js.git')
    assert.equal(ref?.repo, 'foo.js')
  })

  it('parses GitHub Enterprise hosts', () => {
    const ref = parseGithubRemote('git@github.company.com:org/app.git')
    assert.equal(ref?.host, 'github.company.com')
    assert.equal(ref?.fullName, 'org/app')
    assert.equal(ref?.apiBase, 'https://github.company.com/api/v3')
  })

  it('normalizes ssh.github.com to github.com', () => {
    const ref = parseGithubRemote('ssh://git@ssh.github.com/oboo/vav.git')
    assert.equal(ref?.host, 'github.com')
    assert.equal(ref?.apiBase, 'https://api.github.com')
  })

  it('rejects gitlab and bitbucket remotes', () => {
    assert.equal(parseGithubRemote('git@gitlab.com:owner/repo.git'), null)
    assert.equal(parseGithubRemote('https://bitbucket.org/owner/repo.git'), null)
    assert.equal(parseGithubRemote('https://example.com/owner/repo.git'), null)
  })

  it('rejects empty or malformed urls', () => {
    assert.equal(parseGithubRemote(''), null)
    assert.equal(parseGithubRemote('git@github.com:only-owner.git'), null)
    assert.equal(parseGithubRemote('not a url'), null)
  })
})

describe('githubApiBase', () => {
  it('uses api.github.com for github.com', () => {
    assert.equal(githubApiBase('github.com'), 'https://api.github.com')
    assert.equal(githubApiBase('ssh.github.com'), 'https://api.github.com')
  })

  it('uses /api/v3 for enterprise hosts', () => {
    assert.equal(githubApiBase('github.company.com'), 'https://github.company.com/api/v3')
  })
})

describe('isRunningGithubActionStatus', () => {
  it('keeps queued / in-progress / waiting runs', () => {
    assert.equal(isRunningGithubActionStatus('queued'), true)
    assert.equal(isRunningGithubActionStatus('in_progress'), true)
    assert.equal(isRunningGithubActionStatus('waiting'), true)
    assert.equal(isRunningGithubActionStatus('pending'), true)
    assert.equal(isRunningGithubActionStatus('completed'), false)
    assert.equal(isRunningGithubActionStatus('failure'), false)
  })
})

describe('defaultGithubPagesUrl', () => {
  const repo = parseGithubRemote('git@github.com:oboo/vav.git')!

  it('builds a project site URL', () => {
    assert.equal(defaultGithubPagesUrl(repo), 'https://oboo.github.io/vav/')
  })

  it('uses the user-site host for owner.github.io', () => {
    const user = parseGithubRemote('https://github.com/oboo/oboo.github.io.git')!
    assert.equal(defaultGithubPagesUrl(user), 'https://oboo.github.io/')
  })

  it('skips enterprise hosts', () => {
    const ghe = parseGithubRemote('git@github.company.com:org/app.git')!
    assert.equal(defaultGithubPagesUrl(ghe), null)
  })
})

describe('mapGithubSite', () => {
  const repo = parseGithubRemote('git@github.com:oboo/vav.git')!

  it('maps Pages workflow settings instead of treating the site as a URL visit', () => {
    const site = mapGithubSite({
      repo,
      homepage: 'https://example.com',
      hasPages: true,
      pages: {
        html_url: 'https://docs.example.com',
        status: 'built',
        build_type: 'workflow',
        cname: 'docs.example.com',
        https_enforced: true,
        protected_domain_state: 'verified',
        custom_404: false,
        public: true,
        source: { branch: 'main', path: '/' }
      },
      latestBuild: {
        status: 'built',
        commit: '351391cdcb88ffae71ec3028c91f375a8036a26b',
        duration: 2104,
        created_at: '2026-08-10T14:58:30Z',
        pusher: { login: 'octocat' },
        error: { message: null }
      },
      authenticated: true
    })
    assert.equal(site.hasPages, true)
    assert.equal(site.kind, 'pages')
    assert.equal(site.url, 'https://docs.example.com')
    assert.equal(site.buildType, 'workflow')
    assert.equal(site.cname, 'docs.example.com')
    assert.equal(site.httpsEnforced, true)
    assert.equal(site.protectedDomainState, 'verified')
    assert.equal(site.public, true)
    assert.deepEqual(site.source, { branch: 'main', path: '/' })
    assert.equal(site.settingsUrl, 'https://github.com/oboo/vav/settings/pages')
    assert.equal(site.latestBuild?.commit, '351391cdcb88ffae71ec3028c91f375a8036a26b')
    assert.equal(site.latestBuild?.pusher, 'octocat')
    assert.equal(site.homepage, 'https://example.com')
  })

  it('maps a branch-deploy source path', () => {
    const site = mapGithubSite({
      repo,
      homepage: null,
      hasPages: true,
      pages: {
        html_url: 'https://oboo.github.io/vav/',
        status: 'building',
        build_type: 'legacy',
        source: { branch: 'gh-pages', path: '/docs' }
      },
      latestBuild: null,
      authenticated: true
    })
    assert.equal(site.buildType, 'legacy')
    assert.deepEqual(site.source, { branch: 'gh-pages', path: '/docs' })
    assert.equal(site.pagesStatus, 'building')
  })

  it('keeps About homepage when Pages is off', () => {
    const site = mapGithubSite({
      repo,
      homepage: 'https://vav.app',
      hasPages: false,
      pages: null,
      latestBuild: null,
      authenticated: true
    })
    assert.equal(site.hasPages, false)
    assert.equal(site.kind, 'homepage')
    assert.equal(site.url, null)
    assert.equal(site.homepage, 'https://vav.app')
    assert.equal(site.settingsUrl, githubPagesSettingsUrl(repo))
  })

  it('falls back to the project Pages URL when has_pages is set but the Pages API is hidden', () => {
    const site = mapGithubSite({
      repo,
      homepage: null,
      hasPages: true,
      pages: null,
      latestBuild: null,
      authenticated: false
    })
    assert.equal(site.hasPages, true)
    assert.equal(site.kind, 'pages')
    assert.equal(site.url, 'https://oboo.github.io/vav/')
  })

  it('treats workflow Pages with a null status and custom domain as live', () => {
    const site = mapGithubSite({
      repo: parseGithubRemote('https://github.com/21stware/vav.git')!,
      homepage: 'https://vavapp.com',
      hasPages: true,
      pages: {
        status: null,
        cname: 'vavapp.com',
        html_url: 'http://vavapp.com/',
        build_type: 'workflow',
        source: { branch: 'main', path: '/' },
        public: true,
        https_enforced: false
      },
      latestBuild: [
        {
          sha: '238a01b5f3791e62848623a04032882fc32743d5',
          created_at: '2026-08-08T02:02:26Z',
          updated_at: '2026-08-08T02:02:48Z',
          creator: { login: 'Obooman' }
        }
      ],
      authenticated: true
    })
    assert.equal(site.hasPages, true)
    assert.equal(site.kind, 'pages')
    assert.equal(site.url, 'http://vavapp.com/')
    assert.equal(site.cname, 'vavapp.com')
    assert.equal(site.pagesStatus, 'built')
    assert.equal(site.buildType, 'workflow')
    assert.equal(site.latestBuild?.pusher, 'Obooman')
    assert.equal(site.latestBuild?.commit, '238a01b5f3791e62848623a04032882fc32743d5')
    assert.equal(isGithubPagesLive(site), true)
  })

  it('still counts a Pages kind without hasPages as live (older payloads)', () => {
    assert.equal(
      isGithubPagesLive({ hasPages: false, kind: 'pages', url: 'http://vavapp.com/' }),
      true
    )
  })

  it('fills custom domain and HTTPS from a live URL when Pages fields are missing', () => {
    const repo = parseGithubRemote('https://github.com/21stware/vav.git')!
    const sparse = mapGithubSite({
      repo,
      homepage: 'https://vavapp.com',
      hasPages: true,
      pages: null,
      latestBuild: null,
      authenticated: true
    })
    const filled = fillGithubSiteGaps(
      { ...sparse, url: 'http://vavapp.com/' },
      { cname: 'vavapp.com', workflow: true }
    )
    assert.equal(githubPagesCustomDomain(filled), 'vavapp.com')
    assert.equal(filled.buildType, 'workflow')
    assert.equal(filled.httpsEnforced, false)
    assert.equal(filled.cname, 'vavapp.com')
  })
})

describe('mergePullConversation', () => {
  const author = { login: 'devin-ai-integration[bot]', avatarUrl: null }

  it('nests inline bot findings under the parent review', () => {
    const reviews = [
      {
        id: 1,
        author,
        state: 'commented' as const,
        body: 'Devin Review found 2 potential issues.',
        submittedAt: '2026-08-10T14:25:28Z'
      },
      {
        id: 2,
        author,
        state: 'commented' as const,
        body: null,
        submittedAt: '2026-08-10T15:14:45Z'
      }
    ]
    const reviewComments = [
      {
        id: 10,
        author,
        body: 'Unbounded progressive fill',
        createdAt: '2026-08-10T14:25:29Z',
        path: 'a.tsx',
        line: 83,
        reviewId: 1
      },
      {
        id: 11,
        author,
        body: 'Database stays locked',
        createdAt: '2026-08-10T15:14:46Z',
        path: 'b.ts',
        line: 119,
        reviewId: 2
      }
    ]
    const items = mergePullConversation([], reviews, reviewComments)
    assert.equal(items.length, 2)
    assert.equal(items[0]?.kind, 'review')
    assert.equal(items[1]?.kind, 'review')
    if (items[0]?.kind !== 'review' || items[1]?.kind !== 'review') return
    assert.equal(items[0].comments.length, 1)
    assert.equal(items[1].comments.length, 1)
    assert.equal(items[0].comments[0]?.body, 'Unbounded progressive fill')
  })

  it('keeps issue-comment bots in the timeline', () => {
    const comments = [
      {
        id: 3,
        author: { login: 'originai-review[bot]', avatarUrl: null },
        body: '## OriginAI Review — 5 findings',
        createdAt: '2026-08-10T14:48:59Z',
        path: null,
        line: null,
        reviewId: null
      }
    ]
    const items = mergePullConversation(comments, [], [])
    assert.equal(items.length, 1)
    assert.equal(items[0]?.kind, 'comment')
    if (items[0]?.kind !== 'comment') return
    assert.equal(items[0].comment.author.login, 'originai-review[bot]')
  })

  it('drops empty commented reviews that have no inline threads', () => {
    const items = mergePullConversation(
      [],
      [
        {
          id: 9,
          author,
          state: 'commented',
          body: null,
          submittedAt: '2026-08-10T15:14:48Z'
        }
      ],
      []
    )
    assert.equal(items.length, 0)
  })
})
