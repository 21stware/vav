/** Temp writes for conversation overlays — never a real file to bind a session to. */
export function isClipPath(path: string): boolean {
  if (!path) return false
  return path.replace(/\\/g, '/').includes('/vav-clips/')
}

/** File Sessions are for chatting about a real file, not an ephemeral preview. */
export function isFileSessionEligible(path: string): boolean {
  return Boolean(path.trim()) && !isClipPath(path)
}
