import { focusAgentPane } from './uiFocus'
import { isCompanionSessionShell } from './windowKind'
import { isCliSurfaceLocked } from './cliSurfaceAuthority'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import { CLI_SURFACE_KEY, useWorkspaceStore } from '../state/workspaceStore'

/** Thread has no user/assistant turns — the only time Swarm can be entered. */
export function threadIsEmpty(conversationId: string): boolean {
  if (!conversationId) return false
  return visibleMessages(useSessionStore.getState(), conversationId).length === 0
}

/** One empty Swarm picker and nothing else — the only place Thread is offered. */
export function isSoleEmptyCliPicker(conversationId: string): boolean {
  if (!conversationId) return false
  const ws = useWorkspaceStore.getState().workspaces[conversationId]
  if (!ws?.cliMode) return false
  const host =
    ws.agentHostSessions[CLI_SURFACE_KEY] ??
    (ws.activeHostAgentId ? ws.agentHostSessions[ws.activeHostAgentId] : undefined)
  if (!host || host.tabs.length === 0) return true
  return host.tabs.length === 1 && !!host.tabs[0]?.pendingCli
}

/**
 * Surfaces are exclusive per conversation. After a Thread has messages or
 * Swarm has a live pane, the other mode is not available on this session.
 */
export function canSwitchCliSurface(conversationId: string, wantCli: boolean): boolean {
  if (!conversationId) return false
  if (wantCli) return threadIsEmpty(conversationId)
  return isSoleEmptyCliPicker(conversationId)
}

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
    if (!canSwitchCliSurface(id, want)) return
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
