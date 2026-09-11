const TIMER_LEGACY_UNTITLED = ['Scheduled task', '定时任务', 'A-new-scheduled-task'] as const
const DB_LEGACY_UNTITLED = ['Database', '数据库连接', 'A-new-db-connection'] as const

export function isDraftEditorTitle(
  value: string,
  untitled: string,
  legacy: readonly string[]
): boolean {
  const title = value.trim()
  if (!title) return true
  return title === untitled || legacy.includes(title)
}

export function isDraftScheduledTitle(value: string, untitled: string): boolean {
  return isDraftEditorTitle(value, untitled, TIMER_LEGACY_UNTITLED)
}

export function isDraftDbTitle(value: string, untitled: string): boolean {
  return isDraftEditorTitle(value, untitled, DB_LEGACY_UNTITLED)
}
