/**
 * VAV API key + endpoint resolution without pulling CLI OAuth / Electron `net`.
 * Headless `vavd` only needs this path.
 */
import { currentVisibleVav, workspaceKeyOf, type ProviderAccount } from '@shared/accounts'
import type { AccountStore } from '../store/AccountStore'
import type { SecretStore } from '../store/SecretStore'

export function accountSecret(account: ProviderAccount, secrets: SecretStore): string | null {
  if (account.kind !== 'vav_key') return null
  if (account.usesLegacyApiKey) return secrets.get('api')
  return secrets.getAccountKey(account.id)
}

export function accountHasKey(account: ProviderAccount, secrets: SecretStore): boolean {
  const key = accountSecret(account, secrets)
  return !!key && key.length > 0
}

export function resolveVavCredentials(
  input: {
    conversation?: { workingDirectory?: string | null; accountId?: string | null } | null
    workspaceKey?: string
    settingsEndpoint: string
  },
  accounts: AccountStore,
  secrets: SecretStore
): { apiKey: string | null; endpoint: string; accountId: string | null } {
  const workspaceKey = input.workspaceKey ?? workspaceKeyOf(input.conversation?.workingDirectory)
  accounts.seedIfNeeded({
    workspaceKey,
    endpoint: input.settingsEndpoint || null,
    hasApiKey: secrets.has('api')
  })
  const pinned = input.conversation?.accountId
    ? accounts.get(input.conversation.accountId)
    : undefined
  const account =
    pinned && pinned.kind === 'vav_key'
      ? pinned
      : currentVisibleVav(accounts.listAll(), workspaceKey) ?? accounts.currentVav(workspaceKey)
  if (account) {
    return {
      apiKey: accountSecret(account, secrets),
      endpoint: account.endpoint?.trim() || input.settingsEndpoint,
      accountId: account.id
    }
  }
  return {
    apiKey: secrets.get('api'),
    endpoint: input.settingsEndpoint,
    accountId: null
  }
}
