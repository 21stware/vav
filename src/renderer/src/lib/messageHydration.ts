import type { ChatMessage } from '../../../shared/types.ts'

/**
 * Disk snapshot vs in-memory turns that landed while `conversations.get`
 * was in flight. Live messages win on id collision (they are newer); ids
 * only on disk keep their order, then live-only ids append.
 */
export function mergeHydratedMessages(
  disk: ChatMessage[],
  live: ChatMessage[] | undefined
): ChatMessage[] {
  if (!live?.length) return disk
  const byId = new Map<string, ChatMessage>()
  const order: string[] = []
  for (const message of disk) {
    byId.set(message.id, message)
    order.push(message.id)
  }
  for (const message of live) {
    if (!byId.has(message.id)) order.push(message.id)
    byId.set(message.id, message)
  }
  return order.map((id) => byId.get(id)!)
}

export function nextHydrationGeneration(gens: Map<string, number>, id: string): number {
  const next = (gens.get(id) ?? 0) + 1
  gens.set(id, next)
  return next
}

export function isCurrentHydration(gens: Map<string, number>, id: string, gen: number): boolean {
  return gens.get(id) === gen
}

export function omitKeys<T>(map: Record<string, T>, ids: Iterable<string>): Record<string, T> {
  let touched = false
  const next = { ...map }
  for (const id of ids) {
    if (id in next) {
      delete next[id]
      touched = true
    }
  }
  return touched ? next : map
}

/** Drop the in-flight assistant snapshot so StreamProjection is the only live view. */
export function omitLiveStreamingMessage<M extends { id: string }>(
  messages: Record<string, M[]>,
  conversationId: string,
  status: { isRunning?: boolean; messageId?: string | null }
): Record<string, M[]> {
  if (!status.isRunning || !status.messageId) return messages
  const list = messages[conversationId]
  if (!list?.some((m) => m.id === status.messageId)) return messages
  return {
    ...messages,
    [conversationId]: list.filter((m) => m.id !== status.messageId)
  }
}

/** Drop the same ids from several per-conversation maps in one pass. */
export function omitMappedKeys<S extends object, K extends keyof S>(
  state: S,
  keys: readonly K[],
  ids: Iterable<string>
): Pick<S, K> {
  const out = {} as Pick<S, K>
  for (const key of keys) {
    const value = state[key]
    out[key] = (
      value && typeof value === 'object' && !Array.isArray(value)
        ? omitKeys(value as Record<string, unknown>, ids)
        : value
    ) as S[K]
  }
  return out
}

/** Token-usage overlay maps from a conversations.get / list snapshot. */
export function conversationTokenCachePatch<H>(
  state: {
    tokenHistories: Record<string, H>
    cacheCreatedAt: Record<string, number | null>
    cacheExpiresAt: Record<string, number | null>
  },
  id: string,
  conversation: {
    tokenHistory?: H | null
    cacheCreatedAt?: number | null
    cacheExpiresAt?: number | null
  }
): {
  tokenHistories: Record<string, H>
  cacheCreatedAt: Record<string, number | null>
  cacheExpiresAt: Record<string, number | null>
} {
  return {
    tokenHistories: { ...state.tokenHistories, [id]: conversation.tokenHistory ?? ([] as H) },
    cacheCreatedAt: { ...state.cacheCreatedAt, [id]: conversation.cacheCreatedAt ?? null },
    cacheExpiresAt: { ...state.cacheExpiresAt, [id]: conversation.cacheExpiresAt ?? null }
  }
}

/** Soft-refresh maps after loadMessages when the transcript is already hydrated. */
export function conversationHydrationMetaPatch<C, H>(
  state: {
    compactions: Record<string, C>
    tokenHistories: Record<string, H>
    cacheCreatedAt: Record<string, number | null>
    cacheExpiresAt: Record<string, number | null>
  },
  id: string,
  conversation: {
    compactions?: C | null
    tokenHistory?: H | null
    cacheCreatedAt?: number | null
    cacheExpiresAt?: number | null
  }
): {
  compactions: Record<string, C>
  tokenHistories: Record<string, H>
  cacheCreatedAt: Record<string, number | null>
  cacheExpiresAt: Record<string, number | null>
} {
  return {
    ...conversationTokenCachePatch(state, id, conversation),
    compactions: { ...state.compactions, [id]: conversation.compactions ?? ([] as C) }
  }
}
