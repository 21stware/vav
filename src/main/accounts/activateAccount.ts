import { agentIdOf, oauthIdentityMatches } from '../../shared/accounts.ts'
import type { AccountActivateResult } from '../../shared/ipc.ts'
import type { AccountStore } from '../store/AccountStore.ts'
import type { HostCredentialAdapter, HostCredentialSnapshot } from './credentials/adapter.ts'
import { snapshotExpired } from './credentials/adapter.ts'
import { adapterFor } from './credentials/index.ts'

export type SnapshotVault = {
  getOAuthSnapshot(accountId: string): HostCredentialSnapshot | null
  setOAuthSnapshot(accountId: string, snapshot: HostCredentialSnapshot): void
}

export async function persistSnapshot(
  accounts: AccountStore,
  secrets: SnapshotVault,
  accountId: string,
  snapshot: HostCredentialSnapshot
): Promise<void> {
  secrets.setOAuthSnapshot(accountId, snapshot)
  accounts.update(accountId, {
    hasCredentialSnapshot: true,
    credentialExpiresAtMs: snapshot.expiresAtMs,
    oauthExpired: false
  })
}

export async function captureAccountCredentials(
  accountId: string,
  accounts: AccountStore,
  secrets: SnapshotVault,
  resolveAdapter: (host: string | null | undefined) => HostCredentialAdapter | null = adapterFor
): Promise<boolean> {
  const account = accounts.get(accountId)
  if (!account || account.kind !== 'oauth') return false
  const adapter = resolveAdapter(account.oauthHost ?? agentIdOf(account))
  if (!adapter?.swappable) return false
  const snapshot = await adapter.capture()
  if (!snapshot) return false
  await persistSnapshot(accounts, secrets, accountId, snapshot)
  return true
}

export async function captureLiveHost(
  host: string,
  liveName: string | null,
  accounts: AccountStore,
  secrets: SnapshotVault,
  resolveAdapter: (host: string | null | undefined) => HostCredentialAdapter | null = adapterFor
): Promise<void> {
  const adapter = resolveAdapter(host)
  if (!adapter?.swappable) return
  const snapshot = await adapter.capture()
  if (!snapshot) return
  const identity = snapshot.identity ?? liveName
  const row = accounts.listAll().find(
    (account) =>
      account.kind === 'oauth' &&
      agentIdOf(account) === host &&
      (oauthIdentityMatches(account.name, identity) ||
        oauthIdentityMatches(account.name, liveName) ||
        oauthIdentityMatches(account.name, snapshot.identity))
  )
  if (!row) return
  await persistSnapshot(accounts, secrets, row.id, snapshot)
}

export async function activateAccount(input: {
  accountId: string
  accounts: AccountStore
  secrets: SnapshotVault
  adapterFor?: (host: string | null | undefined) => HostCredentialAdapter | null
  now?: number
}): Promise<AccountActivateResult> {
  const account = input.accounts.get(input.accountId)
  if (!account) return { kind: 'needsReauth' }
  if (account.kind !== 'oauth') return { kind: 'switched' }

  const resolve = input.adapterFor ?? adapterFor
  const host = account.oauthHost ?? agentIdOf(account)
  const adapter = resolve(host)
  if (!adapter?.swappable) return { kind: 'needsReauth' }

  const live = await adapter.liveIdentity()
  if (oauthIdentityMatches(account.name, live)) return { kind: 'alreadyLive' }

  const snap = input.secrets.getOAuthSnapshot(account.id)
  if (!snap) return { kind: 'needsReauth' }
  if (snapshotExpired(snap, input.now)) return { kind: 'needsRefresh' }

  const current = await adapter.capture()
  if (current) {
    const sibling = input.accounts.listAll().find(
      (row) =>
        row.id !== account.id &&
        row.kind === 'oauth' &&
        agentIdOf(row) === host &&
        (oauthIdentityMatches(row.name, current.identity) ||
          oauthIdentityMatches(row.name, live))
    )
    if (sibling) await persistSnapshot(input.accounts, input.secrets, sibling.id, current)
  }

  try {
    await adapter.restore(snap)
  } catch (err) {
    console.error('[accounts] restore failed', err)
    return { kind: 'needsReauth' }
  }
  input.accounts.applyLiveOAuth(host, account.name, true)
  return { kind: 'switched' }
}
