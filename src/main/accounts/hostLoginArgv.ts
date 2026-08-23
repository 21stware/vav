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
