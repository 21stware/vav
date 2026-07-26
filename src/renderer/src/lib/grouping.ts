import type { ConversationMeta } from '@shared/types'

export interface ConversationGroup {
  /** Empty for the pinned section and for search results — neither gets a header. */
  label: string
  conversations: ConversationMeta[]
}

const DAY = 24 * 60 * 60 * 1000

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Which time bucket a row falls into, as the four the sidebar spec names.
 *
 * 本周 is the trailing seven days rather than the calendar week: on a Monday a
 * calendar week would leave the bucket empty and drop two-day-old rows into
 * 更早, which reads as a bug.
 */
function bucketOf(updatedAt: number, now: number): number {
  const today = startOfDay(now)
  if (updatedAt >= today) return 0
  if (updatedAt >= today - DAY) return 1
  if (updatedAt >= today - 6 * DAY) return 2
  return 3
}

const BUCKET_LABELS = ['今天', '昨天', '本周', '更早']

/**
 * Orders the sidebar in the three layers the spec defines: pinned rows first by
 * pinTime, then time-bucketed rows by updatedAt. Searching collapses the
 * buckets — headers would only add noise to a filtered list.
 */
export function groupConversations(
  conversations: ConversationMeta[],
  searching: boolean,
  now = Date.now()
): ConversationGroup[] {
  const pinned = conversations
    .filter((c) => c.pinned)
    .sort((a, b) => (b.pinTime ?? 0) - (a.pinTime ?? 0))
  const rest = conversations.filter((c) => !c.pinned).sort((a, b) => b.updatedAt - a.updatedAt)

  const groups: ConversationGroup[] = []
  if (pinned.length) groups.push({ label: '', conversations: pinned })

  if (searching) {
    if (rest.length) groups.push({ label: '', conversations: rest })
    return groups
  }

  for (let bucket = 0; bucket < BUCKET_LABELS.length; bucket++) {
    const rows = rest.filter((c) => bucketOf(c.updatedAt, now) === bucket)
    if (rows.length) groups.push({ label: BUCKET_LABELS[bucket], conversations: rows })
  }
  return groups
}

/** Flat visible order, for arrow-key movement and ⌘A. */
export function flatten(groups: ConversationGroup[]): ConversationMeta[] {
  return groups.flatMap((group) => group.conversations)
}
