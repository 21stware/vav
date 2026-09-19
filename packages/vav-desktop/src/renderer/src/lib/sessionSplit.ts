import { prettyAccelerator, resolveKeyBindings } from '@shared/keyBindings'
import { tt } from '../i18n/useT'
import { PLATFORM } from './platform'
import { showMenu } from './nativeMenu'
import { useSessionStore } from '../state/sessionStore'
import { CLI_SURFACE_KEY, useWorkspaceStore } from '../state/workspaceStore'
import { focusAgentPane, setUiFocusScope } from './uiFocus'

/** Focus the first CLI agent option inside a pending pane after a split. */
export function focusCliAgentPickerFirstOption(_conversationId: string, tabId?: string): void {
  const apply = (attempt: number): void => {
    const root = tabId
      ? document.querySelector(
          `[data-cli-pane="${CSS.escape(tabId)}"]:not(.is-surface-parked) .cli-agent-picker`
        )
      : document.querySelector(
          `.terminal-host-main:not(.is-surface-parked) [data-terminal-surface="agent"] .cli-agent-picker`
        )
    const first = root?.querySelector('.cli-agent-picker-item') as HTMLButtonElement | null
    if (!first) {
      if (attempt < 12) requestAnimationFrame(() => apply(attempt + 1))
      return
    }
    if (document.activeElement !== first && attempt < 12) {
      setUiFocusScope('agent')
      try {
        first.focus({ preventScroll: true })
      } catch {
        first.focus()
      }
      requestAnimationFrame(() => apply(attempt + 1))
      return
    }
    setUiFocusScope('agent')
    try {
      first.focus({ preventScroll: true })
    } catch {
      first.focus()
    }
  }
  requestAnimationFrame(() => apply(0))
}

/** Split CLI Screen and move keyboard focus to the new pane’s first agent. */
export function splitCliAndFocusPicker(
  conversationId: string,
  axis: 'row' | 'column'
): void {
  if (!conversationId) return
  useWorkspaceStore.getState().splitCliSurface(conversationId, axis)
  const host =
    useWorkspaceStore.getState().workspaces[conversationId]?.agentHostSessions[CLI_SURFACE_KEY]
  const pendingId = host?.activeTabId
  if (!pendingId) return
  focusAgentPane(conversationId, pendingId)
  focusCliAgentPickerFirstOption(conversationId, pendingId)
}

export function canSplitSession(conversationId: string): boolean {
  if (!conversationId) return false
  const store = useSessionStore.getState()
  if (store.pictureInPicture) return false
  const conversation = store.conversations.find((row) => row.id === conversationId)
  if (!conversation || conversation.fileId || conversation.archived) return false
  return true
}

export function splitSessionPane(conversationId: string, axis: 'row' | 'column'): void {
  if (!canSplitSession(conversationId)) return
  const cliMode = !!useWorkspaceStore.getState().workspaces[conversationId]?.cliMode
  if (cliMode) splitCliAndFocusPicker(conversationId, axis)
  else void useSessionStore.getState().splitSwarmPane(axis)
}

/** Right-click blank session chrome — not messages, inputs, or chrome controls. */
export function isSessionSplitMenuTarget(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  if (!el) return false
  return !el.closest(
    'textarea, input, select, [contenteditable="true"], .message-turn, .composer, .agent-model-picker, .btn, button, a, .terminal-split-pane-close, .xterm, .cli-agent-picker-item'
  )
}

export function openSessionSplitMenu(
  conversationId: string,
  position: { x: number; y: number }
): void {
  if (!canSplitSession(conversationId)) return
  const bindings = resolveKeyBindings(useSessionStore.getState().settings.keyBindings)
  const right = prettyAccelerator(bindings.splitPaneRight, PLATFORM)
  const down = prettyAccelerator(bindings.splitPaneDown, PLATFORM)
  void showMenu(
    [
      {
        label: right ? `${tt('agents.splitRight')}  ${right}` : tt('agents.splitRight'),
        onSelect: () => splitSessionPane(conversationId, 'row')
      },
      {
        label: down ? `${tt('agents.splitDown')}  ${down}` : tt('agents.splitDown'),
        onSelect: () => splitSessionPane(conversationId, 'column')
      }
    ],
    position
  )
}

export function handleSessionSplitContextMenu(
  event: { target: EventTarget | null; clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
  conversationId: string
): boolean {
  if (!canSplitSession(conversationId) || !isSessionSplitMenuTarget(event.target)) return false
  event.preventDefault()
  event.stopPropagation()
  openSessionSplitMenu(conversationId, { x: event.clientX, y: event.clientY })
  return true
}
