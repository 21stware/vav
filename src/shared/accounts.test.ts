import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCOUNT_NAME_MAX,
  DEFAULT_WORKSPACE_KEY,
  WORKSPACE_ACCOUNT_NAME,
  addUsage,
  catalogGroups,
  createKindForAgent,
  createKindsForAgent,
  nextDraftName,
  pickWorkspaceConversation,
  currentAccountId,
  displayAccountLabel,
  displayAccountName,
  endpointHostOf,
  apiProviderBrand,
  isGenericAccountIdentity,
  isHttpUrl,
  monthResetAt,
  nameConflict,
  nextCurrentAfterDelete,
  normalizeAccountName,
  sessionUsageRowsOf,
  usageRowsOf,
  usageFromSnapshots,
  usageDeltaFromSnapshot,
  usageTone,
  applyExclusiveOAuthSignIn,
  accountRowUsage,
  accountShowsOAuthQuota,
  liveOAuthSibling,
  isLiveOAuthProfile,
  oauthIdentityMatches,
  primaryQuotaPercent,
  resolveAccountsFocus,
  resolveSessionAccountId,
  sessionShowsHostQuota,
  conversationQuotaAuthView,
  visibleAccountsForWorkspace,
  visibleCurrentIds,
  currentVisibleVav,
  isVavProfile,
  isOAuthSyncAgent,
  isEphemeralWorkspaceKey,
  appWorkspaceKey,
  workspaceKeyOf,
  workspaceLabelOf,
  yearMonthOf
} from './accounts.ts'

describe('accounts helpers', () => {
  it('normalizes workspace keys from paths', () => {
    assert.equal(workspaceKeyOf(null), DEFAULT_WORKSPACE_KEY)
    assert.equal(workspaceKeyOf('~'), DEFAULT_WORKSPACE_KEY)
    assert.equal(workspaceKeyOf('/Users/me/acme/'), '/Users/me/acme')
    assert.equal(workspaceLabelOf('/Users/me/acme-project', 'Workspace'), 'acme-project')
    assert.equal(workspaceLabelOf(null, 'Workspace'), 'Workspace')
    assert.equal(
      pickWorkspaceConversation(
        [
          { id: 'new', archived: false },
          { id: 'open', archived: false }
        ],
        'open'
      )?.id,
      'open'
    )
    assert.equal(
      pickWorkspaceConversation(
        [
          { id: 'new', archived: false },
          { id: 'open', archived: true }
        ],
        'open'
      )?.id,
      'new'
    )
    assert.equal(displayAccountName(WORKSPACE_ACCOUNT_NAME, 'Workspace'), 'Workspace')
    assert.equal(displayAccountLabel({ name: WORKSPACE_ACCOUNT_NAME, alias: '工作' }, 'Workspace'), '工作')
    assert.equal(displayAccountLabel({ name: WORKSPACE_ACCOUNT_NAME }, 'Workspace'), 'Workspace')
  })

  it('validates names and http(s) endpoints', () => {
    assert.equal(normalizeAccountName(`  ${'x'.repeat(80)}  `).length, ACCOUNT_NAME_MAX)
    assert.equal(isHttpUrl('https://api.anthropic.com'), true)
    assert.equal(isHttpUrl('ftp://x'), false)
    assert.equal(isHttpUrl('not a url'), false)
    assert.equal(endpointHostOf('https://api.deepseek.com/v1'), 'api.deepseek.com')
    assert.equal(apiProviderBrand('https://api.deepseek.com/anthropic'), 'DeepSeek')
    assert.equal(apiProviderBrand('https://openrouter.ai/api/v1'), 'OpenRouter')
    assert.equal(isGenericAccountIdentity('vav'), true)
    assert.equal(isGenericAccountIdentity('账户'), true)
    assert.equal(isGenericAccountIdentity('Account'), true)
    assert.equal(isGenericAccountIdentity('DeepSeek'), false)
  })

  it('detects same-provider name conflicts', () => {
    const accounts = [
      { id: 'a', agentId: 'vav', name: '工作区' },
      { id: 'b', agentId: 'vav', name: 'DeepSeek 个人' }
    ]
    assert.equal(nameConflict(accounts, 'vav', 'DeepSeek 个人'), true)
    assert.equal(nameConflict(accounts, 'vav', 'DeepSeek 个人', 'b'), false)
    assert.equal(nameConflict(accounts, 'claude', 'DeepSeek 个人'), false)
  })

  it('picks current and fallback after delete', () => {
    const accounts = [
      { id: 'a', agentId: 'vav', current: true, createdAt: 1 },
      { id: 'b', agentId: 'vav', current: false, createdAt: 2 },
      { id: 'c', agentId: 'claude', current: false, createdAt: 3 }
    ]
    assert.equal(currentAccountId(accounts), 'a')
    assert.equal(nextCurrentAfterDelete(accounts, 'a'), 'b')
    assert.equal(nextCurrentAfterDelete(accounts, 'b'), 'a')
  })

  it('groups by the agent catalog and keeps empty OAuth groups', () => {
    const grouped = catalogGroups(
      [
        { id: 'claude', name: 'Claude Code' },
        { id: 'grok', name: 'Grok build' }
      ],
      [
        { agentId: 'vav', createdAt: 2 },
        { agentId: 'vav', createdAt: 1 }
      ]
    )
    assert.deepEqual(
      grouped.map((g) => g.agentId),
      [
        'vav',
        'claude',
        'grok',
        'deepseek',
        'openrouter',
        'openai',
        'anthropic',
        'xai',
        'google',
        'together',
        'siliconflow',
        'bigmodel',
        'kimi',
        'cursor'
      ]
    )
    assert.equal(grouped[0]?.accounts.length, 2)
    assert.equal(grouped[2]?.accounts.length, 0)
    assert.equal(createKindForAgent('vav'), 'key')
    assert.equal(createKindForAgent('claude'), 'key')
    assert.equal(createKindForAgent('codex'), 'key')
    assert.equal(createKindForAgent('grok'), 'oauth')
    assert.equal(createKindForAgent('cursor'), 'oauth')
    assert.equal(createKindForAgent('pi'), 'key')
    assert.equal(isOAuthSyncAgent('claude'), true)
    assert.equal(isOAuthSyncAgent('codex'), true)
    assert.equal(isOAuthSyncAgent('opencode'), true)
    assert.equal(isOAuthSyncAgent('pi'), false)
    assert.deepEqual(createKindsForAgent('vav'), ['key'])
    assert.deepEqual(createKindsForAgent('grok'), ['oauth', 'key'])
    assert.equal(nextDraftName([{ agentId: 'vav', name: 'Workspace' }, { agentId: 'vav', name: 'DeepSeek' }], 'vav', '账户'), '账户 3')
    assert.equal(nextDraftName([], 'vav', '账户'), '账户 1')
    const withSupport = catalogGroups([{ id: 'claude', name: 'Claude Code' }], [])
    assert.ok(withSupport.some((g) => g.agentId === 'cursor'))
    assert.ok(withSupport.some((g) => g.agentId === 'grok'))
    assert.equal(grouped[2]?.oauthDomain, 'x.ai')
    assert.equal(usageTone(18), 'muted')
    assert.equal(usageTone(70), 'warn')
    assert.equal(usageTone(100), 'danger')

    const rows = usageRowsOf(
      [
        { id: 'a', name: WORKSPACE_ACCOUNT_NAME },
        { id: 'b', name: 'DeepSeek' }
      ],
      {
        a: { '2026-08': addUsage(addUsage({
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0
        }, { inputTokens: 80 }), { outputTokens: 20, estimatedCostUsd: 1 }) },
        b: { '2026-08': { inputTokens: 20, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0.2 } }
      },
      '2026-08',
      (account) => displayAccountName(account.name, 'Workspace')
    )
    assert.equal(rows[0]?.name, 'Workspace')
    assert.equal(rows[0]?.tokens, 100)
    assert.equal(rows[1]?.tokens, 25)
    assert.ok(Math.abs((rows[0]?.percent ?? 0) - 80) < 0.01)
  })

  it('splits session snapshots by account', () => {
    const rows = sessionUsageRowsOf(
      [
        { accountId: 'a', newInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        { accountId: 'b', newInputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
        { accountId: 'a', newInputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      ],
      new Map([['a', 'Workspace'], ['b', 'DeepSeek']]),
      'Account'
    )
    assert.equal(rows.length, 2)
    const workspace = rows.find((r) => r.accountId === 'a')
    assert.equal(workspace?.tokens, 25)
    assert.ok(Math.abs((workspace?.percent ?? 0) - (25 / 35) * 100) < 0.01)
  })

  it('computes year-month and next reset', () => {
    assert.equal(yearMonthOf(new Date(2026, 7, 23).getTime()), '2026-08')
    const reset = monthResetAt('2026-08')
    const date = new Date(reset)
    assert.equal(date.getFullYear(), 2026)
    assert.equal(date.getMonth(), 8)
    assert.equal(date.getDate(), 1)
  })

  it('never treats a signed-out profile as having host quota', () => {
    const live = new Map([['cursor', 'oboochin@gmail.com']])
    assert.equal(
      isLiveOAuthProfile(
        { kind: 'oauth', name: 'cheng.12@live.cn', keyStatus: 'ok', agentId: 'cursor' },
        live
      ),
      false
    )
    assert.equal(
      isLiveOAuthProfile(
        { kind: 'oauth', name: 'oboochin@gmail.com', keyStatus: 'unknown', agentId: 'cursor' },
        live
      ),
      true
    )
    assert.equal(
      accountShowsOAuthQuota({
        kind: 'oauth',
        oauthSignedIn: false,
        quotaStatus: 'ready'
      }),
      false
    )
    assert.equal(
      accountShowsOAuthQuota({
        kind: 'oauth',
        oauthSignedIn: false,
        hasCredentialSnapshot: true,
        quotaStatus: 'ready'
      }),
      true
    )
    assert.equal(
      accountRowUsage({
        kind: 'oauth',
        keyStatus: 'unknown',
        oauthSignedIn: false,
        oauthExpired: true,
        quotaPercent: 39,
        quotaStatus: 'ready',
        monthTokens: 0,
        refreshing: false
      })?.kind,
      'signedOut'
    )
    const signedOut = {
      id: 'cheng',
      agentId: 'cursor',
      kind: 'oauth',
      oauthSignedIn: false,
      name: 'cheng.12@live.cn'
    }
    const sibling = {
      id: 'oboo',
      agentId: 'cursor',
      kind: 'oauth',
      oauthSignedIn: true,
      name: 'oboochin@gmail.com'
    }
    assert.equal(liveOAuthSibling([signedOut, sibling], signedOut)?.id, 'oboo')
    assert.equal(liveOAuthSibling([signedOut, sibling], sibling), null)
  })

  it('shows quota percent instead of a stuck syncing chip', () => {
    const signedIn = {
      kind: 'oauth',
      keyStatus: 'ok',
      oauthSignedIn: true,
      quotaPercent: 39,
      quotaStatus: 'ready',
      monthTokens: 0,
      refreshing: false
    }
    assert.deepEqual(accountRowUsage(signedIn), { kind: 'percent', percent: 39, tone: 'muted' })
    assert.deepEqual(accountRowUsage({ ...signedIn, quotaPercent: null, quotaStatus: 'idle' }), null)
    assert.deepEqual(accountRowUsage({ ...signedIn, quotaPercent: null, refreshing: true }), {
      kind: 'syncing',
      tone: 'muted'
    })
    assert.deepEqual(accountRowUsage({ ...signedIn, oauthSignedIn: false, quotaPercent: null }), null)
    assert.deepEqual(
      accountRowUsage({ ...signedIn, oauthSignedIn: false, oauthExpired: true, quotaPercent: null }),
      { kind: 'signedOut', tone: 'muted' }
    )
    assert.deepEqual(
      accountRowUsage({
        kind: 'vav_key',
        keyStatus: 'ok',
        oauthSignedIn: false,
        quotaPercent: null,
        quotaStatus: 'none',
        monthTokens: 0,
        refreshing: false,
        balance: { amount: 12.5, currency: 'USD', available: true }
      }),
      { kind: 'balance', amount: 12.5, currency: 'USD', available: true, tone: 'muted' }
    )
  })

  it('treats CLI login as one live OAuth identity per host', () => {
    assert.equal(oauthIdentityMatches('Ada@x.ai', 'ada@x.ai'), true)
    assert.equal(oauthIdentityMatches('账户 2', 'ada@x.ai'), false)
    const rows = applyExclusiveOAuthSignIn(
      [
        { kind: 'oauth', name: 'old@x.ai', keyStatus: 'ok' as const, agentId: 'cursor' },
        { kind: 'oauth', name: 'ada@x.ai', keyStatus: 'ok' as const, agentId: 'cursor' },
        { kind: 'oauth', name: 'you@x.ai', keyStatus: 'ok' as const, agentId: 'grok' },
        { kind: 'vav_key', name: 'Workspace', keyStatus: 'ok' as const, agentId: 'vav' }
      ],
      'cursor',
      'ada@x.ai',
      true
    )
    assert.equal(rows[0]?.keyStatus, 'unknown')
    assert.equal(rows[0]?.oauthExpired, false)
    assert.equal(rows[1]?.keyStatus, 'ok')
    assert.equal(rows[1]?.oauthExpired, false)
    assert.equal(rows[2]?.keyStatus, 'ok')
    const signedOut = applyExclusiveOAuthSignIn(rows, 'cursor', null, false)
    assert.equal(signedOut[1]?.oauthExpired, true)
    assert.equal(signedOut[0]?.oauthExpired, false)
    const kept = applyExclusiveOAuthSignIn(
      [{ kind: 'oauth' as const, name: 'ada@x.ai', keyStatus: 'ok' as const, agentId: 'grok', hasCredentialSnapshot: true }],
      'grok',
      null,
      false
    )
    assert.equal(kept[0]?.oauthExpired, false)
    assert.equal(kept[0]?.keyStatus, 'unknown')
    const live = new Map([['cursor', 'ada@x.ai']])
    assert.equal(isLiveOAuthProfile(rows[1]!, live), true)
    assert.equal(isLiveOAuthProfile(rows[0]!, live), false)
    assert.equal(
      resolveSessionAccountId(
        [
          { id: 'c1', kind: 'oauth', keyStatus: 'unknown', current: true, agentId: 'cursor' },
          { id: 'c2', kind: 'oauth', keyStatus: 'ok', current: false, agentId: 'cursor' }
        ],
        'cursor'
      ),
      'c2'
    )
    assert.equal(
      sessionShowsHostQuota({
        liveSignedIn: true,
        liveIdentity: 'oboochin@gmail.com',
        profileKind: 'oauth',
        profileName: 'cheng.12@live.cn'
      }),
      false
    )
    assert.equal(
      sessionShowsHostQuota({
        liveSignedIn: true,
        liveIdentity: 'oboochin@gmail.com',
        profileKind: 'oauth',
        profileName: 'oboochin@gmail.com'
      }),
      true
    )
    const shown = conversationQuotaAuthView({
      liveSignedIn: true,
      liveIdentity: 'oboochin@gmail.com',
      livePlan: 'pro',
      liveAuthKind: 'oauth',
      profileKind: 'oauth',
      profileName: 'oboochin@gmail.com'
    })
    assert.equal(shown.signedIn, true)
    assert.equal(shown.plan, 'pro')
    const hidden = conversationQuotaAuthView({
      liveSignedIn: true,
      liveIdentity: 'live@x.com',
      liveAuthKind: 'oauth',
      profileKind: 'oauth',
      profileName: 'other@x.com'
    })
    assert.equal(hidden.signedIn, false)
    assert.equal(hidden.accountId, 'other@x.com')
    assert.equal(hidden.authKind, 'none')
  })

  it('picks the longest quota window for the row summary', () => {
    assert.equal(primaryQuotaPercent([]), null)
    assert.equal(
      primaryQuotaPercent([
        { kind: 'five_hour', usedPercent: 80 },
        { kind: 'monthly', usedPercent: 22 }
      ]),
      22
    )
  })

  it('rebuilds monthly usage once per snapshot', () => {
    const usage = usageFromSnapshots([
      {
        accountId: 'a',
        timestamp: new Date(2026, 7, 10).getTime(),
        newInputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.1
      },
      {
        accountId: 'a',
        timestamp: new Date(2026, 7, 11).getTime(),
        newInputTokens: 10,
        outputTokens: 5,
        estimatedCost: 0.1
      },
      { accountId: 'b', timestamp: new Date(2026, 7, 11).getTime(), newInputTokens: 4 }
    ])
    assert.equal(usage.a?.['2026-08']?.inputTokens, 20)
    assert.deepEqual(usageDeltaFromSnapshot({ newInputTokens: 3, estimatedCost: 0.2 }), {
      inputTokens: 3,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsd: 0.2
    })
    assert.equal(usage.a?.['2026-08']?.outputTokens, 10)
    assert.equal(usage.b?.['2026-08']?.inputTokens, 4)
  })

  it('resolves an accounts focus to a profile id', () => {
    const page = {
      accounts: [{ id: 'a1' }, { id: 'g1' }, { id: 'g2' }],
      groups: [
        { agentId: 'vav', accounts: [{ id: 'a1', current: true }] },
        {
          agentId: 'grok',
          accounts: [
            { id: 'g1', current: true },
            { id: 'g2', current: false }
          ]
        }
      ]
    }
    assert.equal(resolveAccountsFocus(page, 'g2', 'vav'), 'g2')
    assert.equal(resolveAccountsFocus(page, null, 'grok'), 'g1')
    assert.equal(resolveAccountsFocus(page, 'missing', 'vav'), 'a1')
    assert.equal(resolveAccountsFocus(page, null, 'cursor'), null)
  })

  it('treats temp vav folders as ephemeral workspace keys', () => {
    assert.equal(
      isEphemeralWorkspaceKey('/var/folders/sz/x/T/vav/182b376e/Workspace'),
      true
    )
    assert.equal(appWorkspaceKey('/var/folders/sz/x/T/vav/182b376e/Workspace'), DEFAULT_WORKSPACE_KEY)
    assert.equal(isEphemeralWorkspaceKey('/Users/oboo/repo/hold/vav'), false)
    assert.equal(appWorkspaceKey('/Users/oboo/repo/hold/vav'), '/Users/oboo/repo/hold/vav')
  })

  it('surfaces VAV keys and OAuth identities from any workspace', () => {
    const localVav = {
      id: 'v1',
      workspaceKey: '/now',
      agentId: 'vav',
      provider: 'vav' as const,
      kind: 'vav_key' as const,
      name: WORKSPACE_ACCOUNT_NAME,
      alias: null,
      endpoint: 'https://openrouter.ai/api',
      usesLegacyApiKey: true,
      current: true,
      createdAt: 1,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'unknown' as const,
      oauthHost: null
    }
    const oldVav = { ...localVav, id: 'v0', workspaceKey: '/old', name: 'DeepSeek' }
    const grokOld = {
      ...localVav,
      id: 'g1',
      workspaceKey: '/old',
      agentId: 'grok',
      provider: 'custom' as const,
      kind: 'oauth' as const,
      name: 'user@x.ai',
      endpoint: null,
      usesLegacyApiKey: false,
      keyStatus: 'ok' as const,
      oauthHost: 'grok'
    }
    const grokDup = { ...grokOld, id: 'g2', workspaceKey: '/other' }
    const grokDraft = { ...grokOld, id: 'g3', workspaceKey: '/old', name: '账户 2', keyStatus: 'unknown' as const }
    const grokLocalDup = { ...grokOld, id: 'g5', workspaceKey: '/now', current: false, createdAt: 9 }
    const grokLocalKeep = { ...grokOld, id: 'g4', workspaceKey: '/now', current: true, createdAt: 8 }
    const visible = visibleAccountsForWorkspace([localVav, oldVav, grokOld, grokDup, grokDraft], '/now')
    assert.deepEqual(
      visible.map((row) => row.id),
      ['v1', 'v0', 'g1', 'g3']
    )
    const collapsed = visibleAccountsForWorkspace(
      [localVav, grokLocalKeep, grokLocalDup, grokOld],
      '/now'
    )
    assert.deepEqual(
      collapsed.filter((row) => row.agentId === 'grok').map((row) => row.id),
      ['g4']
    )
    const current = visibleCurrentIds(
      [
        { ...grokOld, current: true },
        { id: 'g4', agentId: 'grok', workspaceKey: '/now', current: true }
      ],
      '/now'
    )
    assert.equal(current.has('g4'), true)
    assert.equal(current.has(grokOld.id), false)
    const liveOverSignedOut = visibleCurrentIds(
      [
        {
          id: 'local-out',
          agentId: 'cursor',
          workspaceKey: '/now',
          current: true,
          kind: 'oauth',
          keyStatus: 'unknown'
        },
        {
          id: 'live',
          agentId: 'cursor',
          workspaceKey: '/old',
          current: true,
          kind: 'oauth',
          keyStatus: 'ok'
        }
      ],
      '/now'
    )
    assert.equal(liveOverSignedOut.has('live'), true)
    assert.equal(liveOverSignedOut.has('local-out'), false)
  })

  it('picks the visible current VAV profile, not a leftover workspace-local current', () => {
    const openrouter = {
      id: 'or',
      workspaceKey: '/now',
      agentId: 'vav',
      provider: 'vav' as const,
      kind: 'vav_key' as const,
      name: 'OpenRouter',
      alias: null,
      endpoint: 'https://openrouter.ai/api/v1',
      usesLegacyApiKey: false,
      current: true,
      createdAt: 1,
      lastUsedAt: null,
      lastModel: null,
      keyStatus: 'ok' as const,
      oauthHost: null
    }
    const deepseek = {
      ...openrouter,
      id: 'ds',
      workspaceKey: '/old',
      name: 'DeepSeek2',
      endpoint: 'https://api.deepseek.com/anthropic',
      current: true,
      createdAt: 2
    }
    const picked = currentVisibleVav([openrouter, deepseek], '/now')
    assert.equal(picked?.id, 'or')
    const switched = currentVisibleVav(
      [
        { ...openrouter, current: false },
        { ...deepseek, current: true }
      ],
      '/now'
    )
    assert.equal(switched?.id, 'ds')
    assert.equal(switched?.endpoint, 'https://api.deepseek.com/anthropic')
  })

  it('counts vendor-endpoint key profiles as VAV', () => {
    assert.equal(
      isVavProfile({ provider: 'vav', agentId: 'vav', endpoint: 'https://openrouter.ai/api/v1' }),
      true
    )
    assert.equal(isVavProfile({ agentId: 'vav', endpoint: 'https://api.deepseek.com' }), true)
    assert.equal(isVavProfile({ agentId: 'vav', endpoint: null }), true)
    assert.equal(isVavProfile({ agentId: 'claude', provider: 'anthropic' }), false)
    assert.equal(isVavProfile({ agentId: 'grok', oauthHost: 'grok' }), false)
  })
})
