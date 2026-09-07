import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { join } from 'node:path'
import {
  applyVercelAuthRefresh,
  parseVercelAuthJson,
  vercelAuthFileCandidates,
  vercelAuthHasToken,
  vercelCliTokenExpired
} from './vercelAuth.ts'

describe('parseVercelAuthJson', () => {
  it('reads a vercel login session', () => {
    const parsed = parseVercelAuthJson(
      JSON.stringify({
        token: 'vca_abc',
        refreshToken: 'vcr_xyz',
        expiresAt: 1_780_000_000,
        userId: 'uid'
      })
    )
    assert.equal(parsed.token, 'vca_abc')
    assert.equal(parsed.refreshToken, 'vcr_xyz')
    assert.equal(parsed.expiresAt, 1_780_000_000)
    assert.equal(vercelAuthHasToken(parsed), true)
  })

  it('treats a PAT-only file as present', () => {
    const parsed = parseVercelAuthJson(JSON.stringify({ token: 'tok_plain' }))
    assert.equal(parsed.token, 'tok_plain')
    assert.equal(parsed.refreshToken, null)
    assert.equal(parsed.expiresAt, null)
    assert.equal(vercelAuthHasToken(parsed), true)
  })

  it('returns empty on corrupt JSON', () => {
    const parsed = parseVercelAuthJson('not-json')
    assert.equal(parsed.token, null)
    assert.equal(vercelAuthHasToken(parsed), false)
  })
})

describe('vercelCliTokenExpired', () => {
  it('is expired at or after the timestamp, with a 60s skew', () => {
    const expiresAt = 1_780_000_000
    const at = expiresAt * 1000
    assert.equal(vercelCliTokenExpired(expiresAt, at - 120_000), false)
    assert.equal(vercelCliTokenExpired(expiresAt, at - 30_000), true)
    assert.equal(vercelCliTokenExpired(expiresAt, at + 1_000), true)
    assert.equal(vercelCliTokenExpired(null), false)
  })
})

describe('vercelAuthFileCandidates', () => {
  it('puts the macOS Application Support path first', () => {
    const home = join('/Users', 'ada')
    const files = vercelAuthFileCandidates(home, {}, 'darwin')
    assert.equal(files[0], join(home, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'))
    assert.ok(files.some((f) => f.endsWith(join('.local', 'share', 'com.vercel.cli', 'auth.json'))))
    assert.ok(files.some((f) => f.endsWith(join('.vercel', 'auth.json'))))
  })

  it('honours XDG_DATA_HOME on Linux', () => {
    const files = vercelAuthFileCandidates(
      join('/home', 'ada'),
      { XDG_DATA_HOME: join('/opt', 'xdg') },
      'linux'
    )
    assert.equal(files[0], join('/opt', 'xdg', 'com.vercel.cli', 'auth.json'))
  })
})

describe('applyVercelAuthRefresh', () => {
  it('replaces token and expiry in place and keeps other fields', () => {
    const next = applyVercelAuthRefresh(
      JSON.stringify({ token: 'old', refreshToken: 'old-r', expiresAt: 1, userId: 'uid' }),
      { token: 'vca_new', refreshToken: 'vcr_new', expiresAt: 99 }
    )
    const parsed = parseVercelAuthJson(next)
    assert.equal(parsed.token, 'vca_new')
    assert.equal(parsed.refreshToken, 'vcr_new')
    assert.equal(parsed.expiresAt, 99)
    assert.equal(JSON.parse(next).userId, 'uid')
  })
})
