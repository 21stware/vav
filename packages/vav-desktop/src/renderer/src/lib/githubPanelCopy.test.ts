import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { actionStatusLabel, emptyForCode, pagesStatusLabel, reviewStateLabel } from './githubPanelCopy.ts'

const t = (key: string): string => key

describe('githubPanelCopy', () => {
  it('maps GitHub error codes onto empty-state copy', () => {
    assert.deepEqual(emptyForCode('not-github', 'x', t), {
      title: 'github.notGithub',
      description: 'github.notGithubDesc'
    })
    assert.deepEqual(emptyForCode('no-remote', 'x', t), {
      title: 'github.notGithub',
      description: 'github.notGithubDesc'
    })
    assert.deepEqual(emptyForCode('auth', 'x', t), {
      title: 'github.needAuth',
      description: 'github.needAuthDesc'
    })
    assert.deepEqual(emptyForCode('rate-limit', 'x', t), {
      title: 'github.rateLimit',
      description: 'github.rateLimitDesc'
    })
    assert.deepEqual(emptyForCode('not-found', 'x', t), {
      title: 'github.notFound',
      description: 'github.notFoundDesc'
    })
    assert.deepEqual(emptyForCode('network', 'x', t), {
      title: 'github.loadFailed',
      description: 'github.networkDesc'
    })
    assert.deepEqual(emptyForCode(undefined, 'offline', t), {
      title: 'github.loadFailed',
      description: 'offline'
    })
  })

  it('labels action and Pages statuses', () => {
    assert.equal(actionStatusLabel('in_progress', t), 'github.actionInProgress')
    assert.equal(actionStatusLabel('queued', t), 'github.actionQueued')
    assert.equal(actionStatusLabel('waiting', t), 'github.actionWaiting')
    assert.equal(actionStatusLabel('pending', t), 'github.actionPending')
    assert.equal(actionStatusLabel('requested', t), 'github.actionPending')
    assert.equal(actionStatusLabel('completed', t), 'github.actionCompleted')
    assert.equal(pagesStatusLabel('built', t), 'github.siteStatusBuilt')
    assert.equal(pagesStatusLabel('building', t), 'github.siteStatusBuilding')
    assert.equal(pagesStatusLabel('errored', t), 'github.siteStatusErrored')
    assert.equal(pagesStatusLabel(null, t), 'github.siteNone')
    assert.equal(pagesStatusLabel('queued', t), 'queued')
    assert.equal(reviewStateLabel('approved', t), 'github.approved')
    assert.equal(reviewStateLabel('changes_requested', t), 'github.changesRequested')
    assert.equal(reviewStateLabel('dismissed', t), 'github.dismissed')
    assert.equal(reviewStateLabel('commented', t), 'github.commented')
  })
})
