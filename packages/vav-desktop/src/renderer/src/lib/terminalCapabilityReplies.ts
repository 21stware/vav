import type { Terminal } from '@xterm/xterm'
import { KITTY_KEYBOARD_QUERY_REPLY } from '@shared/terminalOscColor'

type TerminalOptionsWithKitty = {
  vtExtensions?: { kittyKeyboard?: boolean }
}

/**
 * xterm 6.1 advertises Kitty keyboard via `vtExtensions`. 6.0 does not — answer
 * `CSI ? u` ourselves so Grok still enables the protocol for Shift+Enter.
 */
export function installKittyKeyboardFallback(
  term: Terminal,
  writePty: (data: string) => void,
  isReplaying: () => boolean
): void {
  const opts = term.options as TerminalOptionsWithKitty
  if (opts.vtExtensions?.kittyKeyboard) return
  term.parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => {
    if (!isReplaying()) writePty(KITTY_KEYBOARD_QUERY_REPLY)
    return true
  })
}
