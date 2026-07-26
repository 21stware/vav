import { basename } from './path'

/** Relative time in the sidebar's vocabulary (sidebar-conversation-list.rpml). */
export function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 2 * day) return '昨天'
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  if (delta < 14 * day) return '上周'
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

/** A Temporary Workspace shows as "Workspace", never as a raw /var/folders path. */
export function isTemporaryWorkspace(path: string | null, tmp: string): boolean {
  if (!path) return true
  return path.startsWith(tmp) || path.startsWith('/private' + tmp)
}

export function workdirLabel(path: string | null, tmp: string, home: string): string {
  if (isTemporaryWorkspace(path, tmp)) return 'Workspace'
  if (!path) return 'Workspace'
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export function workdirShortLabel(path: string | null, tmp: string): string {
  if (isTemporaryWorkspace(path, tmp) || !path) return 'Workspace'
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
