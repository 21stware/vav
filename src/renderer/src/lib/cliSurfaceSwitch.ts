import { focusAgentPane } from './uiFocus'
import { isCompanionSessionShell } from './windowKind'
import { isCliSurfaceLocked } from './cliSurfaceAuthority'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'

let raf = 0
let pendingId: string | null = null
let pendingWant: boolean | null = null

/**
 * Coalesce Thread ↔ Swarm toggles to the latest intent.
 * enter/exit themselves stay sync for hydrate / split / assign.
 */
export function requestCliSurface(conversationId: string, wantCli: boolean): void {
  if (!conversationId) return
  if (
    isCliSurfaceLocked(
      conversationId,
      useSessionStore.getState().detachedConversationIds,
      isCompanionSessionShell()
    )
  ) {
    return
  }
  pendingId = conversationId
  pendingWant = wantCli
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const id = pendingId
    const want = pendingWant
    pendingId = null
    pendingWant = null
    if (!id || want === null) return
    if (
      isCliSurfaceLocked(
        id,
        useSessionStore.getState().detachedConversationIds,
        isCompanionSessionShell()
      )
    ) {
      return
    }
    const ws = useWorkspaceStore.getState()
    if (!!ws.workspaces[id]?.cliMode === want) return
    if (want) {
      ws.enterCliMode(id)
      focusAgentPane(id)
    } else {
      const active = document.activeElement
      if (active instanceof HTMLElement && active.closest('.terminal-host-main')) {
        active.blur()
      }
      ws.exitCliMode(id)
    }
  })
}
