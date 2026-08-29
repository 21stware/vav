import { formatWorkspaceLabel } from '@shared/workspaceHost'
import { basename } from './path'
import { tt } from '../i18n/useT'
import { getResolvedLocale } from '../i18n/useT'

/** Relative time in the sidebar's vocabulary. */
export function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (delta < minute) return tt('sidebar.time.justNow')
  if (delta < hour) return tt('sidebar.time.minutesAgo', { n: Math.floor(delta / minute) })
  if (delta < day) return tt('sidebar.time.hoursAgo', { n: Math.floor(delta / hour) })
  if (delta < 2 * day) return tt('sidebar.time.yesterday')
  if (delta < 7 * day) return tt('sidebar.time.daysAgo', { n: Math.floor(delta / day) })
  if (delta < 14 * day) return tt('sidebar.time.lastWeek')
  return new Date(timestamp).toLocaleDateString(getResolvedLocale())
}

/** Temp / unrooted shells — not a project path; labeled "Default workspace". */
export function isTemporaryWorkspace(path: string | null, tmp: string): boolean {
  if (!path) return true
  return path.startsWith(tmp) || path.startsWith('/private' + tmp)
}

export function workdirLabel(path: string | null, tmp: string, home: string): string {
  if (isTemporaryWorkspace(path, tmp) || !path) return tt('sidebar.defaultWorkspace')
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/** Path chip / chrome: prefix a remote machine when the session is not local. */
export function workspaceChromeLabel(
  path: string | null,
  tmp: string,
  home: string,
  machineId?: string | null,
  hostName?: string | null
): string {
  return formatWorkspaceLabel(machineId, workdirLabel(path, tmp, home), hostName)
}

export function workdirShortLabel(path: string | null, tmp: string): string {
  if (isTemporaryWorkspace(path, tmp) || !path) return tt('sidebar.defaultWorkspace')
  return basename(path)
}

/**
 * Middle-truncates, so titles sharing a long prefix stay distinguishable
 * (sidebar-conversation-list.rpml, 边界值 → 超长标题).
 */
export function middleTruncate(value: string, limit = 40): string {
  const chars = [...value]
  if (chars.length <= limit) return value
  return `${chars.slice(0, 20).join('')}…${chars.slice(-10).join('')}`
}

/**
 * Elides the middle of a path so the leading `~/` and the final segment — the
 * two parts that identify it — both stay visible (main-chat.rpml annotation 6).
 */
export function truncatePathLabel(path: string, limit = 26): string {
  if (path.length <= limit) return path
  const tail = basename(path)
  const head = path.slice(0, Math.max(2, limit - tail.length - 2))
  return `${head}…/${tail}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function formatTokens(value: number): string {
  if (value < 1000) return String(value)
  return `${(value / 1000).toFixed(1)}k`
}
