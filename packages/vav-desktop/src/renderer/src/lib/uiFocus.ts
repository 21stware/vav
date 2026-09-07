import { collectSwarmLeaves, swarmLeaf, swarmRootId } from '@shared/swarmLayout'
import { tt } from '../i18n/useT'
import { resolveContextCloseAction } from './closeContext'
import { disposeTerminal } from './terminalRegistryHandle'
import { useSessionStore } from '../state/sessionStore'
import { CLI_SURFACE_KEY, useWorkspaceStore } from '../state/workspaceStore'

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

  // Swarm content only (PTY / picker / split). Title-bar chrome is not Swarm.
  if (
    el.closest('.session-swarm-split') ||
    el.closest('.terminal-host-main') ||
    el.closest('[data-terminal-surface="agent"]') ||
    el.closest('.cli-agent-picker') ||
    el.closest('.terminal-split-pane')
  ) {
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

function getAgentHostForConversation(conversationId: string) {
  const ws = useWorkspaceStore.getState().workspaces[conversationId]
  if (!ws) return null
  return (
    ws.agentHostSessions[CLI_SURFACE_KEY] ??
    (ws.activeHostAgentId ? (ws.agentHostSessions[ws.activeHostAgentId] ?? null) : null)
  )
}

function isCliMode(conversationId: string): boolean {
  return !!useWorkspaceStore.getState().workspaces[conversationId]?.cliMode
}

/**
 * Focus a CLI Screen pane by tab id (or the active/first pane).
 * Retries a few frames so React can paint after enterCliMode / selectAgentTab.
 */
export function focusAgentPane(conversationId: string, preferredTabId?: string): void {
  const host = getAgentHostForConversation(conversationId)
  if (!host?.tabs.length) {
    setUiFocusScope('agent')
    return
  }
  const tabId =
    (preferredTabId && host.tabs.some((t) => t.id === preferredTabId)
      ? preferredTabId
      : host.activeTabId && host.tabs.some((t) => t.id === host.activeTabId)
        ? host.activeTabId
        : host.tabs[0]?.id) ?? ''
  if (!tabId) {
    setUiFocusScope('agent')
    return
  }

  setUiFocusScope('agent')

  const apply = (attempt: number): void => {
    // Re-read host after paint — layout may have just committed.
    const live = getAgentHostForConversation(conversationId)
    const id =
      (preferredTabId && live?.tabs.some((t) => t.id === preferredTabId)
        ? preferredTabId
        : live?.activeTabId && live.tabs.some((t) => t.id === live.activeTabId)
          ? live.activeTabId
          : live?.tabs[0]?.id) || tabId
    const pane = document.querySelector(
      `[data-cli-pane="${CSS.escape(id)}"]`
    ) as HTMLElement | null
    if (!pane) {
      // Zustand updates sync, React paint may lag — retry a couple frames.
      if (attempt < 8) {
        requestAnimationFrame(() => apply(attempt + 1))
        return
      }
      setUiFocusScope('agent')
      return
    }
    // Prefer live xterm (typing) over a residual picker button.
    const ta = pane.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    const selectedOpt = pane.querySelector(
      '.cli-agent-picker-item[aria-selected="true"]'
    ) as HTMLButtonElement | null
    const firstOpt = pane.querySelector('.cli-agent-picker-item') as HTMLButtonElement | null
    try {
      if (ta) ta.focus({ preventScroll: true })
      else if (selectedOpt) selectedOpt.focus({ preventScroll: true })
      else if (firstOpt) firstOpt.focus({ preventScroll: true })
      else pane.focus({ preventScroll: true })
    } catch {
      // ignore
    }
    setUiFocusScope('agent')
  }

  // enterCliMode / closeAgentTab → React commit → xterm re-attach.
  requestAnimationFrame(() => apply(0))
}

/**
 * Focus a tools-tray bash pane by tab id (or the first bash xterm).
 * Retries a few frames so React can paint after expanding Tools → Terminal.
 */
export function focusBashPane(preferredTabId?: string): void {
  setUiFocusScope('bash')
  const apply = (attempt: number): void => {
    const pane = preferredTabId
      ? (document.querySelector(
          `[data-bash-pane="${CSS.escape(preferredTabId)}"]`
        ) as HTMLElement | null)
      : (document.querySelector('.tools-body [data-bash-pane]') as HTMLElement | null)
    const ta = (pane?.querySelector('.xterm-helper-textarea') ??
      document.querySelector('.tools-body .xterm-helper-textarea')) as HTMLTextAreaElement | null
    if (!ta) {
      if (attempt < 8) {
        requestAnimationFrame(() => apply(attempt + 1))
        return
      }
      return
    }
    try {
      ta.focus({ preventScroll: true })
    } catch {
      ta.focus()
    }
    setUiFocusScope('bash')
  }
  requestAnimationFrame(() => apply(0))
}

/**
 * Put keyboard focus back on the remaining CLI pane so sequential ⌘W keeps
 * closing panes instead of falling through to window-close.
 * Call after any pane close (⌘W or the multi-pane X button).
 */
export function focusRemainingAgentPane(conversationId: string): void {
  focusAgentPane(conversationId)
}

/** One native sheet at a time — ⌘W + pane X must not stack confirms. */
let agentCloseConfirming = false

function finishCloseAgentTab(conversationId: string, tabId: string): void {
  const host = getAgentHostForConversation(conversationId)
  const tab = host?.tabs.find((t) => t.id === tabId)
  if (!tab) return
  useWorkspaceStore.getState().closeAgentTab(conversationId, tabId)
  focusRemainingAgentPane(conversationId)
}

/**
 * Close a CLI Screen pane. Live agent sessions confirm first (killing the PTY
 * drops the TUI conversation). Pending pickers close immediately.
 */
export function requestCloseAgentTab(conversationId: string, tabId: string): boolean {
  const host = getAgentHostForConversation(conversationId)
  const tab = host?.tabs.find((t) => t.id === tabId)
  if (!tab) return false

  if (tab.pendingCli) {
    finishCloseAgentTab(conversationId, tabId)
    return true
  }

  if (agentCloseConfirming) return true
  agentCloseConfirming = true
  const name = tab.title.trim() || tt('agents.selector')
  void window.vav.dialog
    .confirm({
      title: tt('agents.closeSession'),
      message: tt('agents.closeSessionBody', { name }),
      confirmLabel: tt('common.close'),
      cancelLabel: tt('common.cancel'),
      destructive: true
    })
    .then((ok) => {
      if (ok) finishCloseAgentTab(conversationId, tabId)
    })
    .finally(() => {
      agentCloseConfirming = false
    })
  return true
}

function closeActiveAgentTab(conversationId: string): boolean {
  const host = getAgentHostForConversation(conversationId)
  if (!host?.tabs.length) return false
  const activeTab =
    (host.activeTabId && host.tabs.some((t) => t.id === host.activeTabId)
      ? host.activeTabId
      : host.tabs[0]?.id) ?? ''
  if (!activeTab) return false
  const tab = host.tabs.find((t) => t.id === activeTab) ?? host.tabs[0]
  // Only a picker left → ⌘W closes the window (do not reseed another picker).
  if (host.tabs.length === 1 && tab?.pendingCli) return false

  return requestCloseAgentTab(conversationId, activeTab)
}

/**
 * Context-sensitive “close” (⌘W / menu Close).
 * Returns true when the shortcut was consumed by the focused region;
 * false means the caller should close / hide the window.
 *
 * Rules:
 * - Bash UI → close active bash tab (confirm if busy); empty → collapse tray
 * - Files UI → collapse tools tray
 * - Multi-pane Swarm (composer / transcript / agent) → close one conversation
 * - Last remaining conversation, or sole picker → window
 */
export function handleContextClose(): boolean {
  // Re-resolve from the live active element so we stay correct even if a
  // focusin was missed (e.g. xterm helper textarea timing).
  const live = resolveUiFocusScope(document.activeElement)
  if (live !== scope) setUiFocusScope(live)

  const session = useSessionStore.getState()
  const id = session.activeId
  const host = id ? getAgentHostForConversation(id) : null
  const cliMode = id ? isCliMode(id) : false
  const family = id ? session.conversations.find((c) => c.id === id) : undefined
  const rootId = id ? swarmRootId(id, family?.swarmParentId) : ''
  const root = rootId ? session.conversations.find((c) => c.id === rootId) : undefined
  const swarmLeaves = rootId
    ? collectSwarmLeaves(root?.swarmLayout ?? swarmLeaf(rootId))
    : []
  const action = resolveContextCloseAction({
    focus: scope,
    cliMode,
    paneCount: host?.tabs.length ?? 0,
    soleTabIsPending: host?.tabs.length === 1 && host.tabs[0]?.pendingCli === true,
    toolsCollapsed: session.toolsCollapsed,
    swarmPaneCount: session.settings.swarmModeEnabled ? swarmLeaves.length : 0
  })

  switch (action) {
    case 'bash': {
      if (!id) return false
      return closeActiveBash(id)
    }
    case 'files': {
      session.setToolsCollapsed(true)
      return true
    }
    case 'agent': {
      if (!id) return false
      if (session.settings.swarmModeEnabled && swarmLeaves.length > 1) {
        void session.closeSwarmPane(id)
        return true
      }
      setUiFocusScope('agent')
      return closeActiveAgentTab(id)
    }
    case 'window':
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
