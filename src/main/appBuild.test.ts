import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appBuildNumber } from './appBuild.ts'

describe('appBuildNumber', () => {
  it('uses calendar day and the version patch', () => {
    assert.equal(appBuildNumber('1.18.6', new Date(2026, 8, 2)), '2026.0902.6')
    assert.equal(appBuildNumber('2.0', new Date(2026, 0, 5)), '2026.0105.0')
  })
})
