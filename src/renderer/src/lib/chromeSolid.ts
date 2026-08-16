/** Scroll distance over which the overlay chrome goes from clear to solid. */
export const CHROME_SOLID_RANGE = 80

/** 0 at the top of the log, 1 once content has moved under the bar. */
export function chromeSolidFromScroll(scrollTop: number, range = CHROME_SOLID_RANGE): number {
  if (scrollTop <= 0) return 0
  if (scrollTop >= range) return 1
  return scrollTop / range
}

/** Drive `--chrome-solid` on the session / detail hosts that own the overlay bar. */
export function paintChromeSolid(from: HTMLElement, scrollTop: number): void {
  const value = chromeSolidFromScroll(scrollTop).toFixed(3)
  const detail = from.closest('.detail')
  if (detail instanceof HTMLElement) detail.style.setProperty('--chrome-solid', value)
  const session = from.closest('.session-window')
  if (session instanceof HTMLElement) session.style.setProperty('--chrome-solid', value)
}
