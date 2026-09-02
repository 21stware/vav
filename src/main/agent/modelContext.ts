import type { CliHostKind } from '../../shared/types.ts'
import { isStructuredCliHost } from '../../shared/cliHost.ts'

export type ModelCatalogEntry = { id: string; contextWindow?: number }

/** Catalogue size when the host published one; else reported or the model-id table. */
export function contextWindowForModelId(
  host: CliHostKind | null,
  modelId: string,
  listed: number | undefined,
  reported: number | undefined,
  fallback: (modelId: string) => number
): number {
  if (listed && listed > 0) return listed
  if (host && reported && reported > 0) return reported
  return fallback(modelId)
}

/** Hosts to warm in the model catalogue: recents first, then live sessions. */
export function collectPreferredModelHosts(
  recent: Array<{ hostId: string }>,
  conversations: Array<{ cliHost?: string | null }>
): CliHostKind[] {
  const hosts: CliHostKind[] = []
  for (const entry of recent) {
    if (isStructuredCliHost(entry.hostId)) hosts.push(entry.hostId)
  }
  for (const conversation of conversations) {
    const host = conversation.cliHost
    if (host && isStructuredCliHost(host)) hosts.push(host)
  }
  return hosts
}
