import type { MenuCommand } from '@shared/ipc'
import {
  acceleratorKeyBindingIds,
  matchesAccelerator,
  type ResolvedKeyBindings
} from '@shared/keyBindings'
import type { Platform } from '@shared/platform'

const PLATFORM = process.platform as Platform

/** Accelerator ids → menu command bus (newSessionWindow is handled separately). */
const KEY_BINDING_MENU_COMMAND: Partial<Record<keyof ResolvedKeyBindings, MenuCommand>> = {
  newSession: 'new-conversation',
  focusComposer: 'focus-composer',
  focusComposerAlt: 'focus-composer',
  sendMenu: 'send',
  toggleSidebar: 'toggle-sidebar',
  toggleTools: 'toggle-tools-panel',
  togglePanelSegment: 'toggle-panel-segment',
  focusBash: 'focus-bash',
  switchWorkdir: 'switch-workdir',
  switchCliMode: 'switch-cli-mode',
  switchVavMode: 'switch-vav-mode',
  switchModel: 'switch-model',
  switchApproval: 'switch-approval',
  screenshot: 'screenshot',
  closeContext: 'close-context',
  openSettings: 'open-settings',
  find: 'find',
  findNext: 'find-next',
  findPrevious: 'find-previous',
  newTerminal: 'new-terminal',
  focusTools1: 'focus-tools-1',
  focusTools2: 'focus-tools-2',
  focusTools3: 'focus-tools-3',
  focusTools4: 'focus-tools-4',
  focusTools5: 'focus-tools-5',
  focusTools6: 'focus-tools-6',
  focusTools7: 'focus-tools-7',
  focusTools8: 'focus-tools-8',
  focusTools9: 'focus-tools-9'
}

/**
 * Map a Chromium/Electron keyboard input to a product MenuCommand.
 *
 * Used from `webContents` `before-input-event` so accelerators still fire when
 * focus sits in xterm’s hidden textarea (menu accelerators alone are unreliable
 * there — the terminal steals the key before the native menu can act).
 */
export function menuCommandFromInput(
  input: Electron.Input,
  bindings: ResolvedKeyBindings
): MenuCommand | null {
  if (input.type !== 'keyDown') return null

  // Prefer longer chords first so Shift variants win over bare keys.
  const ids = acceleratorKeyBindingIds().sort(
    (a, b) => bindings[b].split('+').length - bindings[a].split('+').length
  )

  for (const id of ids) {
    if (id === 'newSessionWindow') continue
    if (!matchesAccelerator(input, bindings[id], PLATFORM)) continue
    const command = KEY_BINDING_MENU_COMMAND[id]
    if (command) return command
  }
  return null
}

/** True when the input matches the (possibly rebound) new-session-window chord. */
export function matchesNewSessionWindow(
  input: Electron.Input,
  bindings: ResolvedKeyBindings
): boolean {
  return matchesAccelerator(input, bindings.newSessionWindow, PLATFORM)
}
