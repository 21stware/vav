import { isWorkspaceSession, type SessionKind } from '@shared/sessionKind'
import {
  appColumnFilePath,
  appColumnFocusForSend,
  resolveAppColumnContext
} from './appColumnContext'
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

/**
 * Point the workspace agent at the current app column.
 * A highlighted object is the send target even if the editor is not open.
 */
export async function syncWorkspaceAgentAppFocus(pathOverride?: string | null): Promise<void> {
  const agentId = workspaceAgentConversationId()
  if (!agentId) return
  const store = useSessionStore.getState()
  const context = resolveAppColumnContext(store)
  const object = context?.objectId
    ? store.conversations.find((row) => row.id === context.objectId)
    : undefined
  const focus = store.applicationsVisible ? appColumnFocusForSend(context, object) : null
  const derivedPath =
    focus && focus.level !== 'list' ? focus.path : appColumnFilePath(context, object)
  const nextPath = store.applicationsVisible
    ? (pathOverride !== undefined ? pathOverride?.trim() || null : derivedPath)
    : null
  const leftover = store.contextFiles[agentId]
  if (leftover && nextPath && leftover === nextPath) {
    useSessionStore.setState({
      contextFiles: { ...store.contextFiles, [agentId]: null }
    })
  }
  await Promise.all([
    store.setFocusedFile(agentId, nextPath),
    store.setFocusedDbTable(agentId, focus?.table ?? null),
    store.setAppColumnFocus(agentId, focus)
  ])
}

/** @deprecated Use {@link syncWorkspaceAgentAppFocus}. */
export function syncWorkspaceAgentFocusedPath(path?: string | null | undefined): void {
  void syncWorkspaceAgentAppFocus(path)
}
