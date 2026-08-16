import type { CliHostKind } from '@shared/cliHost'
import { emptyAccount, unknownAccount, type HostAccountInfo } from '@shared/cliAccountParse'
import { readClaudeAccountInfo, readClaudeAuthIdentity } from '../quota/claudeUsage'
import { readCodexAccountInfo, readCodexAuthIdentity } from '../quota/codexUsage'
import { readCursorAccountInfo, readCursorAuthIdentity } from '../quota/cursorUsage'
import { readDevinAccountInfo, readDevinAuthIdentity } from '../quota/devinUsage'
import { readGrokAccountInfo, readGrokAuthIdentity } from '../quota/grokUsage'
import { readOpencodeAccountInfo, readOpencodeAuthIdentity } from '../quota/opencodeUsage'
import { readPiAccountInfo } from '../quota/piUsage'

/**
 * Stable id for the currently logged-in CLI account, when we can read it.
 * Used to drop a persisted resume cursor after the user switches login.
 */
export async function readHostAuthIdentity(kind: CliHostKind): Promise<string | null> {
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
