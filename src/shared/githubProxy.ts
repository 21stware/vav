/** Public gh-proxy prefix — no R2 / no first-party egress. */
export const GH_PROXY_PREFIX = 'https://gh-proxy.com/'

export const GITHUB_UPDATE_REPO = '21stware/vav'

const GITHUB_HOSTS = new Set(['github.com', 'api.github.com'])

export function isGithubAssetUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return GITHUB_HOSTS.has(host) || host.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

/** Wrap a GitHub / raw / release URL so it goes through gh-proxy. Idempotent. */
export function viaGithubProxy(url: string): string {
  const trimmed = url.trim()
  if (!trimmed || trimmed.startsWith(GH_PROXY_PREFIX)) return trimmed
  if (!isGithubAssetUrl(trimmed)) return trimmed
  return `${GH_PROXY_PREFIX}${trimmed}`
}

/** electron-updater generic feed — latest-mac.yml / latest.yml live here. */
export function githubProxyGenericFeedUrl(repo = GITHUB_UPDATE_REPO): string {
  return `${GH_PROXY_PREFIX}https://github.com/${repo}/releases/latest/download`
}

export function githubLatestReleaseApiUrl(proxy: boolean, repo = GITHUB_UPDATE_REPO): string {
  const raw = `https://api.github.com/repos/${repo}/releases/latest`
  return proxy ? viaGithubProxy(raw) : raw
}
