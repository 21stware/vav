import { useMemo, useSyncExternalStore } from 'react'
import {
  collectConversationArtifacts,
  writeToolPath,
  type ConversationArtifact
} from '@shared/conversationArtifacts'
import type { ChatMessage, MessageBlock } from '@shared/types'
import { getProjection } from '../state/StreamProjection'
import { useSessionStore } from '../state/sessionStore'

const EMPTY_LIVE: MessageBlock[] = []
const liveCache = new Map<string, { sig: string; blocks: MessageBlock[] }>()

/** Stable write-tool snapshot — new array only when paths / status change. */
function liveWriteBlocks(conversationId: string): MessageBlock[] {
  const snapshot = getProjection(conversationId).getSnapshot()
  if (!snapshot.active) {
    liveCache.delete(conversationId)
    return EMPTY_LIVE
  }
  const blocks: MessageBlock[] = []
  const parts: string[] = []
  for (const block of snapshot.blocks) {
    if (block.kind !== 'tool') continue
    const path = writeToolPath(block.block.tool, block.block.input)
    if (!path) continue
    blocks.push(block.block)
    parts.push(`${block.block.id}:${block.block.status}:${path}`)
  }
  const sig = parts.join('|')
  const prev = liveCache.get(conversationId)
  if (prev && prev.sig === sig) return prev.blocks
  const next = { sig, blocks: blocks.length ? blocks : EMPTY_LIVE }
  liveCache.set(conversationId, next)
  return next.blocks
}

export function useConversationArtifacts(
  conversationId: string | null,
  messages: ChatMessage[]
): ConversationArtifact[] {
  const workdir = useSessionStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.workingDirectory ?? null
  )
  const changeSetsById = useSessionStore((s) => s.changeSetsById)
  const projection = getProjection(conversationId || '__none__')
  const liveBlocks = useSyncExternalStore(projection.subscribe, () =>
    conversationId ? liveWriteBlocks(conversationId) : EMPTY_LIVE
  )
  return useMemo(
    () =>
      conversationId
        ? collectConversationArtifacts({
            messages,
            workdir,
            changeSetsById,
            liveBlocks
          })
        : [],
    [conversationId, messages, workdir, changeSetsById, liveBlocks]
  )
}
