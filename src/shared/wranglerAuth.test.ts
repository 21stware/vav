import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join } from 'node:path'
import {
  applyWranglerAuthRefresh,
  parseWranglerAuthToml,
  wranglerAuthFileCandidates,
  wranglerAuthHasToken,
  wranglerOauthExpired
} from './wranglerAuth.ts'

describe('parseWranglerAuthToml', () => {
  it('reads oauth fields from a wrangler login file', () => {
    const parsed = parseWranglerAuthToml(`
oauth_token = "oauth-abc"
expiration_time = "2026-08-17T12:00:00.000Z"
refresh_token = "refresh-xyz"
scopes = [ "account:read" ]
`)
    assert.equal(parsed.oauthToken, 'oauth-abc')
    assert.equal(parsed.refreshToken, 'refresh-xyz')
    assert.equal(parsed.expirationTime, '2026-08-17T12:00:00.000Z')
    assert.equal(parsed.apiToken, null)
    assert.equal(wranglerAuthHasToken(parsed), true)
  })

  it('reads a stored api_token', () => {
    const parsed = parseWranglerAuthToml('api_token = "cf-tok"\n')
    assert.equal(parsed.apiToken, 'cf-tok')
    assert.equal(wranglerAuthHasToken(parsed), true)
  })
})

describe('wranglerOauthExpired', () => {
  it('is expired at or after the timestamp, with a 60s skew', () => {
    const exp = '2026-08-17T12:00:00.000Z'
    const at = Date.parse(exp)
    assert.equal(wranglerOauthExpired(exp, at - 120_000), false)
    assert.equal(wranglerOauthExpired(exp, at - 30_000), true)
    assert.equal(wranglerOauthExpired(exp, at + 1_000), true)
    assert.equal(wranglerOauthExpired(null), false)
  })
})

describe('wranglerAuthFileCandidates', () => {
  it('puts the macOS Preferences path first', () => {
    const home = join('/Users', 'ada')
    const files = wranglerAuthFileCandidates(home, {}, 'darwin')
    assert.ok(
      files[0]?.includes(join('Library', 'Preferences', '.wrangler', 'config', 'default.toml'))
    )
    assert.ok(files.some((f) => f.endsWith(join('.config', '.wrangler', 'config', 'default.toml'))))
    assert.ok(files.some((f) => f.endsWith(join('.wrangler', 'config', 'default.toml'))))
  })

  it('honours WRANGLER_HOME', () => {
    const files = wranglerAuthFileCandidates(
      join('/Users', 'ada'),
      { WRANGLER_HOME: join('/opt', 'wrangler') },
      'darwin'
    )
    assert.equal(files[0], join('/opt', 'wrangler', 'config', 'default.toml'))
  })
})

describe('applyWranglerAuthRefresh', () => {
  it('replaces oauth_token and expiration_time in place', () => {
    const next = applyWranglerAuthRefresh(
      'oauth_token = "old"\nexpiration_time = "old-exp"\nrefresh_token = "old-r"\n',
      {
        oauthToken: 'new-oauth',
        refreshToken: 'new-refresh',
        expirationTime: '2026-08-18T00:00:00.000Z'
      }
    )
    const parsed = parseWranglerAuthToml(next)
    assert.equal(parsed.oauthToken, 'new-oauth')
    assert.equal(parsed.refreshToken, 'new-refresh')
    assert.equal(parsed.expirationTime, '2026-08-18T00:00:00.000Z')
  })
})
