import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { GithubReview } from '../../../shared/github.ts'
import {
  githubActionStateClass,
  githubPullStateClass,
  latestReviewByUser,
  sameSiteHost
} from './githubPanelState.ts'

function review(id: number, login: string, state: GithubReview['state'], body = 'ok'): GithubReview {
  return {
    id,
    author: { login, avatarUrl: '' },
    state,
    body,
    submittedAt: String(id)
  }
}

describe('githubPanelState', () => {
  it('maps pull and action statuses onto list row classes', () => {
    assert.equal(githubPullStateClass('merged', false), 'is-merged')
    assert.equal(githubPullStateClass('closed', false), 'is-closed')
    assert.equal(githubPullStateClass('open', true), 'is-draft')
    assert.equal(githubPullStateClass('open', false), 'is-open')
    assert.equal(githubActionStateClass('in_progress'), 'is-open')
    assert.equal(githubActionStateClass('completed'), 'is-merged')
    assert.equal(githubActionStateClass('queued'), 'is-draft')
  })

  it('keeps the latest review per author and skips empty comments', () => {
    const rows = latestReviewByUser([
      review(1, 'a', 'commented', ''),
      review(2, 'a', 'approved'),
      review(3, 'b', 'commented', 'nits')
    ])
    assert.deepEqual(
      rows.map((row) => `${row.author.login}:${row.state}`),
      ['a:approved', 'b:commented']
    )
  })

  it('compares GitHub Pages hosts ignoring scheme and www', () => {
    assert.equal(sameSiteHost('https://www.example.com', 'example.com', null), true)
    assert.equal(sameSiteHost('https://example.com', null, 'other.com'), false)
    assert.equal(sameSiteHost(null, 'example.com', 'example.com'), false)
  })
})
