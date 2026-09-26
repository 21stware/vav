/**
 * Status trays in Files (GitHub).
 * Git stays always-on as a local diff inspector — not gated here.
 *
 * Missing keys (older settings.json) use the defaults below.
 */
export function isGithubTrayEnabled(settings: {
  githubTrayEnabled?: boolean
}): boolean {
  return settings.githubTrayEnabled !== false
}
