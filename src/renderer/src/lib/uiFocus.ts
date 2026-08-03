import { tt } from '../i18n/useT'
import { disposeTerminal } from './terminalRegistry'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'

/**
 * UI focus scopes for context-sensitive shortcuts (⌘W, …).
 *
 * - `bash` — tools-tray Terminal (user shells)
 * - `files` — tools-tray Files / workspace browser
 * - `agent` — main-surface CLI agent host
 * - `app` — composer, transcript, sidebar, and everything else
 */
export type UiFocusScope = 'bash' | 'files' | 'agent' | 'app'

let scope: UiFocusScope = 'app'
const listeners = new Set<(scope: UiFocusScope) => void>()

export function getUiFocusScope(): UiFocusScope {
  return scope
}

export function setUiFocusScope(next: UiFocusScope): void {
  if (scope === next) return
  scope = next
  for (const listener of listeners) listener(scope)
}

export function subscribeUiFocus(listener: (scope: UiFocusScope) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function isBashTab(tab: { agentId?: string | null; isAgent?: boolean } | undefined): boolean {
  if (!tab) return false
  return !tab.agentId || tab.agentId === 'vav' || !!tab.isAgent
}

/**
 * Map the focused DOM node to a product region.
 * Tools-tray chrome (path chip / bash chips) uses the active panel segment so
 * ⌘W still targets Bash vs Files when focus sits on a chip button.
 */
export function resolveUiFocusScope(target: EventTarget | null): UiFocusScope {
  const el = target instanceof Element ? target : null
  if (!el) return 'app'

  // Tools tray (Files + Bash) — including header chips.
  if (el.closest('.tools-panel')) {
    const session = useSessionStore.getState()
    if (session.toolsCollapsed) return 'app'
    return session.panelSegment === 'terminal' ? 'bash' : 'files'
  }

  // Main-surface agent host (SessionDetail terminal area, not tools tray).
  if (el.closest('.terminal-host-main') || el.closest('[data-terminal-surface="agent"]')) {
    return 'agent'
  }

  // Detached session / preview-edit agent host without the main wrapper class.
  if (el.closest('.xterm-helper-textarea') || el.closest('.xterm')) {
    // Prefer tools-panel (handled above). Remaining xterm = agent surface.
    if (!el.closest('.tools-panel')) return 'agent'
  }

  return 'app'
}

function closeBashTab(conversationId: string, tabId: string, title: string): void {
  const dispose = (): void => {
    disposeTerminal(conversationId, tabId)
    useWorkspaceStore.getState().closeTab(conversationId, tabId)
  }
  void (async () => {
    const busy = await window.vav.pty.isBusy(tabId)
    if (!busy) {
      dispose()
      return
    }
    useSessionStore.getState().showDialog({
      title: tt('tools.closeRunning'),
      body: tt('tools.closeRunningBody', { title }),
      confirmLabel: tt('tools.closeConfirm'),
      destructive: true,
      onConfirm: dispose
    })
  })()
}

function closeActiveBash(conversationId: string): boolean {
  const session = useSessionStore.getState()
  const ws = useWorkspaceStore.getState().workspaces[conversationId]
  const tabs = (ws?.tabs ?? []).filter((t) => isBashTab(t))
  const tabId = (ws?.activeTabId && tabs.some((t) => t.id === ws.activeTabId)
    ? ws.activeTabId
    : tabs[0]?.id) ?? ''

  if (!tabId) {
    // Terminal segment open but no shell — collapse tray.
    if (!session.toolsCollapsed) {
      session.setToolsCollapsed(true)
      return true
    }
    return false
  }

  const tab = tabs.find((t) => t.id === tabId)
  closeBashTab(conversationId, tabId, tab?.title ?? 'Shell')
  return true
}

function closeActiveAgentTab(conversationId: string): boolean {
  const ws = useWorkspaceStore.getState().workspaces[conversationId]
  const agentId = ws?.activeHostAgentId
  const host = agentId ? ws?.agentHostSessions[agentId] : null
  const tabs = host?.tabs ?? []
  const activeTab = host?.activeTabId ?? ''
  if (tabs.length > 1 && activeTab) {
    useWorkspaceStore.getState().closeAgentTab(conversationId, activeTab)
    return true
  }
  return false
}

/**
 * Context-sensitive “close” (⌘W / menu Close).
 * Returns true when the shortcut was consumed by the focused region;
 * false means the caller should close / hide the window.
 *
 * Rules:
 * - Bash UI → close active bash tab (confirm if busy); empty → collapse tray
 * - Files UI → collapse tools tray
 * - Agent host with multiple panes → close active agent pane
 * - Otherwise → window close
 */
export function handleContextClose(): boolean {
  // Re-resolve from the live active element so we stay correct even if a
  // focusin was missed (e.g. xterm helper textarea timing).
  const live = resolveUiFocusScope(document.activeElement)
  if (live !== scope) setUiFocusScope(live)

  const session = useSessionStore.getState()
  const id = session.activeId

  switch (scope) {
    case 'bash':
      if (!id) return false
      return closeActiveBash(id)
    case 'files':
      if (!session.toolsCollapsed) {
        session.setToolsCollapsed(true)
        return true
      }
      return false
    case 'agent':
      if (!id) return false
      return closeActiveAgentTab(id)
    case 'app':
    default:
      return false
  }
}

/** Close / hide the current BrowserWindow (macOS main hides; companions quit). */
export function closeCurrentWindow(): void {
  window.close()
}

/**
 * Track focusin so product shortcuts know which region owns the keyboard.
 * Install once per renderer (main App + SessionWindow).
 */
export function installUiFocusTracking(): () => void {
  const refresh = (target: EventTarget | null = document.activeElement): void => {
    setUiFocusScope(resolveUiFocusScope(target))
  }
  const onFocusIn = (event: FocusEvent): void => {
    refresh(event.target)
  }
  // Capture so we see focus moves into xterm’s hidden textarea.
  document.addEventListener('focusin', onFocusIn, true)
  // Segment / collapse chips often keep the same button focused — re-resolve
  // when tools tray state changes so ⌘W tracks Files vs Bash correctly.
  const unsubStore = useSessionStore.subscribe((state, prev) => {
    if (!prev) return
    if (
      state.panelSegment !== prev.panelSegment ||
      state.toolsCollapsed !== prev.toolsCollapsed
    ) {
      refresh()
    }
  })
  refresh()
  return () => {
    document.removeEventListener('focusin', onFocusIn, true)
    unsubStore()
  }
}
