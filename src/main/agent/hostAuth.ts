import type { CliHostKind } from '@shared/cliHost'
import { readClaudeAuthIdentity } from '../quota/claudeUsage'
import { readCodexAuthIdentity } from '../quota/codexUsage'
import { readGrokAuthIdentity } from '../quota/grokUsage'

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
    default:
      return null
  }
}
