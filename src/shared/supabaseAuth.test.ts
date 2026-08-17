import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { looksLikeSupabaseAccessToken, supabaseAccessTokenFileCandidates } from './supabaseAuth.ts'

describe('supabaseAccessTokenFileCandidates', () => {
  it('prefers explicit file and SUPABASE_HOME, then XDG, then ~/.supabase', () => {
    const files = supabaseAccessTokenFileCandidates('/Users/ada', {
      SUPABASE_ACCESS_TOKEN_FILE: '/secret/token',
      SUPABASE_HOME: '/opt/supabase',
      XDG_CONFIG_HOME: '/Users/ada/.xdg'
    })
    assert.deepEqual(files, [
      '/secret/token',
      '/opt/supabase/access-token',
      '/Users/ada/.xdg/supabase/access-token',
      '/Users/ada/.supabase/access-token'
    ])
  })

  it('defaults XDG to ~/.config', () => {
    const files = supabaseAccessTokenFileCandidates('/Users/ada', {})
    assert.deepEqual(files, [
      '/Users/ada/.config/supabase/access-token',
      '/Users/ada/.supabase/access-token'
    ])
  })
})

describe('looksLikeSupabaseAccessToken', () => {
  it('accepts personal access tokens and rejects CLI chatter', () => {
    assert.equal(looksLikeSupabaseAccessToken('sbp_abcdefghijklmnopqrstuvwxyz012345'), true)
    assert.equal(looksLikeSupabaseAccessToken('Access token not provided'), false)
    assert.equal(looksLikeSupabaseAccessToken('short'), false)
  })
})
