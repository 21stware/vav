import { useEffect, useRef, useState } from 'react'
import type { AccountView, AccountsPagePayload } from '@shared/ipc'
import {
  apiProviderBrand,
  createKindForAgent,
  createKindsForAgent,
  defaultKeyEndpoint,
  isGenericAccountIdentity
} from '@shared/accounts'
import { vendorFromEndpoint } from '@shared/llmVendors'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'

const NEW_ACCOUNT = '__new__'

function profileLabel(account: AccountView): string {
  const username = account.identityName || account.name
  if (account.kind === 'oauth') {
    return account.alias && account.alias !== username ? `${account.alias} · ${username}` : username
  }
  const brand = apiProviderBrand(account.endpoint)
  const label =
    account.alias?.trim() ||
    (!isGenericAccountIdentity(username) ? username : brand) ||
    username
  if (brand && label !== brand) return `${label} · ${brand}`
  if (brand) return brand
  const host = account.endpointHost || account.endpoint
  return host ? `${label} · ${host}` : label
}

function groupAccounts(page: AccountsPagePayload, agentId: string): AccountView[] {
  return page.groups.find((group) => group.agentId === agentId)?.accounts ?? []
}

/**
 * Switch the current profile for this provider. "New profile" reveals OAuth
 * or a token field instead of a separate add-profile link.
 */
export function AgentProfileSwitch({
  agentId,
  accounts,
  endpoint,
  onProfileChanged
}: {
  agentId: string
  accounts: AccountView[]
  /** Default endpoint for a newly added key profile. */
  endpoint?: string
  onProfileChanged: (accounts: AccountView[]) => void
}): React.JSX.Element {
  const t = useT()
  const createKind = createKindForAgent(agentId)
  const canAddKey = createKindsForAgent(agentId).includes('key')
  const current = accounts.find((row) => row.current) ?? accounts[0] ?? null
  const [adding, setAdding] = useState(false)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [switchNotice, setSwitchNotice] = useState<'needsReauth' | 'needsRefresh' | 'failed' | null>(
    null
  )
  const [newKind, setNewKind] = useState(createKind)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [oauthPhase, setOauthPhase] = useState<'idle' | 'authorizing' | 'waiting' | 'error'>(
    'idle'
  )
  const [oauthError, setOauthError] = useState<string | null>(null)
  const onChangedRef = useRef(onProfileChanged)
  onChangedRef.current = onProfileChanged
  const hydratedRef = useRef(accounts.length > 0)

  useEffect(() => {
    hydratedRef.current = accounts.length > 0
    setAdding(accounts.length === 0)
    setPickedId(null)
    setSwitchNotice(null)
    setNewKind(createKindForAgent(agentId))
    setDraftId(null)
    setOauthPhase('idle')
    setOauthError(null)
  }, [agentId])

  useEffect(() => {
    if (accounts.length === 0) {
      setAdding(true)
      return
    }
    if (!hydratedRef.current) {
      hydratedRef.current = true
      setAdding(false)
    }
  }, [accounts.length])

  useEffect(() => {
    if (pickedId && current?.id === pickedId) setPickedId(null)
  }, [pickedId, current?.id])

  useEffect(() => {
    if (oauthPhase !== 'waiting' && oauthPhase !== 'authorizing') return
    const applyPage = (page: AccountsPagePayload): void => {
      onChangedRef.current(groupAccounts(page, agentId))
      const login = page.oauthLogin
      if (login?.agentId !== agentId) return
      if (login.status === 'ok') {
        setAdding(false)
        setDraftId(null)
        setOauthPhase('idle')
        setOauthError(null)
      } else if (login.status === 'error') {
        setOauthPhase('error')
        setOauthError(login.message || t('accounts.oauthFailedBody'))
      } else if (login.status === 'cancelled') {
        setOauthPhase('idle')
      }
    }
    const off = window.vav.onAccountsUpdated?.(applyPage)
    const timer = window.setInterval(() => {
      void window.vav.accounts.getPage().then(applyPage).catch(() => undefined)
    }, 2000)
    return () => {
      off?.()
      window.clearInterval(timer)
    }
  }, [oauthPhase, agentId, t])

  const stopOauth = (): void => {
    if (oauthPhase === 'waiting' || oauthPhase === 'authorizing') {
      void window.vav.accounts.cancelOAuth(agentId)
    }
    setOauthPhase('idle')
    setOauthError(null)
  }

  const switchTo = async (id: string): Promise<void> => {
    const target = accounts.find((row) => row.id === id)
    if (!target) return
    try {
      if (target.kind === 'oauth' && typeof window.vav.accounts.activate === 'function') {
        const { page, result } = await window.vav.accounts.activate(id)
        if (result.kind === 'needsReauth' || result.kind === 'needsRefresh') {
          onProfileChanged(groupAccounts(await window.vav.accounts.setCurrent(id), agentId))
          setSwitchNotice(result.kind)
          return
        }
        onProfileChanged(groupAccounts(page, agentId))
        setSwitchNotice(null)
        return
      }
      onProfileChanged(groupAccounts(await window.vav.accounts.setCurrent(id), agentId))
      setSwitchNotice(null)
    } catch {
      setSwitchNotice('failed')
    }
  }

  const onSelect = (value: string): void => {
    if (value === NEW_ACCOUNT) {
      setAdding(true)
      setPickedId(null)
      setSwitchNotice(null)
      setNewKind(createKindForAgent(agentId))
      return
    }
    stopOauth()
    setAdding(false)
    setDraftId(null)
    setPickedId(value)
    void switchTo(value)
  }

  const authorize = async (): Promise<void> => {
    setOauthPhase('authorizing')
    setOauthError(null)
    try {
      let id = draftId
      if (!id) {
        const { page, id: created } = await window.vav.accounts.createDraft({
          agentId,
          kind: 'oauth'
        })
        id = created
        setDraftId(created)
        onProfileChanged(groupAccounts(page, agentId))
      }
      await window.vav.accounts.beginOAuth(agentId, id)
      setOauthPhase('waiting')
    } catch (err) {
      setOauthPhase('error')
      setOauthError(err instanceof Error ? err.message : String(err))
    }
  }

  const showNew = adding || accounts.length === 0
  const busy = oauthPhase === 'authorizing' || oauthPhase === 'waiting'
  const selectedId = showNew ? NEW_ACCOUNT : (pickedId ?? current?.id ?? NEW_ACCOUNT)

  return (
    <div className="agents-vav-credentials">
      <label className="settings-field row agents-account-switch">
        <span>{t('agents.account')}</span>
        <select
          className="text-field"
          value={selectedId}
          onChange={(event) => onSelect(event.target.value)}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {profileLabel(account)}
            </option>
          ))}
          <option value={NEW_ACCOUNT}>{t('accounts.newAccount')}</option>
        </select>
      </label>

      {showNew ? (
        newKind === 'oauth' ? (
          <div className="agents-new-account">
            <Button
              label={busy ? t('accounts.oauthAuthorizing') : t('accounts.oauthAuthorize')}
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void authorize()}
            />
            {oauthPhase === 'waiting' ? (
              <div className="form-hint">{t('accounts.oauthWaitingBody')}</div>
            ) : null}
            {oauthPhase === 'error' ? (
              <div className="form-hint agents-new-account-error">
                {oauthError || t('accounts.oauthFailedBody')}
              </div>
            ) : null}
            {canAddKey ? (
              <div className="form-hint">
                {t('accounts.oauthAlsoKey')}{' '}
                <button
                  type="button"
                  className="accounts-inline-link"
                  onClick={() => {
                    stopOauth()
                    setNewKind('key')
                  }}
                >
                  {t('accounts.useKeyForm')}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <NewKeyFields
            key={endpoint ?? ''}
            agentId={agentId}
            endpoint={endpoint}
            onCreated={(page) => {
              onProfileChanged(groupAccounts(page, agentId))
              setAdding(false)
              setDraftId(null)
            }}
          />
        )
      ) : switchNotice === 'failed' ? (
        <div className="form-hint agents-new-account-error">{t('accounts.switchFailed')}</div>
      ) : switchNotice === 'needsReauth' ||
        switchNotice === 'needsRefresh' ||
        (current?.kind === 'oauth' && current.oauthExpired) ? (
        <div className="form-hint">
          {switchNotice === 'needsRefresh'
            ? t('accounts.needsRefresh')
            : switchNotice === 'needsReauth'
              ? t('accounts.needsReauth')
              : t('accounts.detail.signedOut')}
          {current?.kind === 'oauth' ? (
            <>
              {' '}
              <button
                type="button"
                className="accounts-inline-link"
                onClick={() => void window.vav.accounts.beginOAuth(agentId, current.id)}
              >
                {t('accounts.oauthAuthorize')}
              </button>
            </>
          ) : null}
        </div>
      ) : current?.kind === 'vav_key' ? (
        <LlmAccountFields
          account={current}
          presetEndpoint={endpoint}
          onApply={(next) => onProfileChanged(groupAccounts(next, agentId))}
        />
      ) : current?.kind === 'oauth' && !current.oauthSignedIn ? (
        <div className="form-hint">
          <button
            type="button"
            className="accounts-inline-link"
            onClick={() => void window.vav.accounts.beginOAuth(agentId, current.id)}
          >
            {t('accounts.oauthAuthorize')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function NewKeyFields({
  agentId,
  endpoint,
  onCreated
}: {
  agentId: string
  endpoint?: string
  onCreated: (page: AccountsPagePayload) => void
}): React.JSX.Element {
  const t = useT()
  const preset = (endpoint ?? defaultKeyEndpoint(agentId, '')).trim()
  const [endpointValue, setEndpointValue] = useState(preset)
  const [draftKey, setDraftKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const draftRef = useRef(draftKey)
  draftRef.current = draftKey

  const persist = async (): Promise<void> => {
    const key = draftRef.current.trim()
    if (!key || saving) return
    setSaving(true)
    try {
      const { id } = await window.vav.accounts.createDraft({
        agentId,
        kind: 'vav_key',
        endpoint: endpointValue.trim() || undefined
      })
      await window.vav.accounts.updateVav(id, {
        apiKey: key,
        ...(endpointValue.trim() ? { endpoint: endpointValue } : {})
      })
      onCreated(await window.vav.accounts.setCurrent(id))
      setDraftKey('')
      setStatus(null)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-form agents-llm-fields">
      {!preset ? (
        <label className="settings-field">
          <span>{t('api.endpoint')}</span>
          <input
            className="text-field"
            value={endpointValue}
            onChange={(event) => setEndpointValue(event.target.value)}
          />
        </label>
      ) : null}
      <label className="settings-field">
        <span>{t('api.key')}</span>
        <input
          className="text-field"
          data-testid="settings-api-key"
          type="password"
          placeholder="sk-…"
          value={draftKey}
          disabled={saving}
          onChange={(event) => setDraftKey(event.target.value)}
          onBlur={() => void persist()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void persist()
            }
          }}
        />
      </label>
      {status ? <div className="accounts-meta-error">{status}</div> : null}
    </div>
  )
}

function officialVendorEndpoint(
  preset?: string | null,
  accountEndpoint?: string | null
): string {
  const fromPreset = (preset ?? '').trim()
  if (fromPreset) return fromPreset
  return vendorFromEndpoint(accountEndpoint)?.endpoint?.trim() ?? ''
}

function LlmAccountFields({
  account,
  presetEndpoint,
  onApply
}: {
  account: AccountView
  /** Official catalogue URL — when set, the endpoint field is hidden. */
  presetEndpoint?: string
  onApply: (page: AccountsPagePayload) => void
}): React.JSX.Element {
  const t = useT()
  const lockedEndpoint = officialVendorEndpoint(presetEndpoint, account.endpoint)
  const [endpoint, setEndpoint] = useState(account.endpoint ?? lockedEndpoint)
  const [draftKey, setDraftKey] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validated, setValidated] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const draftRef = useRef(draftKey)
  draftRef.current = draftKey

  useEffect(() => {
    setEndpoint(account.endpoint ?? lockedEndpoint)
    setDraftKey('')
    setRevealed(false)
    setValidated(false)
    setStatus(null)
  }, [account.id, account.endpoint, lockedEndpoint])

  const persist = async (patch: { endpoint?: string; apiKey?: string }): Promise<void> => {
    setSaving(true)
    try {
      onApply(await window.vav.accounts.updateVav(account.id, patch))
      setStatus(null)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!lockedEndpoint || (account.endpoint ?? '').trim()) return
    void persist({ endpoint: lockedEndpoint })
    // Fill once when a catalogue vendor has no stored URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, lockedEndpoint])

  return (
    <div className="settings-form agents-llm-fields">
      {!lockedEndpoint ? (
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
      ) : null}
      <div className="settings-field">
        <span>{t('api.key')}</span>
        <div className="accounts-key-field">
          <input
            className="text-field"
            data-testid="settings-api-key"
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
              testId="settings-api-key-reveal"
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
              label={saving ? t('api.validating') : validated ? t('api.validateOk') : t('api.validate')}
              testId="settings-api-key-validate"
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={() => {
                void (async () => {
                  setSaving(true)
                  setValidated(false)
                  const result = await window.vav.accounts.verify(account.id, draftKey)
                  setSaving(false)
                  if (result.ok) {
                    setStatus(null)
                    setValidated(true)
                    return
                  }
                  setValidated(false)
                  setStatus(result.message)
                })()
              }}
            />
          </div>
        </div>
      </div>
      {account.keyHint || (status && !validated) ? (
        <div className="accounts-meta">
          {account.keyHint ? (
            <span data-testid="settings-api-key-hint">
              {t('api.keyConfigured', { hint: account.keyHint })}
            </span>
          ) : null}
          {status && !validated ? <span className="accounts-meta-error">{status}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
