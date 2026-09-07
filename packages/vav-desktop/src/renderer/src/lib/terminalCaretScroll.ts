/**
 * xterm parks `.xterm-helper-textarea` on the cursor cell. IME (pinyin) and
 * leftover value make that box a real scrollport. Chromium then scrolls the
 * focused textarea — or a clipped ancestor to "reveal" the caret — so Swarm
 * wheel stays locked on the prompt and clicks miss the shifted grid.
 *
 * Bash still owns xterm's viewport / scrollable-element (real scrollback).
 * Agent TUIs have no app scrollback: those ports must stay pinned at 0.
 */

export function isXtermHelperTextarea(el: EventTarget | null): boolean {
  return el instanceof HTMLTextAreaElement && el.classList.contains('xterm-helper-textarea')
}

export function shouldClampCaretScroll(opts: {
  hasScroll: boolean
  focusedIsHelperTextarea: boolean
  scrolledContainsHelper: boolean
  scrolledIsHelperTextarea: boolean
  insideXterm: boolean
  insideTuiHost: boolean
}): boolean {
  if (!opts.hasScroll) return false
  if (!opts.focusedIsHelperTextarea) return false
  if (!opts.scrolledContainsHelper && !opts.scrolledIsHelperTextarea) return false
  if (opts.scrolledIsHelperTextarea) return true
  if (opts.insideTuiHost) return true
  if (opts.insideXterm) return false
  return true
}

export function clampScrolledElement(el: HTMLElement): void {
  el.scrollLeft = 0
  el.scrollTop = 0
}

export function caretScrollTargetFromEvent(event: Event): EventTarget | null {
  return event.target === document ? document.documentElement : event.target
}

/** Wheel on the helper textarea must not become its own scrollport. */
export function shouldBlockHelperTextareaWheel(target: EventTarget | null): boolean {
  return isXtermHelperTextarea(target)
}
