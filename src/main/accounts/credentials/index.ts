import { isStructuredCliHost, type CliHostKind } from '../../../shared/cliHost.ts'
import {
  claudeCredentialsPath,
  claudeKeychainService,
  claudeKeychainUser,
  CURSOR_ACCESS_SERVICE,
  codexAuthPath,
  grokAuthPath,
  opencodeAuthPath,
  piAuthPath
} from '../../quota/hostPaths.ts'
import type { HostCredentialAdapter } from './adapter.ts'
import { makeFileAdapter } from './fileAdapter.ts'
import { makeKeychainAdapter } from './keychainAdapter.ts'
import { parseClaudeKeychainMeta, parseCursorKeychainMeta } from './parseKeychainSnapshot.ts'

const ADAPTERS: Partial<Record<CliHostKind, HostCredentialAdapter>> = {
  grok: makeFileAdapter({ host: 'grok', path: grokAuthPath }),
  codex: makeFileAdapter({ host: 'codex', path: codexAuthPath }),
  opencode: makeFileAdapter({ host: 'opencode', path: opencodeAuthPath }),
  pi: makeFileAdapter({ host: 'pi', path: piAuthPath }),
  cursor: makeKeychainAdapter({
    host: 'cursor',
    service: () => CURSOR_ACCESS_SERVICE,
    parseIdentity: (payload) => parseCursorKeychainMeta(payload).identity,
    parseExpiry: (payload) => parseCursorKeychainMeta(payload).expiresAtMs
  }),
  claude: makeKeychainAdapter({
    host: 'claude',
    service: () => claudeKeychainService(),
    account: () => claudeKeychainUser(),
    fileFallback: () => claudeCredentialsPath(),
    parseIdentity: (payload) => parseClaudeKeychainMeta(payload).identity,
    parseExpiry: (payload) => parseClaudeKeychainMeta(payload).expiresAtMs
  })
}

export function adapterFor(host: string | null | undefined): HostCredentialAdapter | null {
  if (!host || !isStructuredCliHost(host)) return null
  return ADAPTERS[host] ?? null
}

export type { HostCredentialAdapter, HostCredentialSnapshot } from './adapter.ts'
export { coerceSnapshot, snapshotExpired } from './adapter.ts'
export { accessTokenFromSnapshot } from './parseKeychainSnapshot.ts'
