import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  APP_SPLIT_MIN_WIDTH,
  APPLICATIONS_WIDTH_MIN,
  appSplitLayout,
  applicationsModeForConversation,
  applicationsWidthBudget,
  clampApplicationsWidth
} from './applicationsWidth.ts'

describe('appSplitLayout', () => {
  it('stacks below the tablet split threshold and splits at or above it', () => {
    assert.equal(appSplitLayout(APP_SPLIT_MIN_WIDTH - 1), 'stack')
    assert.equal(appSplitLayout(380), 'stack')
    assert.equal(appSplitLayout(APP_SPLIT_MIN_WIDTH), 'split')
    assert.equal(appSplitLayout(720), 'split')
  })
})

describe('clampApplicationsWidth', () => {
  it('floors at the app-column min and has no hardcoded ceiling', () => {
    assert.equal(clampApplicationsWidth(120), APPLICATIONS_WIDTH_MIN)
    assert.equal(clampApplicationsWidth(1400), 1400)
  })

  it('honors a live split budget', () => {
    assert.equal(clampApplicationsWidth(1400, 900), 900)
  })
})

describe('applicationsWidthBudget', () => {
  it('gives the app only the leftover after the agent floor', () => {
    assert.equal(applicationsWidthBudget(800), 400)
    assert.equal(applicationsWidthBudget(980), 580)
  })

  it('never drops the app below its own floor', () => {
    assert.equal(applicationsWidthBudget(600), APPLICATIONS_WIDTH_MIN)
  })
})

describe('applicationsModeForConversation', () => {
  it('keeps schedule definitions in the app and fired runs out of it', () => {
    assert.equal(applicationsModeForConversation({ sessionKind: 'timer' }), 'scheduled')
    assert.equal(
      applicationsModeForConversation({ sessionKind: 'timer', timerRunId: 'r1' }),
      null
    )
  })
})
