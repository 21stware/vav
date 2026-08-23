import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../store/AccountStore.ts'
import type { HostCredentialAdapter, HostCredentialSnapshot } from './credentials/adapter.ts'
import { activateAccount } from './activateAccount.ts'

function snap(identity: string, payload: string, expiresAtMs: number | null = null): HostCredentialSnapshot {
  return { payload, medium: 'file', identity, expiresAtMs, capturedAt: Date.now() }
}

describe('activateAccount', () => {
  let dir: string
  let accounts: AccountStore
  const vault = new Map<string, HostCredentialSnapshot>()
  const secrets = {
    getOAuthSnapshot: (id: string) => vault.get(id) ?? null,
    setOAuthSnapshot: (id: string, snapshot: HostCredentialSnapshot) => {
      vault.set(id, snapshot)
    }
  }
  const calls: string[] = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vav-activate-'))
    accounts = new AccountStore(dir)
    vault.clear()
    calls.length = 0
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function addOAuth(name: string, current = false) {
    const row = accounts.add({
      workspaceKey: '/ws',
      agentId: 'grok',
      provider: 'custom',
      kind: 'oauth',
      name,
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: current ? 'ok' : 'unknown',
      oauthHost: 'grok',
      current
    })
    return row
  }

  function mockAdapter(live: { identity: string | null; payload: string }): HostCredentialAdapter {
    let slot = { ...live }
    return {
      host: 'grok',
      swappable: true,
      async capture() {
        calls.push(`capture:${slot.identity}`)
        if (!slot.payload) return null
        return snap(slot.identity ?? 'unknown', slot.payload)
      },
      async restore(snapshot) {
        calls.push(`restore:${snapshot.identity}`)
        slot = { identity: snapshot.identity, payload: snapshot.payload }
      },
      async liveIdentity() {
        return slot.identity
      }
    }
  }

  it('switches by restoring a snapshot after capturing the live sibling', async () => {
    const ada = addOAuth('ada@x.ai', true)
    const bob = addOAuth('bob@x.ai', false)
    vault.set(bob.id, snap('bob@x.ai', 'BOB'))
    const adapter = mockAdapter({ identity: 'ada@x.ai', payload: 'ADA' })
    const result = await activateAccount({
      accountId: bob.id,
      accounts,
      secrets,
      adapterFor: () => adapter
    })
    assert.equal(result.kind, 'switched')
    assert.deepEqual(calls, ['capture:ada@x.ai', 'restore:bob@x.ai'])
    assert.equal(vault.get(ada.id)?.payload, 'ADA')
    assert.equal(accounts.get(ada.id)?.hasCredentialSnapshot, true)
    assert.equal(accounts.get(bob.id)?.keyStatus, 'ok')
  })

  it('returns alreadyLive when the slot already belongs to the account', async () => {
    const ada = addOAuth('ada@x.ai', true)
    const result = await activateAccount({
      accountId: ada.id,
      accounts,
      secrets,
      adapterFor: () => mockAdapter({ identity: 'ada@x.ai', payload: 'ADA' })
    })
    assert.equal(result.kind, 'alreadyLive')
    assert.deepEqual(calls, [])
  })

  it('returns needsReauth without a snapshot', async () => {
    const bob = addOAuth('bob@x.ai')
    const result = await activateAccount({
      accountId: bob.id,
      accounts,
      secrets,
      adapterFor: () => mockAdapter({ identity: 'ada@x.ai', payload: 'ADA' })
    })
    assert.equal(result.kind, 'needsReauth')
  })

  it('returns needsRefresh when the snapshot is expired', async () => {
    const bob = addOAuth('bob@x.ai')
    vault.set(bob.id, snap('bob@x.ai', 'BOB', Date.now() - 1000))
    const result = await activateAccount({
      accountId: bob.id,
      accounts,
      secrets,
      adapterFor: () => mockAdapter({ identity: 'ada@x.ai', payload: 'ADA' }),
      now: Date.now()
    })
    assert.equal(result.kind, 'needsRefresh')
  })

  it('returns needsReauth when the host is not swappable', async () => {
    const bob = addOAuth('bob@x.ai')
    vault.set(bob.id, snap('bob@x.ai', 'BOB'))
    const result = await activateAccount({
      accountId: bob.id,
      accounts,
      secrets,
      adapterFor: () => ({
        host: 'devin',
        swappable: false,
        capture: async () => null,
        restore: async () => undefined,
        liveIdentity: async () => null
      })
    })
    assert.equal(result.kind, 'needsReauth')
  })
})
