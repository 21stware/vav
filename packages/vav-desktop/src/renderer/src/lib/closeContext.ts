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
 *
 * Multi-conversation Swarm (2+ visible panes) captures ⌘W from the session
 * surface (composer / transcript / agent) so each stroke closes one pane.
 * The last remaining conversation falls through to the window.
 * Bash / Files still win when that tray owns focus.
 */
export function resolveContextCloseAction(input: {
  focus: ContextCloseFocus
  cliMode: boolean
  paneCount: number
  soleTabIsPending: boolean
  toolsCollapsed: boolean
  /** Visible Thread/Swarm conversation panes on the current root. */
  swarmPaneCount?: number
}): ContextCloseAction {
  const solePicker = input.cliMode && input.paneCount === 1 && input.soleTabIsPending
  const multiSwarm = (input.swarmPaneCount ?? 0) > 1

  switch (input.focus) {
    case 'bash':
      return 'bash'
    case 'files':
      if (!input.toolsCollapsed) return 'files'
      return multiSwarm ? 'agent' : 'window'
    case 'agent':
      if (multiSwarm) return 'agent'
      // Last remaining picker: do not keep capturing. Window close is the product.
      if (solePicker) return 'window'
      return hasClosableCliPanes(input.paneCount, input.soleTabIsPending) ? 'agent' : 'window'
    default:
      return multiSwarm ? 'agent' : 'window'
  }
}
