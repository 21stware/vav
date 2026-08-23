import type { CliHostKind } from '@shared/cliHost'
import { emptyAccount, unknownAccount, type HostAccountInfo } from '@shared/cliAccountParse'
import { readClaudeAccountInfo, readClaudeAuthIdentity } from '../quota/claudeUsage'
import { readCodexAccountInfo, readCodexAuthIdentity } from '../quota/codexUsage'
import { readCursorAccountInfo, readCursorAuthIdentity } from '../quota/cursorUsage'
import { readDevinAccountInfo, readDevinAuthIdentity } from '../quota/devinUsage'
import { readGrokAccountInfo, readGrokAuthIdentity } from '../quota/grokUsage'
import { readOpencodeAccountInfo, readOpencodeAuthIdentity } from '../quota/opencodeUsage'
import { readPiAccountInfo } from '../quota/piUsage'

const IDENTITY_TTL_MS = 2 * 60_000
const identityCache = new Map<CliHostKind, { value: string | null; at: number }>()
const identityInflight = new Map<CliHostKind, Promise<string | null>>()

async function readHostAuthIdentityUncached(kind: CliHostKind): Promise<string | null> {
  switch (kind) {
    case 'grok':
      return readGrokAuthIdentity()
    case 'claude':
      return readClaudeAuthIdentity()
    case 'codex':
      return readCodexAuthIdentity()
    case 'cursor':
      return readCursorAuthIdentity()
    case 'opencode':
      return readOpencodeAuthIdentity()
    case 'devin':
      return readDevinAuthIdentity()
    default:
      return null
  }
}

/**
 * Stable id for the currently logged-in CLI account, when we can read it.
 * Used to drop a persisted resume cursor after the user switches login.
 * Cached so spawn does not wait on keychain / `security` every click.
 */
export async function readHostAuthIdentity(kind: CliHostKind): Promise<string | null> {
  const hit = identityCache.get(kind)
  if (hit && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.value
  const pending = identityInflight.get(kind)
  if (pending) return pending
  const work = readHostAuthIdentityUncached(kind).then((value) => {
    identityCache.set(kind, { value, at: Date.now() })
    identityInflight.delete(kind)
    return value
  })
  identityInflight.set(kind, work)
  return work
}

/** Fire-and-forget so the first spawn hits {@link readHostAuthIdentity} cache. */
export function warmHostAuthIdentities(kinds: readonly CliHostKind[]): void {
  for (const kind of kinds) void readHostAuthIdentity(kind)
}

export function clearHostAuthIdentityCache(): void {
  identityCache.clear()
  identityInflight.clear()
}

/** User-facing account + plan. Prefer each provider CLI over scraping keychain. */
export async function readHostAccountInfo(
  kind: CliHostKind | null
): Promise<HostAccountInfo> {
  if (!kind) return emptyAccount()
  switch (kind) {
    case 'grok':
      return readGrokAccountInfo()
    case 'codex':
      return readCodexAccountInfo()
    case 'claude':
      return readClaudeAccountInfo()
    case 'cursor':
      return readCursorAccountInfo()
    case 'opencode':
      return readOpencodeAccountInfo()
    case 'devin':
      return readDevinAccountInfo()
    case 'pi':
      return readPiAccountInfo()
    default:
      return unknownAccount()
  }
}
