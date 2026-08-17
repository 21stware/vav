import type { CliHostKind, ProviderResumeCursor } from './cliHost'

/** Swarm PTY pane → native CLI session. Keyed by tab id on the conversation. */
export interface CliPaneBinding {
  tabId: string
  agentId: CliHostKind
  cursor: ProviderResumeCursor
  /** Last title read from the host session store. */
  title?: string | null
  /** Title we last wrote onto the VAV conversation (so later host updates can follow). */
  projectedTitle?: string | null
  updatedAt: number
}

const FLAG_WITH_VALUE = new Set([
  '--resume',
  '-r',
  '--session-id',
  '-s',
  '--session',
  '--conversation'
])

const FLAG_BOOL = new Set(['--continue', '-c', '--fork-session'])

/** Native session / thread / conversation id from a resume cursor. */
export function nativeSessionId(cursor: ProviderResumeCursor | null | undefined): string | null {
  if (!cursor) return null
  if (cursor.provider === 'codex') return cursor.threadId.trim() || null
  if (cursor.provider === 'antigravity') return cursor.conversationId.trim() || null
  const id = cursor.sessionId?.trim()
  return id || null
}

export function mintSwarmCursor(
  agentId: CliHostKind,
  sessionId: string
): ProviderResumeCursor | null {
  const id = sessionId.trim()
  if (!id) return null
  switch (agentId) {
    case 'claude':
      return { provider: 'claude', sessionId: id, resumeAt: null }
    case 'codex':
      return { provider: 'codex', threadId: id }
    case 'cursor':
      return { provider: 'cursor', sessionId: id }
    case 'grok':
      return { provider: 'grok', sessionId: id }
    case 'opencode':
      return { provider: 'opencode', sessionId: id }
    case 'pi':
      return { provider: 'pi', sessionId: id }
    case 'devin':
      return { provider: 'devin', sessionId: id }
    case 'antigravity':
      return { provider: 'antigravity', conversationId: id }
    case 'kiro':
      return { provider: 'kiro', sessionId: id }
    case 'cline':
      return { provider: 'cline', sessionId: id }
  }
}

/** Claude / Grok accept a client-minted UUID on first spawn. */
export function canMintSwarmSessionId(agentId: string): boolean {
  return agentId === 'claude' || agentId === 'grok'
}

/** Hosts whose spawn argv can attach an existing native session. */
export function canApplyResumeArgs(agentId: string): boolean {
  return (
    agentId === 'claude' ||
    agentId === 'grok' ||
    agentId === 'codex' ||
    agentId === 'opencode' ||
    agentId === 'cursor'
  )
}

/**
 * Drop host continue/resume/session flags so VAV owns the binding.
 * Never leave `--continue` — that attaches the newest cwd session, not this pane.
 */
export function stripSessionArgs(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!
    if (i === 0 && token === 'resume') {
      const next = args[i + 1]
      if (next && !next.startsWith('-')) i += 1
      continue
    }
    if (FLAG_BOOL.has(token)) continue
    if (FLAG_WITH_VALUE.has(token)) {
      const next = args[i + 1]
      if (next && !next.startsWith('-')) i += 1
      continue
    }
    if (
      token.startsWith('--resume=') ||
      token.startsWith('--session-id=') ||
      token.startsWith('--session=') ||
      token.startsWith('--conversation=')
    ) {
      continue
    }
    out.push(token)
  }
  return out
}

/**
 * Build TTY argv for a Swarm pane.
 * Resume only for hosts whose CLI flag/subcommand we know; others keep stripped defaults
 * (id is still stored for title + Thread ACP).
 */
export function applySwarmSessionArgs(
  agentId: string,
  defaultArgs: string[],
  cursor: ProviderResumeCursor | null,
  mintedSessionId: string | null
): string[] {
  const stripped = stripSessionArgs(defaultArgs)
  // A freshly minted id is not on disk yet — `--resume` would 404 (Grok then
  // tries a remote restore). `--session-id` creates it.
  if (mintedSessionId && (agentId === 'claude' || agentId === 'grok')) {
    return [...stripped, '--session-id', mintedSessionId]
  }
  const resumeId = nativeSessionId(cursor)
  if (resumeId) {
    if (agentId === 'codex') return ['resume', resumeId, ...stripped]
    if (agentId === 'claude' || agentId === 'grok' || agentId === 'cursor') {
      return [...stripped, '--resume', resumeId]
    }
    if (agentId === 'opencode') return [...stripped, '--session', resumeId]
    return stripped
  }
  return stripped
}

export function newestBinding(
  bindings: Record<string, CliPaneBinding> | null | undefined,
  agentId?: string | null
): CliPaneBinding | null {
  const list = Object.values(bindings ?? {}).filter((row) =>
    agentId ? row.agentId === agentId : true
  )
  if (list.length === 0) return null
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  return list[0] ?? null
}

export function bindingSessionIds(
  bindings: Record<string, CliPaneBinding> | null | undefined,
  exceptTabId?: string
): Set<string> {
  const ids = new Set<string>()
  for (const row of Object.values(bindings ?? {})) {
    if (exceptTabId && row.tabId === exceptTabId) continue
    const id = nativeSessionId(row.cursor)
    if (id) ids.add(id)
  }
  return ids
}

const TITLE_LIMIT = 80

export function clipProjectedTitle(title: string): string {
  const chars = [...title.replace(/\s+/g, ' ').trim()]
  if (chars.length === 0) return ''
  if (chars.length <= TITLE_LIMIT) return chars.join('')
  return `${chars.slice(0, TITLE_LIMIT).join('')}…`
}
