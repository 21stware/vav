import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join } from 'node:path'
import { looksLikeSupabaseAccessToken, supabaseAccessTokenFileCandidates } from './supabaseAuth.ts'

describe('supabaseAccessTokenFileCandidates', () => {
  it('prefers explicit file and SUPABASE_HOME, then XDG, then ~/.supabase', () => {
    const home = join('/Users', 'ada')
    const files = supabaseAccessTokenFileCandidates(home, {
      SUPABASE_ACCESS_TOKEN_FILE: join('/secret', 'token'),
      SUPABASE_HOME: join('/opt', 'supabase'),
      XDG_CONFIG_HOME: join(home, '.xdg')
    })
    assert.deepEqual(files, [
      join('/secret', 'token'),
      join('/opt', 'supabase', 'access-token'),
      join(home, '.xdg', 'supabase', 'access-token'),
      join(home, '.supabase', 'access-token')
    ])
  })

  it('defaults XDG to ~/.config', () => {
    const home = join('/Users', 'ada')
    const files = supabaseAccessTokenFileCandidates(home, {})
    assert.deepEqual(files, [
      join(home, '.config', 'supabase', 'access-token'),
      join(home, '.supabase', 'access-token')
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
