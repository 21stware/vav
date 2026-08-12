import type { CliOpenEvent } from '@shared/ipc'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { focusAgentPane, setUiFocusScope } from './uiFocus'

/**
 * After the session is selected (main) or already active (detached companion),
 * put the correct surface in front: CLI Agents + pane, or VAV composer.
 *
 * Used by tray clicks, notifications, and CLI/path open. Does not select the
 * conversation itself — callers do that when needed (main window list).
 */
export async function applySessionSurfaceFocus(event: CliOpenEvent): Promise<void> {
  const id = event.conversationId
  if (!id) return

  const wantCli =
    event.surface === 'cli' || !!event.tabId || (!!event.agentId && event.surface !== 'vav')

  // Ensure live PTYs are projected before we flip mode / pick a tab.
  await useWorkspaceStore.getState().hydratePtyState(id)

  if (wantCli) {
    const ws = useWorkspaceStore.getState()
    ws.enterCliMode(id)
    if (event.tabId) {
      ws.selectAgentTab(id, event.tabId)
      focusAgentPane(id, event.tabId)
    } else if (event.agentId) {
      ws.focusAgentHost(id, event.agentId)
      focusAgentPane(id)
    } else {
      focusAgentPane(id)
    }
    setUiFocusScope('agent')
    return
  }

  // VAV chat — leave CLI Screen if open so composer/chrome match.
  const slice = useWorkspaceStore.getState().workspaces[id]
  if (slice?.cliMode) {
    useWorkspaceStore.getState().exitCliMode(id)
  }
  setUiFocusScope('app')
  useSessionStore.getState().focusComposer()
}
