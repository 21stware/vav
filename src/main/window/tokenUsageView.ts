import { sessionUsageRowsOf } from '../../shared/accounts.ts'

type UsageSnapshot = Parameters<typeof sessionUsageRowsOf>[0][number]

export function tokenUsageAccountRowsOf<T extends { id: string }>(
  history: UsageSnapshot[] | undefined,
  accounts: T[],
  untitled: string,
  nameOf: (account: T) => string
): ReturnType<typeof sessionUsageRowsOf> {
  const names = new Map<string, string>()
  for (const account of accounts) names.set(account.id, nameOf(account))
  return sessionUsageRowsOf(history ?? [], names, untitled)
}

export function resolveContextTokens(
  estimated: number,
  latestInput: number,
  tokensUsed: number
): { contextTokens: number; contextTokensEstimated: boolean } {
  const contextTokens = estimated > 0 ? estimated : latestInput > 0 ? latestInput : tokensUsed
  return { contextTokens, contextTokensEstimated: estimated > 0 }
}

export type TokenUsageAnchor = { x: number; y: number; width: number; height: number }

export type Rect = { x: number; y: number; width: number; height: number }

/** Place the popup above the ring (or below if there isn’t room), clamped to the work area. */
export function tokenUsagePopupPosition(input: {
  width: number
  height: number
  content: Rect
  workArea: Rect
  anchor?: TokenUsageAnchor
  gap?: number
}): { x: number; y: number } {
  const gap = input.gap ?? 8
  const { width, height, content, workArea, anchor } = input
  let x: number
  let y: number
  if (anchor) {
    x = Math.round(content.x + anchor.x + anchor.width - width)
    y = Math.round(content.y + anchor.y - height - gap)
    if (y < content.y) {
      y = Math.round(content.y + anchor.y + anchor.height + gap)
    }
  } else {
    x = Math.round(content.x + content.width - width - 24)
    y = Math.round(content.y + content.height - height - 80)
  }
  x = Math.min(Math.max(workArea.x + 8, x), workArea.x + workArea.width - width - 8)
  y = Math.min(Math.max(workArea.y + 8, y), workArea.y + workArea.height - height - 8)
  return { x, y }
}
