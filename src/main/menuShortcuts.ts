import type { MenuCommand } from '@shared/ipc'

/**
 * Map a Chromium/Electron keyboard input to a product MenuCommand.
 *
 * Used from `webContents` `before-input-event` so accelerators still fire when
 * focus sits in xterm’s hidden textarea (menu accelerators alone are unreliable
 * there — the terminal steals the key before the native menu can act).
 */
export function menuCommandFromInput(input: Electron.Input): MenuCommand | null {
  if (input.type !== 'keyDown') return null

  const key = input.key
  const code = input.code
  const { control, alt, shift, meta } = input
  if (alt) return null

  // Control+` — tools-tray bash focus (menu accelerator is Control+`, not Cmd).
  if (
    control &&
    !meta &&
    !shift &&
    (key === '`' || key === '~' || code === 'Backquote')
  ) {
    return 'focus-bash'
  }

  // CmdOrCtrl family — Command on macOS, Control on Windows/Linux.
  const primary = process.platform === 'darwin' ? meta && !control : control && !meta
  if (!primary) return null

  const lower = key.length === 1 ? key.toLowerCase() : key

  if (shift && !control && lower === 'e') return 'toggle-tools-panel'
  if (shift && !control && lower === 'h') return 'toggle-sidebar'
  if (shift && !control && lower === 't') return 'toggle-panel-segment'
  if (shift && !control && lower === 'o') return 'switch-workdir'
  if (shift && !control && (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter')) {
    // New detached session is handled by globalShortcut; skip here.
    return null
  }
  if (shift && !control && lower === 'g') return 'find-previous'

  if (!shift) {
    if (lower === 'n') return 'new-conversation'
    if (lower === 'k' || lower === 'i') return 'focus-composer'
    if (lower === 'f') return 'find'
    if (lower === 'g') return 'find-next'
    if (lower === 't') return 'new-terminal'
    if (lower === 'w') return 'close-context'
    if (lower === ',' || code === 'Comma') return 'open-settings'
    if (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter') return 'send'
    // ⌘1…⌘9
    if (/^[1-9]$/.test(key)) {
      return `focus-tools-${key}` as MenuCommand
    }
    if (code.startsWith('Digit')) {
      const n = code.slice('Digit'.length)
      if (/^[1-9]$/.test(n)) return `focus-tools-${n}` as MenuCommand
    }
  }

  return null
}
