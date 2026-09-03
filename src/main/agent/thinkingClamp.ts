import type { ThinkingLevel } from '../../shared/types.ts'
import { parseThinkingLevel } from '../../shared/thinkingLevel.ts'
import {
  cursorFamilyAllowsThinkingOverlay,
  cursorModelFamilyId
} from '../../shared/cursorModel.ts'

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

/**
 * Locked Cursor families (Kimi / GPT) bake thinking into the model id.
 * Overlay-capable families keep Fast / thinking as the current request.
 */
export function cursorLockedFamilyThinkingPatch(
  conversation: {
    cliHost?: string | null
    model?: string | null
    thinkingLevel?: string | null
  },
  applied: { thinkingLevel?: ThinkingLevel | null }
): { thinkingLevel: ThinkingLevel } | null {
  if (conversation.cliHost !== 'cursor') return null
  const family = cursorModelFamilyId(conversation.model ?? '')
  if (!family || cursorFamilyAllowsThinkingOverlay(family)) return null
  if (!applied.thinkingLevel || applied.thinkingLevel === conversation.thinkingLevel) return null
  return { thinkingLevel: applied.thinkingLevel }
}
