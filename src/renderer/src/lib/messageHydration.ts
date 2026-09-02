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
