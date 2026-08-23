import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { makeKeychainAdapter } from './keychainAdapter.ts'
import {
  accessTokenFromSnapshot,
  parseClaudeKeychainMeta,
  parseCursorKeychainMeta
} from './parseKeychainSnapshot.ts'

function jwt(claims: Record<string, unknown>): string {
  const json = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `aaa.${json}.sig`
}

describe('keychain credential adapter', () => {
  it('captures and restores the Cursor slot through an injected security runner', async () => {
    const token = jwt({ email: 'ada@cursor.com', exp: 4_000_000_000 })
    let slot = token
    const calls: string[][] = []
    const adapter = makeKeychainAdapter({
      host: 'cursor',
      service: () => 'cursor-access-token',
      parseIdentity: (payload) => parseCursorKeychainMeta(payload).identity,
      parseExpiry: (payload) => parseCursorKeychainMeta(payload).expiresAtMs,
      run: async (args) => {
        calls.push(args)
        if (args[0] === 'find-generic-password' && args.includes('-w')) return slot
        if (args[0] === 'find-generic-password') return '"acct"<blob>="cursor-user"\n'
        if (args[0] === 'add-generic-password') {
          slot = args[args.indexOf('-w') + 1] ?? ''
          return ''
        }
        throw new Error(`unexpected ${args.join(' ')}`)
      }
    })
    const snap = await adapter.capture()
    assert.equal(snap?.medium, 'keychain')
    assert.equal(snap?.identity, 'ada@cursor.com')
    assert.equal(await adapter.liveIdentity(), 'ada@cursor.com')

    const other = jwt({ email: 'bob@cursor.com', exp: 4_000_000_000 })
    slot = other
    await adapter.restore(snap!)
    assert.equal(slot, token)
    assert.equal(await adapter.liveIdentity(), 'ada@cursor.com')
    assert.ok(calls.some((args) => args[0] === 'add-generic-password' && args.includes('-U')))
  })

  it('returns null when the keychain slot is empty', async () => {
    const adapter = makeKeychainAdapter({
      host: 'cursor',
      service: () => 'cursor-access-token',
      parseIdentity: () => null,
      parseExpiry: () => null,
      run: async () => {
        throw new Error('not found')
      }
    })
    assert.equal(await adapter.capture(), null)
    assert.equal(await adapter.liveIdentity(), null)
  })
})

describe('keychain snapshot parse', () => {
  it('reads Cursor JWT email and expiry', () => {
    const meta = parseCursorKeychainMeta(jwt({ email: 'ada@cursor.com', exp: 1_800_000_000 }))
    assert.equal(meta.identity, 'ada@cursor.com')
    assert.equal(meta.expiresAtMs, 1_800_000_000_000)
  })

  it('unwraps host tokens from snapshots', () => {
    assert.equal(
      accessTokenFromSnapshot('cursor', {
        payload: 'tok-live',
        medium: 'keychain',
        identity: 'a@x',
        expiresAtMs: null,
        capturedAt: 1
      }),
      'tok-live'
    )
    assert.equal(
      accessTokenFromSnapshot('claude', {
        payload: JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant' } }),
        medium: 'keychain',
        identity: null,
        expiresAtMs: null,
        capturedAt: 1
      }),
      'sk-ant'
    )
    assert.equal(parseClaudeKeychainMeta(JSON.stringify({ claudeAiOauth: { email: 'a@x.ai' } })).identity, 'a@x.ai')
    assert.equal(
      accessTokenFromSnapshot('codex', {
        payload: JSON.stringify({ tokens: { access_token: 'codex-tok' } }),
        medium: 'file',
        identity: 'acc',
        expiresAtMs: null,
        capturedAt: 1
      }),
      'codex-tok'
    )
  })
})
