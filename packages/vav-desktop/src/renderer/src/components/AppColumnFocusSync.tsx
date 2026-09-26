import { useEffect } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { syncWorkspaceAgentAppFocus } from '../lib/workspaceAgentContext'
import { useKnowledgeHost } from './knowledge/useKnowledgeHost'
import type { ApplicationsMode } from '../state/sessionTypes'

/** Isolated so comment-card / focus writes do not re-render the app column tree. */
export function AppColumnFocusSync({
  mode,
  conversationId,
  previewPath,
  storagePath,
  showingDetail
}: {
  mode: ApplicationsMode
  conversationId: string | null
  previewPath: string | null
  storagePath: string | null
  showingDetail: boolean
}): null {
  const applicationsVisible = useSessionStore((s) => s.applicationsVisible)
  const focusedAppObjectId = useSessionStore((s) => s.focusedAppObjectId)
  const activeDbTable = useSessionStore((s) => s.activeDbTable)
  const filesSource = useSessionStore((s) => s.filesSource)
  const storageBrowsePath = useSessionStore((s) => s.storageBrowsePath)
  const filePreviewOpen = useSessionStore((s) => s.filePreviewOpen)
  const commentCardKey = useSessionStore((s) => {
    const cards = s.commentCards[s.activeId] ?? []
    return `${cards.length}:${cards[0]?.ref.id ?? ''}:${cards[0]?.ref.label ?? ''}`
  })
  const knowledgeHost = useKnowledgeHost(mode === 'knowledge' ? conversationId : null)
  const setFocusedFile = useSessionStore((s) => s.setFocusedFile)

  useEffect(() => {
    if (mode !== 'knowledge' || !conversationId || !knowledgeHost) return
    const path = knowledgeHost.storedPath ?? knowledgeHost.sourcePath
    if (path) void setFocusedFile(conversationId, path)
  }, [conversationId, knowledgeHost, mode, setFocusedFile])

  useEffect(() => {
    void syncWorkspaceAgentAppFocus()
  }, [
    applicationsVisible,
    showingDetail,
    mode,
    storagePath,
    previewPath,
    conversationId,
    knowledgeHost?.storedPath,
    knowledgeHost?.sourcePath,
    focusedAppObjectId,
    activeDbTable,
    filesSource,
    storageBrowsePath,
    filePreviewOpen,
    commentCardKey
  ])

  return null
}
