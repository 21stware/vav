import type { ThinkingLevel } from '../../shared/types.ts'
import { parseThinkingLevel } from '../../shared/thinkingLevel.ts'

/** Next thinking level when the current one is not in the host's allowed set. */
export function nextAllowedThinkingLevel(
  current: string | undefined,
  allowed: ThinkingLevel[] | undefined
): ThinkingLevel | null {
  if (!allowed?.length) return null
  const parsed = parseThinkingLevel(current)
  if (allowed.includes(parsed)) return null
  return allowed.includes('max') ? 'max' : allowed[allowed.length - 1]!
}
