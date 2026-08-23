import type { AccountView } from '@shared/ipc'
import { apiProviderBrand, isGenericAccountIdentity } from '@shared/accounts'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'

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

/**
 * Switch the current profile for this agent. Identity (username / account
 * name) is shown here; keys and OAuth live in Accounts.
 */
export function AgentProfileSwitch({
  agentId,
  accounts,
  onProfileChanged
}: {
  agentId: string
  accounts: AccountView[]
  onProfileChanged: (accounts: AccountView[]) => void
}): React.JSX.Element {
  const t = useT()
  const current = accounts.find((row) => row.current) ?? accounts[0] ?? null

  const switchTo = async (id: string): Promise<void> => {
    if (!id || id === current?.id) return
    const page = await window.vav.accounts.setCurrent(id)
    onProfileChanged(page.groups.find((group) => group.agentId === agentId)?.accounts ?? [])
  }

  return (
    <div className="agents-vav-credentials">
      <label className="settings-field">
        <span>{t('agents.vavProfile')}</span>
        {accounts.length > 0 ? (
          <select
            className="text-field"
            value={current?.id ?? ''}
            onChange={(event) => void switchTo(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {profileLabel(account)}
              </option>
            ))}
          </select>
        ) : (
          <div className="form-hint">{t('agents.vavProfileEmpty')}</div>
        )}
      </label>
      {current?.kind === 'oauth' && current.oauthExpired ? (
        <div className="form-hint">{t('accounts.detail.signedOut')}</div>
      ) : null}
      {current?.kind === 'vav_key' && current.endpoint ? (
        <div className="form-hint">{current.endpoint}</div>
      ) : null}
      <div className="form-hint">
        <button
          type="button"
          className="accounts-inline-link"
          onClick={() =>
            useSessionStore.setState({
              settingsCategory: 'accounts',
              settingsFocusAccountId: current?.id ?? null,
              settingsFocusAgentId: agentId
            })
          }
        >
          {t('agents.vavManageAccounts')}
        </button>
      </div>
    </div>
  )
}
