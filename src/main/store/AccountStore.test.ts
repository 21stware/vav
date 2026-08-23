import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from './AccountStore.ts'
import { DEFAULT_WORKSPACE_KEY, WORKSPACE_ACCOUNT_NAME } from '../../shared/accounts.ts'

describe('AccountStore', () => {
  let dir: string
  let store: AccountStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vav-accounts-'))
    store = new AccountStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('seeds one workspace VAV account when a key exists', () => {
    const first = store.seedIfNeeded({
      workspaceKey: '/proj',
      endpoint: 'https://api.anthropic.com',
      hasApiKey: true
    })
    assert.ok(first)
    assert.equal(first?.name, WORKSPACE_ACCOUNT_NAME)
    assert.equal(first?.current, true)
    assert.equal(first?.usesLegacyApiKey, true)
    const again = store.seedIfNeeded({
      workspaceKey: '/proj',
      endpoint: 'https://api.deepseek.com',
      hasApiKey: true
    })
    assert.equal(again?.id, first?.id)
    assert.equal(again?.endpoint, 'https://api.anthropic.com')
  })

  it('does not seed without a key', () => {
    assert.equal(
      store.seedIfNeeded({ workspaceKey: '/proj', endpoint: null, hasApiKey: false }),
      null
    )
  })

  it('isolates accounts by workspace and switches current', () => {
    const seed = store.seedIfNeeded({ workspaceKey: '/a', endpoint: null, hasApiKey: true })
    const extra = store.add({
      workspaceKey: '/a',
      agentId: 'vav',
      provider: 'vav',
      kind: 'vav_key',
      name: 'DeepSeek',
      endpoint: 'https://api.deepseek.com',
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'unknown',
      oauthHost: null
    })
    assert.equal(seed?.name, WORKSPACE_ACCOUNT_NAME)
    store.setCurrent(extra.id)
    assert.equal(store.currentVav('/a')?.id, extra.id)
    assert.equal(store.list('/b').length, 0)
  })

  it('falls current back to the first remaining VAV account on delete', () => {
    const seed = store.seedIfNeeded({
      workspaceKey: '/a',
      endpoint: null,
      hasApiKey: true
    })
    const extra = store.add({
      workspaceKey: '/a',
      agentId: 'vav',
      provider: 'vav',
      kind: 'vav_key',
      name: 'Other',
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'unknown',
      oauthHost: null
    })
    store.setCurrent(extra.id)
    const result = store.remove(extra.id)
    assert.equal(result?.nextCurrentId, seed?.id)
    assert.equal(store.currentVav('/a')?.id, seed?.id)
  })

  it('records monthly usage against an account', () => {
    const seed = store.seedIfNeeded({
      workspaceKey: '/a',
      endpoint: null,
      hasApiKey: true
    })
    assert.ok(seed)
    store.recordUsage(
      seed.id,
      { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.1 },
      new Date(2026, 7, 10).getTime()
    )
    const month = store.usage()[seed.id]?.['2026-08']
    assert.equal(month?.inputTokens, 10)
    assert.equal(month?.outputTokens, 5)
  })

  it('rebuilds monthly usage from session snapshots', () => {
    const seed = store.seedIfNeeded({
      workspaceKey: '/a',
      endpoint: null,
      hasApiKey: true
    })
    assert.ok(seed)
    store.recordUsage(seed.id, { inputTokens: 999, outputTokens: 999 }, new Date(2026, 7, 1).getTime())
    store.replaceUsageFromSnapshots([
      {
        accountId: seed.id,
        timestamp: new Date(2026, 7, 10).getTime(),
        newInputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.2
      },
      {
        accountId: seed.id,
        timestamp: new Date(2026, 7, 11).getTime(),
        newInputTokens: 3,
        outputTokens: 1,
        estimatedCost: 0.1
      }
    ])
    const month = store.usage()[seed.id]?.['2026-08']
    assert.equal(month?.inputTokens, 13)
    assert.equal(month?.outputTokens, 6)
    assert.ok(Math.abs((month?.estimatedCostUsd ?? 0) - 0.3) < 1e-9)
  })

  it('oauth upsert updates the targeted draft, not the first profile', () => {
    const first = store.upsertOAuth({
      workspaceKey: '/a',
      agentId: 'grok',
      provider: 'custom',
      name: 'old@x.ai',
      oauthHost: 'grok',
      signedIn: true
    })
    const draft = store.add({
      workspaceKey: '/a',
      agentId: 'grok',
      provider: 'custom',
      kind: 'oauth',
      name: '账户 2',
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'unknown',
      oauthHost: 'grok'
    })
    const next = store.upsertOAuth({
      id: draft.id,
      workspaceKey: '/a',
      agentId: 'grok',
      provider: 'custom',
      name: 'new@x.ai',
      oauthHost: 'grok',
      signedIn: true
    })
    assert.equal(next.id, draft.id)
    assert.equal(store.get(first.id)?.name, 'old@x.ai')
    assert.equal(store.get(first.id)?.keyStatus, 'unknown')
    assert.equal(store.get(first.id)?.oauthExpired, false)
    assert.equal(store.get(draft.id)?.name, 'new@x.ai')
    assert.equal(store.get(draft.id)?.keyStatus, 'ok')
    assert.equal(store.list('/a').filter((row) => row.agentId === 'grok').length, 2)
  })

  it('signs in only the live OAuth identity across workspaces', () => {
    const first = store.upsertOAuth({
      workspaceKey: '/a',
      agentId: 'cursor',
      provider: 'custom',
      name: 'one@cursor.com',
      oauthHost: 'cursor',
      signedIn: true
    })
    store.upsertOAuth({
      workspaceKey: '/b',
      agentId: 'cursor',
      provider: 'custom',
      name: 'two@cursor.com',
      oauthHost: 'cursor',
      signedIn: true
    })
    assert.equal(store.get(first.id)?.keyStatus, 'unknown')
    const live = store.applyLiveOAuth('cursor', 'one@cursor.com', true)
    assert.equal(live?.id, first.id)
    assert.equal(store.get(first.id)?.keyStatus, 'ok')
    assert.equal(
      store.list('/b').find((row) => row.agentId === 'cursor')?.keyStatus,
      'unknown'
    )
    store.applyLiveOAuth('cursor', null, false)
    assert.equal(store.get(first.id)?.keyStatus, 'unknown')
    assert.equal(store.get(first.id)?.oauthExpired, true)
  })

  it('does not steal current from an explicit signed-out profile', () => {
    const signedOut = store.add({
      workspaceKey: '/a',
      agentId: 'cursor',
      provider: 'custom',
      kind: 'oauth',
      name: 'cheng.12@live.cn',
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'unknown',
      oauthHost: 'cursor',
      current: true
    })
    store.add({
      workspaceKey: '/a',
      agentId: 'cursor',
      provider: 'custom',
      kind: 'oauth',
      name: 'oboochin@gmail.com',
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'ok',
      oauthHost: 'cursor'
    })
    store.setCurrent(signedOut.id)
    store.promoteLiveOAuthCurrent('/a', 'cursor', 'oboochin@gmail.com')
    assert.equal(store.get(signedOut.id)?.current, true)
  })

  it('clears current in the viewing workspace when switching a foreign OAuth row', () => {
    const local = store.add({
      workspaceKey: '/now',
      agentId: 'cursor',
      provider: 'custom',
      kind: 'oauth',
      name: 'cheng.12@live.cn',
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'unknown',
      oauthHost: 'cursor',
      current: true
    })
    const foreign = store.upsertOAuth({
      workspaceKey: '/old',
      agentId: 'cursor',
      provider: 'custom',
      name: 'oboochin@gmail.com',
      oauthHost: 'cursor',
      signedIn: true
    })
    store.setCurrent(foreign.id, '/now')
    assert.equal(store.get(foreign.id)?.current, true)
    assert.equal(store.get(local.id)?.current, false)
  })

  it('does not rename a signed-in sibling when a new identity appears', () => {
    const first = store.upsertOAuth({
      workspaceKey: '/a',
      agentId: 'cursor',
      provider: 'custom',
      name: 'old@cursor.com',
      oauthHost: 'cursor',
      signedIn: true
    })
    const created = store.upsertOAuth({
      workspaceKey: '/a',
      agentId: 'cursor',
      provider: 'custom',
      name: 'new@cursor.com',
      oauthHost: 'cursor',
      signedIn: true
    })
    assert.notEqual(created.id, first.id)
    assert.equal(store.get(first.id)?.name, 'old@cursor.com')
    assert.equal(store.get(first.id)?.keyStatus, 'unknown')
    assert.equal(store.get(first.id)?.oauthExpired, false)
    assert.equal(created.name, 'new@cursor.com')
    assert.equal(created.keyStatus, 'ok')
  })

  it('does not rename a targeted real identity when a different email signs in', () => {
    const first = store.upsertOAuth({
      workspaceKey: '/a',
      agentId: 'cursor',
      provider: 'custom',
      name: 'old@cursor.com',
      oauthHost: 'cursor',
      signedIn: true
    })
    const created = store.upsertOAuth({
      id: first.id,
      workspaceKey: '/a',
      agentId: 'cursor',
      provider: 'custom',
      name: 'new@cursor.com',
      oauthHost: 'cursor',
      signedIn: true
    })
    assert.notEqual(created.id, first.id)
    assert.equal(store.get(first.id)?.name, 'old@cursor.com')
    assert.equal(store.get(first.id)?.keyStatus, 'unknown')
    assert.equal(created.name, 'new@cursor.com')
    assert.equal(created.keyStatus, 'ok')
    assert.equal(store.list('/a').filter((row) => row.agentId === 'cursor').length, 2)
  })

  it('absorbs a draft that logs in as an identity that already exists', () => {
    const first = store.upsertOAuth({
      workspaceKey: '/a',
      agentId: 'grok',
      provider: 'custom',
      name: 'resource1@noroff.no',
      oauthHost: 'grok',
      signedIn: true
    })
    const draft = store.add({
      workspaceKey: '/a',
      agentId: 'grok',
      provider: 'custom',
      kind: 'oauth',
      name: '账户 2',
      endpoint: null,
      usesLegacyApiKey: false,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'unknown',
      oauthHost: 'grok'
    })
    store.recordUsage(draft.id, { inputTokens: 4 }, new Date(2026, 7, 10).getTime())
    const next = store.upsertOAuth({
      id: draft.id,
      workspaceKey: '/a',
      agentId: 'grok',
      provider: 'custom',
      name: 'resource1@noroff.no',
      oauthHost: 'grok',
      signedIn: true
    })
    assert.equal(next.id, first.id)
    assert.equal(store.list('/a').filter((row) => row.agentId === 'grok').length, 1)
    assert.equal(store.get(draft.id), undefined)
    assert.equal(store.usage()[first.id]?.['2026-08']?.inputTokens, 4)
  })

  it('reuses the app VAV account instead of seeding each temp workspace', () => {
    const first = store.seedIfNeeded({
      workspaceKey: '/var/folders/x/T/vav/abcd1234/Workspace',
      endpoint: 'https://api.deepseek.com',
      hasApiKey: true
    })
    const again = store.seedIfNeeded({
      workspaceKey: '/var/folders/x/T/vav/ffff9999/Workspace',
      endpoint: 'https://openrouter.ai/api',
      hasApiKey: true
    })
    assert.equal(again?.id, first?.id)
    assert.equal(first?.workspaceKey, DEFAULT_WORKSPACE_KEY)
    assert.equal(first?.endpoint, 'https://api.deepseek.com')
    assert.equal(store.listVisible('/now').filter((row) => row.agentId === 'vav').length, 1)
  })

  it('lists signed-in OAuth from other workspaces', () => {
    store.seedIfNeeded({ workspaceKey: '/now', endpoint: null, hasApiKey: true })
    store.upsertOAuth({
      workspaceKey: '/old',
      agentId: 'grok',
      provider: 'custom',
      name: 'user@x.ai',
      oauthHost: 'grok',
      signedIn: true
    })
    assert.equal(store.list('/now').filter((row) => row.agentId === 'grok').length, 0)
    const visible = store.listVisible('/now')
    assert.ok(visible.some((row) => row.agentId === 'grok' && row.name === 'user@x.ai'))
    assert.equal(visible.filter((row) => row.agentId === 'vav').length, 1)
  })
})
