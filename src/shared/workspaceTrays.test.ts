import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isCloudflareTrayEnabled,
  isGithubTrayEnabled,
  isSupabaseTrayEnabled,
  isVercelTrayEnabled
} from './workspaceTrays.ts'

describe('workspace status trays', () => {
  it('shows GitHub unless explicitly turned off (already shipped)', () => {
    assert.equal(isGithubTrayEnabled({}), true)
    assert.equal(isGithubTrayEnabled({ githubTrayEnabled: true }), true)
    assert.equal(isGithubTrayEnabled({ githubTrayEnabled: false }), false)
  })

  it('hides Cloudflare / Supabase / Vercel unless explicitly turned on', () => {
    assert.equal(isCloudflareTrayEnabled({}), false)
    assert.equal(isSupabaseTrayEnabled({}), false)
    assert.equal(isVercelTrayEnabled({}), false)
    assert.equal(isCloudflareTrayEnabled({ cloudflareTrayEnabled: true }), true)
    assert.equal(isSupabaseTrayEnabled({ supabaseTrayEnabled: true }), true)
    assert.equal(isVercelTrayEnabled({ vercelTrayEnabled: true }), true)
    assert.equal(isCloudflareTrayEnabled({ cloudflareTrayEnabled: false }), false)
  })
})
