/** CLI argv for provider OAuth. Kept free of node-pty so unit tests stay cheap. */

export function loginArgv(agentId: string): string[] | null {
  if (agentId === 'grok') return ['login', '--oauth']
  if (agentId === 'cursor') return ['login']
  return null
}

export function logoutArgv(agentId: string): string[] | null {
  if (agentId === 'grok' || agentId === 'cursor') return ['logout']
  return null
}

/**
 * Hosts with no login subcommand sign in over ACP `authenticate`.
 * Droid's `device-pairing` opens the browser itself and resolves once the
 * pairing code is approved.
 */
export function acpLoginSpec(agentId: string): { argv: string[]; methodId: string } | null {
  if (agentId === 'droid') {
    return { argv: ['exec', '--output-format', 'acp'], methodId: 'device-pairing' }
  }
  return null
}

export function canHostLogin(agentId: string): boolean {
  return loginArgv(agentId) != null || acpLoginSpec(agentId) != null
}
