import { OAUTH_SYNC_AGENTS, providerForAgent } from '@shared/accounts'
import type { AccountStore } from '../store/AccountStore'
import { captureLiveHost } from './activateAccount.ts'
import { readHostAccountInfo } from '../agent/hostAuth'

export { accountHasKey, accountSecret, resolveVavCredentials } from './vavCredentials'
export { buildAccountsPage, cliCatalogOf, resolveWorkspaceContext } from './page.ts'

/**
 * CLI login is machine-wide. Align stored OAuth rows with the live identity
 * and return that identity (email) per host. `null` means signed out.
 */
export async function syncOAuthProfiles(
  workspaceKey: string,
  accounts: AccountStore,
  options?: { skipAgents?: Iterable<string>; secrets?: import('../store/SecretStore').SecretStore }
): Promise<Map<string, string | null>> {
  const skip = new Set(options?.skipAgents ?? [])
  const live = new Map<string, string | null>()
  await Promise.all(
    OAUTH_SYNC_AGENTS.filter((host) => !skip.has(host)).map(async (host) => {
      try {
        const info = await readHostAccountInfo(host)
        const email = info.accountId?.trim() || null
        if (!info.signedIn) {
          accounts.applyLiveOAuth(host, null, false)
          live.set(host, null)
          return
        }
        if (email) {
          live.set(host, email)
          const hit = accounts.applyLiveOAuth(host, email, true)
          if (!hit) {
            accounts.upsertOAuth({
              workspaceKey,
              agentId: host,
              provider: providerForAgent(host),
              name: email,
              oauthHost: host,
              signedIn: true
            })
          }
          accounts.promoteLiveOAuthCurrent(workspaceKey, host, email)
          if (options?.secrets) {
            await captureLiveHost(host, email, accounts, options.secrets)
          }
          return
        }
        const kept = accounts.keepOneOAuthSignedIn(host)
        live.set(host, kept?.name ?? null)
      } catch {
        // Host not installed / unreadable — keep the last known identity.
      }
    })
  )
  return live
}
