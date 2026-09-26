import { useCallback, useEffect, useState } from 'react'
import type { KnowledgeHost } from '@shared/knowledge'
import { useSessionStore } from '../../state/sessionStore'

export function useKnowledgeHost(conversationId: string | null | undefined): KnowledgeHost | null {
  const hostId = useSessionStore((s) =>
    conversationId
      ? (s.conversations.find((row) => row.id === conversationId)?.knowledgeHostId ?? null)
      : null
  )
  const [host, setHost] = useState<KnowledgeHost | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (!window.vav?.knowledge || !conversationId) {
      setHost(null)
      return
    }
    const next = hostId
      ? await window.vav.knowledge.get(hostId)
      : await window.vav.knowledge.getForConversation(conversationId)
    setHost(next ?? null)
  }, [conversationId, hostId])

  useEffect(() => {
    void load()
    if (!conversationId) return
    return window.vav.knowledge?.onChanged(() => {
      void load()
    })
  }, [conversationId, load])

  useEffect(() => {
    return window.vav?.agent?.onEvent((event) => {
      if (event.type !== 'knowledge-draft' || !event.title) return
      setHost((prev) => {
        if (!prev || prev.id !== event.hostId || prev.title === event.title) return prev
        return { ...prev, title: event.title! }
      })
    })
  }, [])

  return host
}
