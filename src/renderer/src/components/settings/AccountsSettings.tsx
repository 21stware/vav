import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LogIn, Plus, RefreshCw } from 'lucide-react'
import type { AccountGroupView, AccountView, AccountsPagePayload } from '@shared/ipc'
import type { AppLocale, QuotaWindow } from '@shared/types'
import {
  accountRowUsage,
  accountShowsOAuthQuota,
  createKindsForAgent,
  liveOAuthSibling,
  resolveAccountsFocus
} from '@shared/accounts'
import { formatApiBalanceAmount } from '@shared/apiBalance'
import { formatCost, formatExpiry } from '@shared/tokenUsage'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'

const OAUTH_POLL_MS = 2_000

let cachedPage: AccountsPagePayload | null = null

function withKeyStatus(
  page: AccountsPagePayload,
  id: string,
  keyStatus: AccountView['keyStatus']
): AccountsPagePayload {
  const next = (rows: AccountView[]): AccountView[] =>
    rows.map((row) =>
      row.id === id
        ? { ...row, keyStatus, keyPresent: row.keyPresent || keyStatus === 'ok' }
        : row
    )
  return {
    ...page,
    accounts: next(page.accounts),
    groups: page.groups.map((group) => ({ ...group, accounts: next(group.accounts) }))
  }
}

type CreateMode = 'oauth' | 'key'
type Selection =
  | { kind: 'account'; id: string }
  | { kind: 'create'; agentId: string; mode: CreateMode }
type OAuthPhase = 'idle' | 'authorizing' | 'waiting' | 'error'

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
  return value.toLocaleString('en-US')
}

function rowUsage(
  account: AccountView,
  t: ReturnType<typeof useT>,
  syncing: boolean
): { text: string; tone: 'muted' | 'warn' | 'danger' } | null {
  const usage = accountRowUsage({
    kind: account.kind,
    keyStatus: account.keyStatus,
    oauthSignedIn: account.oauthSignedIn,
    oauthExpired: account.oauthExpired,
    quotaPercent: account.quotaPercent,
    quotaStatus: account.quotaStatus,
    monthTokens: account.monthTokens,
    refreshing: syncing,
    balance: account.balance
  })
  if (!usage) return null
  if (usage.kind === 'invalid') return { text: t('accounts.detail.invalid'), tone: usage.tone }
  if (usage.kind === 'signedOut') return { text: t('accounts.detail.signedOut'), tone: usage.tone }
  if (usage.kind === 'capped') return { text: t('accounts.detail.capped'), tone: usage.tone }
  if (usage.kind === 'percent') return { text: `${usage.percent}%`, tone: usage.tone }
  if (usage.kind === 'syncing') return { text: t('accounts.detail.syncing'), tone: usage.tone }
  if (usage.kind === 'syncFailed') return { text: t('accounts.detail.syncFailed'), tone: usage.tone }
  if (usage.kind === 'balance') {
    return {
      text: usage.available
        ? formatApiBalanceAmount({
            source: account.balance?.source === 'openrouter' ? 'openrouter' : 'deepseek',
            currency: usage.currency,
            total: usage.amount,
            granted: 0,
            toppedUp: 0,
            available: usage.available
          })
        : t('accounts.balanceUnavailable'),
      tone: usage.tone
    }
  }
  return { text: formatTokens(usage.tokens), tone: usage.tone }
}

export function AccountsSettings(): React.JSX.Element {
  const t = useT()
  const locale = useSessionStore((s) => s.resolvedLocale)
  const currency = useSessionStore((s) => s.settings.displayCurrency)
  const showDialog = useSessionStore((s) => s.showDialog)
  const [notice, setNotice] = useState<string | null>(null)
  const [page, setPage] = useState<AccountsPagePayload | null>(cachedPage)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [oauthPhase, setOauthPhase] = useState<OAuthPhase>('idle')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const seenIds = useRef(new Set<string>())
  const selectedRowRef = useRef<HTMLDivElement | null>(null)
  const refreshedOnce = useRef(false)
  const focusAccountId = useSessionStore((s) => s.settingsFocusAccountId)
  const focusAgentId = useSessionStore((s) => s.settingsFocusAgentId)

  const apply = (next: AccountsPagePayload): void => {
    cachedPage = next
    setPage(next)
    setError(null)
    for (const account of next.accounts) seenIds.current.add(account.id)
  }

  const load = useCallback(
    async (options?: { refresh?: boolean; force?: boolean }): Promise<AccountsPagePayload | null> => {
      const refreshingNow = options?.refresh === true
      if (refreshingNow) {
        setRefreshing(true)
        setRefreshError(null)
      }
      try {
        const next = await window.vav.accounts.getPage(null, options)
        apply(next)
        return next
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (refreshingNow) setRefreshError(message)
        else setError(message)
        return null
      } finally {
        if (refreshingNow) {
          refreshedOnce.current = true
          setRefreshing(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void (async () => {
      await load()
      await load({ refresh: true })
    })()
  }, [load])

  useEffect(() => {
    const off = window.vav.onAccountsUpdated?.(apply)
    return () => off?.()
  }, [])

  useEffect(() => {
    if (!page) return
    for (const account of page.accounts) seenIds.current.add(account.id)
    const focused = resolveAccountsFocus(page, focusAccountId, focusAgentId)
    if (focused) {
      setSelection({ kind: 'account', id: focused })
      if (focusAccountId || focusAgentId) {
        useSessionStore.setState({ settingsFocusAccountId: null, settingsFocusAgentId: null })
      }
      return
    }
    if (focusAccountId || focusAgentId) {
      if (refreshedOnce.current && !refreshing) {
        useSessionStore.setState({ settingsFocusAccountId: null, settingsFocusAgentId: null })
      }
      return
    }
    if (selection) return
    const first = page.accounts[0]
    if (first) setSelection({ kind: 'account', id: first.id })
  }, [page, selection, focusAccountId, focusAgentId, refreshing])

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selection])

  const selectedAccount = useMemo(() => {
    if (!page || selection?.kind !== 'account') return null
    return page.accounts.find((row) => row.id === selection.id) ?? null
  }, [page, selection])

  const selectedGroup = useMemo(() => {
    if (!page || !selection) return null
    const agentId = selection.kind === 'create' ? selection.agentId : selectedAccount?.agentId
    return page.groups.find((group) => group.agentId === agentId) ?? null
  }, [page, selection, selectedAccount])

  useEffect(() => {
    if (oauthPhase !== 'waiting' && oauthPhase !== 'authorizing') return
    const agentId =
      selection?.kind === 'create' ? selection.agentId : selectedAccount?.agentId ?? null
    if (!agentId) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      const next = await load()
      if (cancelled || !next) return
      const login = next.oauthLogin
      if (login?.agentId !== agentId) return
      if (login.status === 'ok') {
        const hit =
          (login.accountId
            ? next.accounts.find((row) => row.id === login.accountId)
            : null) ??
          next.accounts.find((row) => row.agentId === agentId && row.kind === 'oauth' && row.oauthSignedIn) ??
          next.accounts.find((row) => row.agentId === agentId && row.kind === 'oauth')
        if (!hit) return
        seenIds.current.add(hit.id)
        setSelection({ kind: 'account', id: hit.id })
        setOauthPhase('idle')
        setNotice(t('accounts.oauthSuccess', { name: selectedGroup?.name ?? hit.name }))
        return
      }
      if (login.status === 'error') {
        setOauthPhase('error')
        setError(login.message || t('accounts.oauthFailedBody'))
        return
      }
      if (login.status === 'cancelled') {
        setOauthPhase('idle')
      }
    }
    const timer = window.setInterval(() => void tick(), OAUTH_POLL_MS)
    void tick()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [oauthPhase, selection, selectedAccount?.agentId, load, t, selectedGroup?.name])

  const addProfile = async (group: AccountGroupView, kind: 'vav_key' | 'oauth'): Promise<void> => {
    setOauthPhase('idle')
    setError(null)
    setNotice(null)
    if (typeof window.vav.accounts.createDraft !== 'function') {
      setError(t('accounts.error.preload'))
      return
    }
    try {
      const { page: next, id } = await window.vav.accounts.createDraft({
        agentId: group.agentId,
        kind
      })
      apply(next)
      setSelection({ kind: 'account', id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const openCreate = (group: AccountGroupView, mode?: CreateMode): void => {
    const kinds = group.createKinds?.length ? group.createKinds : createKindsForAgent(group.agentId)
    const nextMode = mode ?? kinds[0] ?? 'key'
    void addProfile(group, nextMode === 'oauth' ? 'oauth' : 'vav_key')
  }

  const setCurrent = async (account: AccountView): Promise<void> => {
    setNotice(null)
    setSwitchingId(account.id)
    try {
      if (typeof window.vav.accounts.activate === 'function') {
        const { page: next, result } = await window.vav.accounts.activate(account.id)
        apply(next)
        if (result.kind === 'needsReauth') {
          setNotice(t('accounts.needsReauth'))
          return
        }
        if (result.kind === 'needsRefresh') {
          setNotice(t('accounts.needsRefresh'))
          return
        }
        setNotice(
          t('accounts.switched', {
            name: account.name,
            agent: page?.groups.find((group) => group.agentId === account.agentId)?.name ?? account.agentId
          })
        )
        return
      }
      apply(await window.vav.accounts.setCurrent(account.id))
      setNotice(
        t('accounts.switched', {
          name: account.name,
          agent: page?.groups.find((group) => group.agentId === account.agentId)?.name ?? account.agentId
        })
      )
    } catch {
      setError(t('accounts.switchFailed'))
    } finally {
      setSwitchingId(null)
    }
  }

  const beginOAuth = async (agentId: string, accountId?: string): Promise<void> => {
    setOauthPhase('authorizing')
    setError(null)
    setNotice(null)
    try {
      apply(await window.vav.accounts.beginOAuth(agentId, accountId))
      setOauthPhase('waiting')
    } catch (err) {
      setOauthPhase('error')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!page) {
    return <div className="accounts-stack">{error || t('common.loading')}</div>
  }

  return (
    <div className="accounts-stack">
      {error && oauthPhase !== 'error' ? (
        <div className="form-hint accounts-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice && !error ? (
        <div className="form-hint" aria-live="polite">
          {notice}
        </div>
      ) : null}
      {refreshError ? (
        <div className="form-hint accounts-error" role="alert">
          {t('accounts.quotaFailed')}
        </div>
      ) : null}
      {oauthPhase === 'waiting' ? (
        <div className="accounts-alert is-warning" role="status">
          <strong>{t('accounts.oauthWaitingTitle')}</strong>
          <span>{t('accounts.oauthWaitingBody')}</span>
        </div>
      ) : null}

      <div className="accounts-split">
        <div className="accounts-list-panel">
          <div className="accounts-list" role="list">
            {page.groups.map((group) => {
            const creating = selection?.kind === 'create' && selection.agentId === group.agentId
            return (
              <section key={group.agentId} className={`accounts-group${creating ? ' is-creating' : ''}`}>
                <div className="accounts-group-head">
                  <span>{group.name}</span>
                  <Button
                    className="accounts-group-add"
                    icon={<Plus size={14} />}
                    variant="ghost"
                    size="sm"
                    title={t('accounts.add')}
                    onClick={() => openCreate(group)}
                  />
                </div>
                {group.accounts.map((account) => {
                  const usage = rowUsage(account, t, refreshing)
                  const selected = selection?.kind === 'account' && selection.id === account.id
                  return (
                    <div
                      key={account.id}
                      ref={selected ? selectedRowRef : undefined}
                      className={`accounts-row-wrap${selected ? ' is-selected' : ''}${account.current ? ' is-current' : ''}`}
                    >
                      <button
                        type="button"
                        className={`accounts-row${selected ? ' is-selected' : ''}`}
                        onClick={() => {
                          setOauthPhase('idle')
                          setNotice(null)
                          setSelection({ kind: 'account', id: account.id })
                        }}
                      >
                        <span
                          className={`accounts-row-mark${account.current ? ' is-on' : ''}`}
                          aria-hidden
                        />
                        <span className="accounts-row-main">
                          <span className="accounts-row-name">{account.name}</span>
                        </span>
                        {usage ? (
                          <span
                            className={`accounts-row-detail is-${usage.tone}${refreshing ? ' usage-shimmer' : ''}`}
                          >
                            {usage.text}
                          </span>
                        ) : null}
                      </button>
                    </div>
                  )
                })}
              </section>
            )
            })}
          </div>
        </div>

        {selection?.kind === 'create' && selectedGroup ? (
          <CreateInspector
            group={selectedGroup}
            phase={oauthPhase}
            error={error}
            t={t}
            onAddKey={() => void addProfile(selectedGroup, 'vav_key')}
            onCancel={() => {
              if (oauthPhase === 'waiting' || oauthPhase === 'authorizing') {
                void window.vav.accounts.cancelOAuth(selection.agentId)
              }
              setOauthPhase('idle')
              setError(null)
              const first = selectedGroup.accounts[0] ?? page.accounts[0]
              setSelection(first ? { kind: 'account', id: first.id } : null)
            }}
            onAuthorize={() => void beginOAuth(selection.agentId)}
          />
        ) : selectedAccount ? (
          <AccountInspector
            key={selectedAccount.id}
            account={selectedAccount}
            liveSibling={liveOAuthSibling(page.accounts, selectedAccount)}
            agentName={selectedGroup?.name ?? selectedAccount.agentId}
            canSwitch={(selectedGroup?.accounts.length ?? 0) > 1}
            switching={switchingId === selectedAccount.id}
            compare={page.usage}
            locale={locale}
            currency={currency}
            saving={saving}
            refreshing={refreshing}
            t={t}
            onRefresh={() => void load({ refresh: true, force: true })}
            onApply={apply}
            onKeyStatus={(status) => {
              if (page) apply(withKeyStatus(page, selectedAccount.id, status))
            }}
            onBusy={setSaving}
            onError={setError}
            onFocusAccount={(id) => setSelection({ kind: 'account', id })}
            onSetCurrent={() => void setCurrent(selectedAccount)}
            onAuthorize={() => void beginOAuth(selectedAccount.agentId, selectedAccount.id)}
            onSignOut={() => {
              void window.vav.accounts
                .signOut(selectedAccount.agentId)
                .then(apply)
                .catch((err) => {
                  setError(err instanceof Error ? err.message : String(err))
                })
            }}
            onDelete={() =>
              showDialog({
                title: t('accounts.deleteTitle'),
                body: t('accounts.deleteBody', { name: selectedAccount.name }),
                confirmLabel: t('common.delete'),
                destructive: true,
                onConfirm: () => {
                  void window.vav.accounts.remove(selectedAccount.id).then((next) => {
                    apply(next)
                    const nextId =
                      next.groups
                        .find((group) => group.agentId === selectedAccount.agentId)
                        ?.accounts[0]?.id ?? next.accounts[0]?.id
                    setSelection(nextId ? { kind: 'account', id: nextId } : null)
                  }).catch((err) => {
                    setError(err instanceof Error ? err.message : String(err))
                  })
                }
              })
            }
          />
        ) : (
          <div className="accounts-inspector is-empty">
            <div className="form-hint">{t('accounts.emptyHint')}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function CreateInspector({
  group,
  phase,
  error,
  t,
  onAddKey,
  onCancel,
  onAuthorize
}: {
  group: AccountGroupView
  phase: OAuthPhase
  error: string | null
  t: ReturnType<typeof useT>
  onAddKey: () => void
  onCancel: () => void
  onAuthorize: () => void
}): React.JSX.Element {
  const busy = phase === 'authorizing'
  const canAddKey = (group.createKinds?.length ? group.createKinds : createKindsForAgent(group.agentId)).includes(
    'key'
  )
  return (
    <div className="accounts-inspector">
      <div className="accounts-inspector-head">
        <div className="accounts-inspector-copy">
          <div className="accounts-inspector-title">{group.name}</div>
          <div className="form-hint">
            {group.agentId === 'grok'
              ? t('accounts.oauthPendingDirect', { domain: group.oauthDomain })
              : t('accounts.oauthPending', { domain: group.oauthDomain })}
          </div>
        </div>
        <div className="accounts-tags">
          <span className="accounts-tag">{group.agentId === 'grok' ? 'xAI' : group.name}</span>
          <span className="accounts-tag">OAuth</span>
        </div>
      </div>
      <div className="accounts-inspector-actions">
        <Button
          label={busy ? t('accounts.oauthAuthorizing') : t('accounts.oauthAuthorize')}
          icon={<LogIn size={14} />}
          variant="primary"
          disabled={busy || phase === 'waiting'}
          onClick={onAuthorize}
        />
        <Button label={t('common.cancel')} variant="ghost" size="sm" onClick={onCancel} />
      </div>
      {phase === 'waiting' ? (
        <div className="accounts-alert is-warning" role="status">
          <strong>{t('accounts.oauthWaitingTitle')}</strong>
          <span>{t('accounts.oauthWaitingBody')}</span>
        </div>
      ) : null}
      {phase === 'error' ? (
        <div className="accounts-alert" role="alert">
          <strong>{t('accounts.oauthFailedTitle')}</strong>
          <span>{error || t('accounts.oauthFailedBody')}</span>
        </div>
      ) : null}
      {canAddKey ? (
        <div className="form-hint">
          {t('accounts.oauthAlsoKey')}{' '}
          <button type="button" className="accounts-inline-link" onClick={onAddKey}>
            {t('accounts.useKeyForm')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AccountInspector({
  account,
  liveSibling,
  agentName,
  canSwitch,
  switching,
  compare,
  locale,
  currency,
  saving,
  refreshing,
  t,
  onApply,
  onKeyStatus,
  onBusy,
  onError,
  onRefresh,
  onFocusAccount,
  onSetCurrent,
  onAuthorize,
  onSignOut,
  onDelete
}: {
  account: AccountView
  liveSibling: AccountView | null
  agentName: string
  canSwitch: boolean
  switching: boolean
  compare: AccountsPagePayload['usage']
  locale: AppLocale
  currency: import('@shared/types').DisplayCurrency
  saving: boolean
  refreshing: boolean
  t: ReturnType<typeof useT>
  onRefresh: () => void
  onApply: (page: AccountsPagePayload) => void
  onKeyStatus: (status: AccountView['keyStatus']) => void
  onBusy: (busy: boolean) => void
  onError: (message: string | null) => void
  onFocusAccount: (id: string) => void
  onSetCurrent: () => void
  onAuthorize: () => void
  onSignOut: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [alias, setAlias] = useState(account.alias ?? '')
  const [endpoint, setEndpoint] = useState(account.endpoint ?? '')
  const [draftKey, setDraftKey] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [validated, setValidated] = useState(false)
  const draftRef = useRef(draftKey)
  draftRef.current = draftKey

  useEffect(() => {
    setAlias(account.alias ?? '')
    setEndpoint(account.endpoint ?? '')
    setDraftKey('')
    setRevealed(false)
    setStatus(null)
    setValidated(false)
  }, [account.id, account.alias, account.endpoint])

  const persist = async (patch: { alias?: string | null; endpoint?: string; apiKey?: string }): Promise<void> => {
    onBusy(true)
    try {
      onApply(await window.vav.accounts.updateVav(account.id, patch))
      onError(null)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusy(false)
    }
  }

  const others =
    account.kind === 'oauth' && !account.oauthSignedIn
      ? []
      : compare.filter((row) => row.accountId !== account.id && row.tokens > 0)
  const reset = new Date(account.monthResetsAt).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric'
  })
  const canRefresh =
    account.kind === 'vav_key' || account.oauthSignedIn || account.hasCredentialSnapshot === true

  return (
    <div className="accounts-inspector">
      <div className="accounts-inspector-head">
        <div className="accounts-inspector-heading">
          <div className="accounts-inspector-title">{account.name}</div>
          {account.current ? (
            <span className="accounts-badge">{t('accounts.detail.current')}</span>
          ) : null}
        </div>
        {canRefresh ? (
          <Button
            icon={<RefreshCw size={14} className={refreshing ? 'analysis-spin' : undefined} />}
            label={refreshing ? t('accounts.refreshing') : t('accounts.refresh')}
            variant="secondary"
            size="sm"
            disabled={refreshing}
            onClick={onRefresh}
          />
        ) : null}
      </div>

      {account.kind === 'vav_key' && account.keyStatus === 'invalid' ? (
        <div className="accounts-alert" role="alert">
          <strong>{t('accounts.invalidTitle')}</strong>
          <span>{t('accounts.invalidBody')}</span>
        </div>
      ) : null}

      {account.kind === 'vav_key' ? (
        <div className="settings-form">
          <div className="settings-field">
            <span>{t('accounts.field.account')}</span>
            <span className="accounts-field-value">{account.identityName}</span>
          </div>
          <label className="settings-field">
            <span>{t('accounts.field.alias')}</span>
            <input
              className="text-field"
              value={alias}
              maxLength={40}
              placeholder={t('accounts.aliasPlaceholder')}
              onChange={(event) => setAlias(event.target.value)}
              onBlur={() => {
                const next = alias.trim() || null
                if (next !== (account.alias || null)) void persist({ alias: next })
              }}
            />
          </label>
          <label className="settings-field">
            <span>{t('api.endpoint')}</span>
            <input
              className="text-field"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              onBlur={() => {
                if (endpoint.trim() && endpoint.trim() !== (account.endpoint ?? '')) {
                  void persist({ endpoint })
                }
              }}
            />
          </label>
          <div className="settings-field">
            <span>{t('api.key')}</span>
            <div className="accounts-key-field">
              <input
                className="text-field"
                type={revealed ? 'text' : 'password'}
                placeholder={account.keyPresent ? '••••••••••••••••' : 'sk-…'}
                value={draftKey}
                onChange={(event) => setDraftKey(event.target.value)}
                onBlur={() => {
                  const key = draftRef.current.trim()
                  if (key) void persist({ apiKey: key }).then(() => setDraftKey(''))
                }}
              />
              <div className="accounts-key-actions">
                <Button
                  label={revealed ? t('api.hide') : t('api.show')}
                  size="sm"
                  onClick={() => {
                    void (async () => {
                      if (revealed) {
                        setRevealed(false)
                        return
                      }
                      if (!draftKey) {
                        const stored = await window.vav.accounts.revealKey(account.id)
                        if (stored) setDraftKey(stored)
                      }
                      setRevealed(true)
                    })()
                  }}
                />
                <Button
                  className={validated ? 'is-validated' : undefined}
                  label={
                    saving ? t('api.validating') : validated ? t('api.validateOk') : t('api.validate')
                  }
                  variant="secondary"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    void (async () => {
                      onBusy(true)
                      setValidated(false)
                      const result = await window.vav.accounts.verify(account.id, draftKey)
                      onBusy(false)
                      if (result.ok) {
                        setStatus(null)
                        setValidated(true)
                        onKeyStatus('ok')
                        return
                      }
                      setValidated(false)
                      setStatus(result.message)
                      onKeyStatus(result.authFailed ? 'invalid' : 'unknown')
                    })()
                  }}
                />
              </div>
            </div>
          </div>
          {account.keyHint || account.balance || (status && !validated) ? (
            <div className="accounts-meta">
              {account.keyHint ? (
                <span>{t('api.keyConfigured', { hint: account.keyHint })}</span>
              ) : null}
              {account.balance ? (
                <span>
                  {account.balance.available
                    ? t('accounts.balance', {
                        amount: formatApiBalanceAmount({
                          source:
                            account.balance.source === 'openrouter' ? 'openrouter' : 'deepseek',
                          currency: account.balance.currency,
                          total: account.balance.amount,
                          granted: 0,
                          toppedUp: 0,
                          available: account.balance.available
                        })
                      })
                    : t('accounts.balanceUnavailable')}
                </span>
              ) : null}
              {status && !validated ? (
                <span className="accounts-meta-error">{status}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="settings-form">
          <div className="settings-field">
            <span>{t('accounts.field.account')}</span>
            <span className="accounts-field-value">{account.identityName}</span>
          </div>
          <label className="settings-field">
            <span>{t('accounts.field.alias')}</span>
            <input
              className="text-field"
              value={alias}
              maxLength={40}
              placeholder={t('accounts.aliasPlaceholder')}
              onChange={(event) => setAlias(event.target.value)}
              onBlur={() => {
                const next = alias.trim() || null
                if (next !== (account.alias || null)) void persist({ alias: next })
              }}
            />
          </label>
          {account.kind === 'oauth' && !account.oauthSignedIn && !account.hasCredentialSnapshot ? (
            liveSibling || account.oauthExpired ? (
              <div className="form-hint">
                {liveSibling
                  ? t('accounts.quotaOnLive', { name: liveSibling.name })
                  : t('accounts.quotaSignedOut')}
                {liveSibling ? (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="accounts-inline-link"
                      onClick={() => onFocusAccount(liveSibling.id)}
                    >
                      {t('accounts.viewLiveProfile', { name: liveSibling.name })}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null
          ) : (
            <AccountQuotaSection account={account} refreshing={refreshing} locale={locale} t={t} />
          )}
        </div>
      )}

      <div className="accounts-inspector-actions">
        {canSwitch && !account.current ? (
          <Button
            label={switching ? t('accounts.switching') : t('accounts.setCurrent', { agent: agentName })}
            variant="primary"
            size="sm"
            disabled={switching}
            onClick={onSetCurrent}
          />
        ) : null}
        {account.kind === 'oauth' &&
        !account.oauthSignedIn &&
        (!account.hasCredentialSnapshot ||
          (account.credentialExpiresAtMs != null && account.credentialExpiresAtMs <= Date.now())) ? (
          <Button
            label={t('accounts.oauthAuthorize')}
            variant="primary"
            size="sm"
            onClick={onAuthorize}
          />
        ) : null}
        {account.kind === 'oauth' && account.oauthSignedIn ? (
          <Button label={t('accounts.signOut')} variant="ghost" size="sm" onClick={onSignOut} />
        ) : null}
        <span className="accounts-inspector-spacer" />
        <Button label={t('common.delete')} variant="ghost" size="sm" onClick={onDelete} />
      </div>

      {account.monthTokens > 0 || account.lastModel || others.length > 0 ? (
        <div className="accounts-usage">
          {account.monthTokens > 0 ? (
            <>
              <div className="settings-section-title">{t('accounts.monthUsage')}</div>
              <div className="form-hint">
                {t('accounts.monthMetaLocal', {
                  tokens: formatTokens(account.monthTokens),
                  cost: formatCost(account.monthCostUsd, currency, true),
                  reset
                })}
              </div>
            </>
          ) : null}
          {account.lastModel ? (
            <div className="kv-row">
              <span className="kv-label">{t('accounts.lastModel')}</span>
              <span className="kv-value">{account.lastModel}</span>
            </div>
          ) : null}
          {others.length > 0 ? (
            <div className="form-hint">
              {t('accounts.otherUsage', {
                list: others
                  .map((row) => `${row.name} ${formatTokens(row.tokens)}`)
                  .join(' · ')
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function AccountQuotaSection({
  account,
  refreshing,
  locale,
  t
}: {
  account: AccountView
  refreshing: boolean
  locale: AppLocale
  t: ReturnType<typeof useT>
}): React.JSX.Element | null {
  if (!accountShowsOAuthQuota(account)) {
    return null
  }
  const pending = refreshing || account.quotaStatus === 'loading'
  const windows = account.quotaWindows
  if (windows.length > 0) {
    return (
      <div className={`accounts-quotas${pending ? ' is-updating' : ''}`} aria-busy={pending}>
        {windows.map((window) => (
          <QuotaBar
            key={`${window.kind}-${window.resetsAt ?? 0}`}
            window={window}
            locale={locale}
            updating={pending}
            t={t}
          />
        ))}
        {account.quotaStatus === 'error' ? (
          <div className="form-hint accounts-error">{t('accounts.quotaFailed')}</div>
        ) : null}
      </div>
    )
  }
  if (pending) {
    return (
      <div className="accounts-quotas" aria-busy>
        <QuotaPending />
        <QuotaPending />
        <div className="form-hint">{t('accounts.detail.syncing')}</div>
      </div>
    )
  }
  if (account.quotaStatus === 'error') {
    return <div className="form-hint accounts-error">{t('accounts.quotaFailed')}</div>
  }
  return <div className="form-hint">{t('accounts.quotaEmpty')}</div>
}

function QuotaPending(): React.JSX.Element {
  return (
    <div className="accounts-quota is-pending">
      <div className="accounts-quota-meta">
        <span className="accounts-quota-pending-line" />
        <span className="accounts-quota-pending-line is-short" />
      </div>
      <div className="accounts-usage-bar is-indeterminate">
        <div className="accounts-usage-fill" />
      </div>
    </div>
  )
}

function QuotaBar({
  window,
  locale,
  updating = false,
  t
}: {
  window: QuotaWindow
  locale: AppLocale
  updating?: boolean
  t: ReturnType<typeof useT>
}): React.JSX.Element {
  const pct = Math.min(100, Math.max(0, window.usedPercent))
  const label =
    window.kind === 'five_hour'
      ? t('token.quotaFiveHour')
      : window.kind === 'seven_day'
        ? t('token.quotaWeekly')
        : window.kind === 'seven_day_opus'
          ? t('token.quotaWeeklyOpus')
          : window.kind === 'seven_day_sonnet'
            ? t('token.quotaWeeklySonnet')
            : window.kind === 'monthly'
              ? t('token.quotaMonthly')
              : window.kind === 'cursor_api'
                ? t('token.quotaCursorApi')
                : window.kind === 'cursor_auto'
                  ? t('token.quotaCursorAuto')
                  : t('token.quotaOther')
  const resets =
    window.resetsAt != null
      ? t('token.quotaResets', { clock: formatExpiry(window.resetsAt, Date.now(), locale) })
      : null
  return (
    <div className="accounts-quota">
      <div className="accounts-quota-meta">
        <span>{label}</span>
        <span className={updating ? 'usage-shimmer' : undefined}>
          {t('token.quotaUsed', { percent: pct.toFixed(pct >= 10 ? 0 : 1) })}
        </span>
      </div>
      <div className="accounts-usage-bar">
        <div
          className={`accounts-usage-fill${pct >= 100 ? ' is-capped' : pct >= 70 ? ' is-warn' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {resets ? <div className="form-hint">{resets}</div> : null}
    </div>
  )
}
