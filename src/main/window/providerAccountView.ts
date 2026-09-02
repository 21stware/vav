import type { HostAuthKind } from '../../shared/cliAccountParse.ts'
import type { CliHostKind } from '../../shared/cliHost.ts'
import type { ProviderAccountViewPayload } from '../../shared/ipc.ts'
import type { AppLocale, QuotaWindow, ThemeMode } from '../../shared/types.ts'

/** Lean provider-account panel payload (hostId falls back to vav). */
export function providerAccountViewOf(input: {
  conversationId: string
  host: CliHostKind | null
  hostName: string
  signedIn: boolean
  accountId?: string | null
  plan?: string | null
  authKind?: HostAuthKind
  windows: QuotaWindow[]
  loading?: boolean
  theme: ThemeMode
  locale: AppLocale
  now?: number
}): ProviderAccountViewPayload {
  return {
    conversationId: input.conversationId,
    host: input.host,
    hostId: input.host ?? 'vav',
    hostName: input.hostName,
    signedIn: input.signedIn,
    accountId: input.accountId ?? null,
    plan: input.plan ?? null,
    authKind: input.authKind ?? (input.signedIn ? 'oauth' : 'none'),
    windows: input.windows,
    loading: input.loading ?? false,
    theme: input.theme,
    locale: input.locale,
    now: input.now ?? Date.now()
  }
}
