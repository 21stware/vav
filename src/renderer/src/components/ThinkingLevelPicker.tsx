import { useCallback, useMemo } from 'react'
import { Brain, ChevronDown } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { ThinkingLevel } from '@shared/types'
import {
  parseThinkingLevel,
  THINKING_LEVELS,
  vavModelSupportsThinking
} from '@shared/thinkingLevel'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { menuAnchorIfVisible, showMenu, type MenuItem } from '../lib/nativeMenu'

const LEVEL_KEYS: Record<ThinkingLevel, MessageKey> = {
  off: 'composer.thinkingLevel.off',
  low: 'composer.thinkingLevel.low',
  medium: 'composer.thinkingLevel.medium',
  high: 'composer.thinkingLevel.high',
  max: 'composer.thinkingLevel.max'
}

/**
 * Per-session thinking depth, only for the built-in VAV agent.
 * Sits immediately to the right of {@link AgentModelPicker}.
 */
export function ThinkingLevelPicker({
  conversationId
}: {
  conversationId: string
}): React.JSX.Element | null {
  const t = useT()
  const conversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const setThinkingLevel = useSessionStore((s) => s.setThinkingLevel)

  const visible =
    !!conversation &&
    !conversation.cliHost &&
    vavModelSupportsThinking(conversation.model)
  const level = parseThinkingLevel(conversation?.thinkingLevel)
  const label = t(LEVEL_KEYS[level])

  const items = useMemo((): MenuItem[] => {
    if (!conversation) return []
    return THINKING_LEVELS.map((value) => ({
      label: t(LEVEL_KEYS[value]),
      checked: value === level,
      onSelect: () => void setThinkingLevel(conversation.id, value)
    }))
  }, [conversation, level, setThinkingLevel, t])

  const openMenu = useCallback(
    (anchor?: HTMLElement | null) => {
      if (items.length === 0) return
      void showMenu(items, menuAnchorIfVisible(anchor))
    },
    [items]
  )

  if (!visible) return null

  return (
    <div className="thinking-level-picker">
      <button
        type="button"
        className="model-picker thinking-level-picker-trigger"
        aria-label={t('composer.thinkingLevel')}
        aria-haspopup="menu"
        title={`${t('composer.thinkingLevel')} · ${label}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openMenu(event.currentTarget)
        }}
      >
        <Brain size={12} strokeWidth={2} aria-hidden />
        <span className="model-name">{label}</span>
        <ChevronDown size={11} />
      </button>
    </div>
  )
}
