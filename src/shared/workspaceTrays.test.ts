import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isGithubTrayEnabled } from './workspaceTrays.ts'

describe('workspace status trays', () => {
  it('shows GitHub unless explicitly turned off (already shipped)', () => {
    assert.equal(isGithubTrayEnabled({}), true)
    assert.equal(isGithubTrayEnabled({ githubTrayEnabled: true }), true)
    assert.equal(isGithubTrayEnabled({ githubTrayEnabled: false }), false)
  })
})
