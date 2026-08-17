export type ContextCloseFocus = 'bash' | 'files' | 'agent' | 'app'
export type ContextCloseAction = 'window' | 'agent' | 'bash' | 'files'

/**
 * True when a Swarm pane can still consume ⌘W (multi-pane or last live agent).
 * Sole pending picker is not closable — the next stroke closes the window.
 */
export function hasClosableCliPanes(
  paneCount: number,
  soleTabIsPending: boolean | undefined
): boolean {
  if (paneCount <= 0) return false
  if (paneCount > 1) return true
  return soleTabIsPending !== true
}

/**
 * Route ⌘W / menu Close.
 * Swarm only captures when the agent surface itself is focused.
 * Sidebar / chrome / body close the window — no agent confirm.
 */
export function resolveContextCloseAction(input: {
  focus: ContextCloseFocus
  cliMode: boolean
  paneCount: number
  soleTabIsPending: boolean
  toolsCollapsed: boolean
}): ContextCloseAction {
  const solePicker = input.cliMode && input.paneCount === 1 && input.soleTabIsPending

  switch (input.focus) {
    case 'bash':
      return 'bash'
    case 'files':
      return input.toolsCollapsed ? 'window' : 'files'
    case 'agent':
      // Last remaining picker: do not keep capturing. Window close is the product.
      if (solePicker) return 'window'
      return hasClosableCliPanes(input.paneCount, input.soleTabIsPending) ? 'agent' : 'window'
    default:
      return 'window'
  }
}
