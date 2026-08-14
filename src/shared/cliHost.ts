/**
 * Structured CLI agent hosts (Waku-style): long-lived process + machine protocol,
 * rendered through VAV's Transcript / TurnEvent UI instead of a PTY.
 *
 * Covers every entry in {@link DEFAULT_CLI_AGENTS}.
 */

export type CliHostKind =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'grok'
  | 'opencode'
  | 'pi'
  | 'devin'
  | 'antigravity'
  | 'kiro'
  | 'cline'

/** Agents that speak a structured session protocol we can drive. */
export const STRUCTURED_CLI_HOSTS: readonly CliHostKind[] = [
  'claude',
  'pi',
  'cursor',
  'devin',
  'antigravity',
  'codex',
  'grok',
  'kiro',
  'opencode',
  'cline'
] as const

const STRUCTURED_SET = new Set<string>(STRUCTURED_CLI_HOSTS)

export function isStructuredCliHost(id: string | null | undefined): id is CliHostKind {
  return typeof id === 'string' && STRUCTURED_SET.has(id)
}

/**
 * Settings / quick-launch default chat host.
 * `null`, `""`, or `"vav"` → built-in VAV; otherwise a structured CLI id.
 */
export function resolveDefaultChatHost(
  defaultAgentId: string | null | undefined
): CliHostKind | null {
  if (!defaultAgentId || defaultAgentId === 'vav') return null
  return isStructuredCliHost(defaultAgentId) ? defaultAgentId : null
}

/**
 * Per-provider resume cursor persisted on {@link ConversationMeta}.
 * Survives process restarts so the next prompt can attach to the native thread.
 */
export type ProviderResumeCursor = (
  | { provider: 'claude'; sessionId: string; resumeAt?: string | null }
  | { provider: 'codex'; threadId: string }
  | { provider: 'cursor'; sessionId: string }
  | { provider: 'grok'; sessionId: string }
  | { provider: 'opencode'; sessionId: string }
  | { provider: 'pi'; sessionId: string; sessionFile?: string | null }
  | { provider: 'devin'; sessionId: string }
  | { provider: 'antigravity'; conversationId: string }
  | { provider: 'kiro'; sessionId: string }
  | { provider: 'cline'; sessionId: string }
) & {
  /**
   * Account fingerprint when the cursor was written (Grok user id, Claude
   * token hash, Codex account id). A mismatch after login switch drops resume.
   */
  authIdentity?: string
}

export function cursorAuthIdentity(cursor: ProviderResumeCursor | null | undefined): string | null {
  const id = cursor?.authIdentity?.trim()
  return id ? id : null
}

export function withCursorAuthIdentity(
  cursor: ProviderResumeCursor,
  identity: string | null
): ProviderResumeCursor {
  if (!identity) return cursor
  return { ...cursor, authIdentity: identity }
}

export function displayNameForCliHost(kind: CliHostKind): string {
  switch (kind) {
    case 'claude':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    case 'cursor':
      return 'Cursor'
    case 'grok':
      return 'Grok build'
    case 'opencode':
      return 'OpenCode'
    case 'pi':
      return 'Pi'
    case 'devin':
      return 'Devin'
    case 'antigravity':
      return 'Antigravity'
    case 'kiro':
      return 'Kiro'
    case 'cline':
      return 'Cline'
  }
}

/** Transport family used by {@link startDriver}. */
export type CliHostTransport =
  | 'claude-stream'
  | 'codex-app-server'
  | 'acp'
  | 'opencode-http'
  | 'pi-rpc'
  | 'antigravity-print'

export function transportForCliHost(kind: CliHostKind): CliHostTransport {
  switch (kind) {
    case 'claude':
      return 'claude-stream'
    case 'codex':
      return 'codex-app-server'
    case 'cursor':
    case 'grok':
    case 'devin':
    case 'kiro':
    case 'cline':
      return 'acp'
    case 'opencode':
      return 'opencode-http'
    case 'pi':
      return 'pi-rpc'
    case 'antigravity':
      return 'antigravity-print'
  }
}
