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

/** Empty untitled connection that only exists because the form used to mint a row first. */
export function isDraftDbConnection(
  connection: {
    title: string
    database: string
    user: string
    lastStatus: string | null
  },
  untitled: string
): boolean {
  return (
    connection.lastStatus !== 'ok' &&
    !connection.database.trim() &&
    !connection.user.trim() &&
    isDraftDbTitle(connection.title, untitled)
  )
}
