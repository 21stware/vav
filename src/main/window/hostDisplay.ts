import type { CliHostKind } from '../../shared/cliHost.ts'

/** Resolve a CLI host's product name, falling back to the catalog label. */
export function hostDisplayName(
  host: CliHostKind | null,
  agents: Array<{ id: string; name: string }>,
  plainShell: string,
  fallbackName: (host: CliHostKind) => string
): string {
  if (!host) return plainShell
  return agents.find((agent) => agent.id === host)?.name ?? fallbackName(host)
}
