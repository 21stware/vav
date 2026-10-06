import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { isOAuthSyncAgent } from '@shared/accounts'
import type { AccountsPagePayload } from '@shared/ipc'
import { LLM_VENDOR_CATALOGUE } from '@shared/llmVendors'
import { CLI_AGENT_CATALOGUE } from '@shared/types'
import { refreshAgentInstallStatus, useAgentInstallMap } from '../../lib/agentInstallStatus'
import { useInstallRunStore } from '../../state/installRunStore'
import { useSessionStore } from '../../state/sessionStore'
import { useLocale, useT } from '../../i18n/useT'
import { AgentBrandMark } from '../AgentBrandMark'
import { NewKeyFields } from '../settings/VavApiCredentials'
import {
  defaultOnboardingAgent,
  onboardingAgentRows,
  type OnboardingAgentRow
} from './onboardingSteps'

/** What the agent step hands back: the row picked, and the `defaultAgentId` it implies. */
export type OnboardingAgentChoice = { rowId: string; defaultAgentId: string | null }

export function AgentStep({
  preview,
  value,
  onChange
}: {
  preview: boolean
  value: OnboardingAgentChoice | null
  onChange: (next: OnboardingAgentChoice) => void
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const install = useAgentInstallMap()
  const runs = useInstallRunStore((s) => s.runs)
  const legacyKey = useSessionStore((s) => s.settings.apiKeyPresent)
  const [probed, setProbed] = useState(false)
  const [page, setPage] = useState<AccountsPagePayload | null>(null)
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const [vendorId, setVendorId] = useState(() =>
    locale === 'zh-CN' ? 'deepseek' : 'anthropic'
  )

  useEffect(() => {
    // Preview must not append discovered agents to the user's list.
    void refreshAgentInstallStatus({ force: true, discover: !preview }).finally(() => setProbed(true))
    void useInstallRunStore.getState().load()
    const off = window.vav.onAccountsUpdated(setPage)
    void window.vav.accounts
      .getPage(undefined, { refresh: true })
      .then(setPage)
      .catch(() => undefined)
    return off
  }, [preview])

  // A finished install lands a binary on PATH — probe again so the row flips.
  const settled = Object.values(runs)
    .filter((run) => run.status === 'success')
    .map((run) => `${run.agentId}:${run.endedAt ?? 0}`)
    .join('|')
  useEffect(() => {
    if (settled) void refreshAgentInstallStatus({ force: true, discover: !preview })
  }, [settled, preview])

  const signedIn = useMemo(() => {
    const ids = new Set<string>()
    for (const account of page?.accounts ?? []) {
      if (account.oauthSignedIn || (account.kind !== 'oauth' && account.keyPresent)) {
        ids.add(account.agentId)
      }
    }
    if (legacyKey) ids.add('vav')
    return ids
  }, [page, legacyKey])

  useEffect(() => {
    if (signingIn && signedIn.has(signingIn)) setSigningIn(null)
  }, [signingIn, signedIn])

  const rows = useMemo(
    () => onboardingAgentRows(CLI_AGENT_CATALOGUE, install, t('onboarding.agent.vavName')),
    [install, t]
  )

  const vavDefault = (): string | null => (signedIn.has('vav') ? vendorId : null)
  const choose = (row: OnboardingAgentRow): void => {
    onChange({ rowId: row.id, defaultAgentId: row.kind === 'vav' ? vavDefault() : row.id })
  }

  // Pre-select once the probe lands, unless the user already picked.
  useEffect(() => {
    if (!probed || value) return
    const id = defaultOnboardingAgent(rows, signedIn)
    const row = rows.find((r) => r.id === id)
    if (row) choose(row)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per probe
  }, [probed])

  // Saving a key (or switching provider) changes what "VAV" means as a default.
  useEffect(() => {
    if (value?.rowId === 'vav' && value.defaultAgentId !== vavDefault()) {
      onChange({ rowId: 'vav', defaultAgentId: vavDefault() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow key / vendor only
  }, [signedIn, vendorId, value?.rowId])

  const startInstall = async (row: Extract<OnboardingAgentRow, { kind: 'cli' }>): Promise<void> => {
    if (!row.installCommand) return
    await window.vav.agents
      .installStart({ agentId: row.id, name: row.name, command: row.installCommand })
      .catch(() => undefined)
  }

  const signIn = async (id: string): Promise<void> => {
    setSigningIn(id)
    try {
      setPage(await window.vav.accounts.beginOAuth(id))
    } catch {
      setSigningIn(null)
    }
  }

  const vendor = LLM_VENDOR_CATALOGUE.find((row) => row.id === vendorId) ?? LLM_VENDOR_CATALOGUE[0]

  return (
    <div className="onboarding-options" role="radiogroup" aria-label={t('onboarding.agent.title')}>
      {rows.map((row) => {
        const selected = value?.rowId === row.id
        if (row.kind === 'vav') {
          const ready = signedIn.has('vav')
          return (
            <div
              key={row.id}
              className="onboarding-option-group"
              data-selected={selected ? 'true' : 'false'}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className="onboarding-option"
                data-selected={selected ? 'true' : 'false'}
                data-testid="onboarding-agent-vav"
                onClick={() => choose(row)}
              >
                <AgentBrandMark agent={{ id: 'vav', name: row.name }} size={28} />
                <span className="onboarding-option-text">
                  <span className="onboarding-option-title">{row.name}</span>
                  <span className="onboarding-option-desc">
                    {ready ? t('onboarding.agent.vavReady') : t('onboarding.agent.vavHint')}
                  </span>
                </span>
              </button>
              {selected && !ready ? (
                <div className="onboarding-key">
                  <label className="onboarding-key-provider">
                    <span>{t('onboarding.agent.provider')}</span>
                    <span className="font-select">
                      <select
                        className="text-field font-select-field"
                        value={vendor.id}
                        onChange={(event) => setVendorId(event.target.value)}
                      >
                        {LLM_VENDOR_CATALOGUE.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
                    </span>
                  </label>
                  <NewKeyFields
                    key={vendor.id}
                    agentId="vav"
                    endpoint={vendor.endpoint}
                    onCreated={setPage}
                  />
                </div>
              ) : null}
            </div>
          )
        }

        const run = runs[row.id]
        const installing = run?.status === 'running'
        const ready = row.install === 'ready'
        const knowsLogin = isOAuthSyncAgent(row.id)
        let status: string
        let action: React.ReactNode = null
        if (installing) {
          status = t('onboarding.agent.installing')
          action = <Loader2 size={14} strokeWidth={2.25} className="onboarding-spin" aria-hidden />
        } else if (!ready) {
          status =
            run?.status === 'error' ? t('onboarding.agent.installFailed') : t('onboarding.agent.notInstalled')
          if (row.installCommand && probed) {
            action = (
              <button
                type="button"
                className="btn secondary sm"
                title={row.installCommand}
                onClick={(event) => {
                  event.stopPropagation()
                  void startInstall(row)
                }}
              >
                {t('onboarding.agent.install')}
              </button>
            )
          }
        } else if (!knowsLogin) {
          status = t('onboarding.agent.installed')
        } else if (signedIn.has(row.id)) {
          status = t('onboarding.agent.signedIn')
        } else if (signingIn === row.id) {
          status = t('onboarding.agent.signingIn')
          action = <Loader2 size={14} strokeWidth={2.25} className="onboarding-spin" aria-hidden />
        } else {
          status = t('onboarding.agent.signedOut')
          action = (
            <button
              type="button"
              className="btn secondary sm"
              onClick={(event) => {
                event.stopPropagation()
                void signIn(row.id)
              }}
            >
              {t('onboarding.agent.signIn')}
            </button>
          )
        }

        return (
          <div
            key={row.id}
            role="radio"
            aria-checked={selected}
            aria-disabled={!ready}
            tabIndex={ready ? 0 : -1}
            className="onboarding-option"
            data-selected={selected ? 'true' : 'false'}
            data-disabled={ready ? 'false' : 'true'}
            data-testid={`onboarding-agent-${row.id}`}
            onClick={() => {
              if (ready) choose(row)
            }}
            onKeyDown={(event) => {
              if (ready && event.key === ' ') {
                event.preventDefault()
                choose(row)
              }
            }}
          >
            <AgentBrandMark agent={{ id: row.id, name: row.name }} size={28} />
            <span className="onboarding-option-text">
              <span className="onboarding-option-title">{row.name}</span>
              <span className="onboarding-option-desc">{status}</span>
            </span>
            {action ? <span className="onboarding-option-action">{action}</span> : null}
          </div>
        )
      })}
      {!probed ? (
        <div className="onboarding-options-note" aria-live="polite">
          <Loader2 size={13} strokeWidth={2.25} className="onboarding-spin" aria-hidden />
          {t('onboarding.agent.detecting')}
        </div>
      ) : (
        <div className="onboarding-options-note">{t('onboarding.agent.more')}</div>
      )}
    </div>
  )
}
