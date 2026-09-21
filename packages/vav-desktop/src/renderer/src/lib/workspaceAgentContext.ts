import { isWorkspaceSession, type SessionKind } from '@shared/sessionKind'
import { useSessionStore } from '../state/sessionStore'

type WorkspaceAgentState = {
  activeId: string
  conversations: Array<{
    id: string
    workingDirectory?: string | null
    fileId?: string | null
    sessionKind?: SessionKind | null
    archived?: boolean
  }>
  workspaceAgentByPath: Record<string, string>
}

/** Workspace agent that owns composer / comment cards while an app object is open. */
export function workspaceAgentConversationIdFrom(state: WorkspaceAgentState): string | null {
  const current = state.conversations.find((row) => row.id === state.activeId)
  if (current && isWorkspaceSession(current) && state.activeId) return state.activeId
  const mapped = current?.workingDirectory
    ? state.workspaceAgentByPath[current.workingDirectory]
    : undefined
  if (mapped && state.conversations.some((row) => row.id === mapped)) return mapped
  return (
    state.conversations.find((row) => !row.archived && isWorkspaceSession(row))?.id ??
    state.activeId ??
    null
  )
}

export function workspaceAgentConversationId(): string | null {
  return workspaceAgentConversationIdFrom(useSessionStore.getState())
}

/** App-column canvases attach picks to the workspace agent, not the app object. */
export function appColumnPickConversationId(
  hideAgent: boolean,
  objectConversationId: string
): string {
  if (!hideAgent) return objectConversationId
  return workspaceAgentConversationId() ?? objectConversationId
}

/** Point the workspace agent at the file / data / knowledge path currently in the app column. */
export function syncWorkspaceAgentFocusedPath(path: string | null | undefined): void {
  const trimmed = path?.trim() || null
  const agentId = workspaceAgentConversationId()
  if (!agentId || !trimmed) return
  void useSessionStore.getState().attachContextFile(agentId, trimmed)
}
