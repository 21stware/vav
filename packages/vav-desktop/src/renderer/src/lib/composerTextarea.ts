/** Idle floor / focused floor / hard ceiling (main-chat-search.rpml). */
export const COMPOSER_MIN_FOCUSED_ROWS = 3
export const COMPOSER_MAX_ROWS = 8
/** Scheduled-task editor: taller prompt, no send. */
export const SCHEDULE_MIN_ROWS = 10
export const SCHEDULE_MAX_ROWS = 24

/**
 * Grow the prompt to its content, then cap at {@link COMPOSER_MAX_ROWS}.
 * Measure `scrollHeight` while height is `auto` — after the cap, Chrome
 * reports a collapsed scrollHeight when overflow is hidden, which used to
 * lock the field at `overflow-y: hidden` so the wheel never scrolled.
 */
export function fitComposerTextarea(
  element: HTMLTextAreaElement,
  opts: {
    focused: boolean
    disabled: boolean
    lineHeight?: number
    minRows?: number
    maxRows?: number
  }
): void {
  const lineHeight =
    opts.lineHeight ?? (parseFloat(getComputedStyle(element).lineHeight) || 20)
  const minRows =
    opts.minRows ?? (opts.focused && !opts.disabled ? COMPOSER_MIN_FOCUSED_ROWS : 1)
  const minHeight = minRows * lineHeight
  const maxHeight = (opts.maxRows ?? COMPOSER_MAX_ROWS) * lineHeight
  element.style.height = 'auto'
  const contentHeight = element.scrollHeight
  element.style.height = `${Math.min(maxHeight, Math.max(minHeight, contentHeight))}px`
  element.style.overflowY = contentHeight > maxHeight + 1 ? 'auto' : 'hidden'
}

/** True when the wheel should stay on the textarea instead of the transcript. */
export function composerWheelStaysOnField(
  el: Pick<HTMLTextAreaElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  deltaY: number
): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false
  if (deltaY < 0) return el.scrollTop > 0
  if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1
  return false
}
