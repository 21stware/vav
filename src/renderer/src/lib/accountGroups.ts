import { useEffect, useState } from 'react'
import type { AccountGroupView, AccountView, AccountsPagePayload } from '@shared/ipc'
import { useSessionStore } from '../state/sessionStore'

/** Live Settings → Providers account groups (VAV keys + CLI profiles). */
export function useAccountGroups(): AccountGroupView[] {
  const apiKeyPresent = useSessionStore((s) => s.settings.apiKeyPresent)
  const [groups, setGroups] = useState<AccountGroupView[]>([])

  useEffect(() => {
    const load = window.vav.accounts?.getPage
    if (typeof load !== 'function') return
    let cancelled = false
    const apply = (page: AccountsPagePayload): void => {
      if (!cancelled) setGroups(page.groups ?? [])
    }
    void load()
      .then(apply)
      .catch(() => undefined)
    const off = window.vav.onAccountsUpdated?.(apply)
    return () => {
      cancelled = true
      off?.()
    }
  }, [apiKeyPresent])

  return groups
}

export function vavAccountsOf(groups: AccountGroupView[]): AccountView[] {
  return groups.find((group) => group.agentId === 'vav')?.accounts ?? []
}
