/** True when this renderer is a companion session window (`view=session`). */
export function isCompanionSessionShell(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'session'
  } catch {
    return false
  }
}
