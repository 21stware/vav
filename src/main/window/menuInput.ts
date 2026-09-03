/** Debounce twin fires (menu accelerator + before-input, or key repeat). */

export function menuCommandDebounceMs(command: string): number {
  // close-context needs a longer window: before-input + menu often arrive
  // >80ms apart, and the second stroke used to close the window right after
  // Swarm reseeding the agent picker.
  return command === 'close-context' ? 400 : 80
}

export function shouldSkipDuplicateMenuCommand(
  command: string,
  lastCommand: string | null,
  now: number,
  lastAt: number
): boolean {
  return command === lastCommand && now - lastAt < menuCommandDebounceMs(command)
}

/** ⌥⌘I / Ctrl+Shift+I — keep DevTools reachable when the View menu item is missing. */
export function isToggleDevtoolsChord(
  input: {
    type: string
    key: string
    meta: boolean
    alt: boolean
    control: boolean
    shift: boolean
  },
  platform: NodeJS.Platform
): boolean {
  if (input.type !== 'keyDown' || (input.key !== 'I' && input.key !== 'i')) return false
  if (platform === 'darwin') return input.meta && input.alt && !input.control
  return input.control && input.shift && !input.meta
}
