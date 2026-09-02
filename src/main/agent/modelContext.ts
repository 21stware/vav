import type { CliHostKind } from '../../shared/types.ts'
import { isStructuredCliHost } from '../../shared/cliHost.ts'
import { normalizeCursorConversationModel } from '../../shared/cursorModel.ts'

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

/** Heal a stored model id (and Cursor fast chip) to what the picker would resolve. */
export function conversationModelHealPatch(opts: {
  host: CliHostKind | null
  currentModel: string
  currentFast?: boolean
  resolved: string
  tokenLimit: number
}): { model?: string; tokenLimit?: number; fast?: boolean } {
  const patch: { model?: string; tokenLimit?: number; fast?: boolean } = {}
  if (opts.host === 'cursor' && opts.currentModel) {
    const normalized = normalizeCursorConversationModel(opts.currentModel)
    if (normalized.migrated && normalized.fast === true && opts.currentFast !== true) {
      patch.fast = true
    }
  }
  if (opts.resolved !== opts.currentModel) {
    patch.model = opts.resolved
    patch.tokenLimit = opts.tokenLimit
  }
  return patch
}
