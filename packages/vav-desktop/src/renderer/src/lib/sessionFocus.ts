import type { CliOpenEvent } from '@shared/ipc'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { focusBashPane, setUiFocusScope } from './uiFocus'

/**
 * After the session is selected (main) or already active (detached companion),
 * put the correct surface in front: Tools bash, or VAV composer.
 *
 * Used by tray clicks, notifications, and path open. Does not select the
 * conversation itself — callers do that when needed (main window list).
 */
export async function applySessionSurfaceFocus(event: CliOpenEvent): Promise<void> {
  const id = event.conversationId
  if (!id) return

  // Ensure live PTYs are projected before we flip mode / pick a tab.
  await useWorkspaceStore.getState().hydratePtyState(id)

  if (event.surface === 'bash') {
    if (event.tabId) {
      useWorkspaceStore.getState().selectTab(id, event.tabId)
    }
    useSessionStore.getState().setPanelSegment('terminal')
    focusBashPane(event.tabId)
    return
  }

  setUiFocusScope('app')
  useSessionStore.getState().focusComposer()
}
