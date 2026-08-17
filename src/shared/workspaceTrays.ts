/**
 * Status trays in Files (GitHub / Cloudflare / Supabase).
 * Git stays always-on as a local diff inspector — not gated here.
 *
 * Missing keys (older settings.json) use the defaults below.
 */
export function isGithubTrayEnabled(settings: {
  githubTrayEnabled?: boolean
}): boolean {
  return settings.githubTrayEnabled !== false
}

export function isCloudflareTrayEnabled(settings: {
  cloudflareTrayEnabled?: boolean
}): boolean {
  return settings.cloudflareTrayEnabled === true
}

export function isSupabaseTrayEnabled(settings: {
  supabaseTrayEnabled?: boolean
}): boolean {
  return settings.supabaseTrayEnabled === true
}
