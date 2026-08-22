/**
 * Whether recent PTY stdout should flip a tab to `running`.
 *
 * CLI agent TUIs often have no child processes while they spin (network wait).
 * Tools-tray bash echoes every keystroke — that is not a running command.
 */
export function ptyOutputImpliesRunning(agentId: string | null | undefined): boolean {
  return agentId != null
}
