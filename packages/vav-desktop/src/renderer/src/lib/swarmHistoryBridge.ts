import { useWorkspaceStore } from '../state/workspaceStore'

/** Resume a recorded Swarm session into the window that opened History. */
export function installSwarmHistoryBridge(): () => void {
  if (!window.vav?.window?.onSwarmHistoryResume) return () => undefined
  return window.vav.window.onSwarmHistoryResume((payload) => {
    if (!payload?.conversationId || !payload.agentId || !payload.cursor) return
    void useWorkspaceStore.getState().resumeCliSession(payload.conversationId, {
      agentId: payload.agentId,
      cursor: payload.cursor,
      title: payload.title
    })
  })
}
