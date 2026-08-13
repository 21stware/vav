import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { githubApiBase, mergePullConversation, parseGithubRemote } from './github.ts'

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
