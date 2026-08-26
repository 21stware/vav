import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Bot, FilePen, Hammer, ListTodo, MessageCircle, ShieldCheck, Sparkles } from 'lucide-react'
import type { ApprovalMode, ThinkingLevel } from '@shared/types'
import { acpCurrentModeId, acpSessionModes, type AcpSessionMode } from '@shared/acpSession'
import type { MessageKey } from '@shared/i18n'
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

const APPROVAL_OPTIONS: {
  value: ApprovalMode
  labelKey: MessageKey
  titleKey: MessageKey
}[] = [
  { value: 'auto', labelKey: 'approvalMode.auto', titleKey: 'approvalMode.autoTitle' },
  { value: 'bypass', labelKey: 'approvalMode.bypass', titleKey: 'approvalMode.bypassTitle' },
  { value: 'edit', labelKey: 'approvalMode.edit', titleKey: 'approvalMode.editTitle' }
]

/**
 * Thinking · session mode · permission as three chips.
 * Thinking is a word; mode and permission are icons.
 */
export function SessionRunPicker({
  conversationId
}: {
  conversationId: string
}): React.JSX.Element | null {
  const t = useT()
  const conversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const setThinkingLevel = useSessionStore((s) => s.setThinkingLevel)
  const setApprovalMode = useSessionStore((s) => s.setApprovalMode)
  const setAcpMode = useSessionStore((s) => s.setAcpMode)
  const setAcpConfigOption = useSessionStore((s) => s.setAcpConfigOption)
  const approvalMenuNonce = useSessionStore((s) => s.approvalMenuNonce)
  const approvalConversationId = useSessionStore((s) => s.approvalConversationId)
  const approvalRef = useRef<HTMLButtonElement>(null)
  const seenApprovalMenuNonce = useRef(0)

  const showThinking =
    !!conversation && !conversation.cliHost && vavModelSupportsThinking(conversation.model)
  const thinking = parseThinkingLevel(conversation?.thinkingLevel)
  const thinkingLabel = t(LEVEL_KEYS[thinking])

  const sessionModes = acpSessionModes(conversation?.acpSession)
  const sessionModeId = acpCurrentModeId(conversation?.acpSession)
  const sessionMode = sessionModes.find((mode) => mode.id === sessionModeId) ?? sessionModes[0]
  const showMode = Boolean(conversation?.cliHost && sessionMode)

  const approval: ApprovalMode = conversation?.approvalMode ?? 'auto'
  const approvalMeta = APPROVAL_OPTIONS.find((row) => row.value === approval) ?? APPROVAL_OPTIONS[0]!

  const thinkingItems = useMemo((): MenuItem[] => {
    if (!conversation || !showThinking) return []
    return THINKING_LEVELS.map((value) => ({
      label: t(LEVEL_KEYS[value]),
      checked: value === thinking,
      onSelect: () => void setThinkingLevel(conversation.id, value)
    }))
  }, [conversation, setThinkingLevel, showThinking, t, thinking])

  const modeItems = useMemo((): MenuItem[] => {
    if (!conversation || !showMode) return []
    return sessionModes.map((mode) => ({
      label: mode.name,
      checked: mode.id === sessionMode?.id,
      onSelect: () => {
        const config = conversation.acpSession?.configOptions?.find(
          (option) => option.category === 'mode'
        )
        if (config) void setAcpConfigOption(conversation.id, config.id, mode.id)
        else void setAcpMode(conversation.id, mode.id)
      }
    }))
  }, [conversation, sessionMode?.id, sessionModes, setAcpConfigOption, setAcpMode, showMode])

  const approvalItems = useMemo((): MenuItem[] => {
    if (!conversation) return []
    return APPROVAL_OPTIONS.map((row) => ({
      label: t(row.labelKey),
      checked: row.value === approval,
      onSelect: () => void setApprovalMode(conversation.id, row.value)
    }))
  }, [approval, conversation, setApprovalMode, t])

  const openMenu = useCallback((items: MenuItem[], anchor?: HTMLElement | null) => {
    if (items.length === 0) return
    void showMenu(items, menuAnchorIfVisible(anchor))
  }, [])

  useEffect(() => {
    if (approvalMenuNonce === 0 || approvalMenuNonce === seenApprovalMenuNonce.current) return
    if (approvalConversationId && approvalConversationId !== conversationId) return
    seenApprovalMenuNonce.current = approvalMenuNonce
    openMenu(approvalItems, approvalRef.current)
  }, [approvalConversationId, approvalItems, approvalMenuNonce, conversationId, openMenu])

  if (!conversation) return null

  return (
    <div
      className="session-run-controls"
      data-testid="session-run-controls"
      data-approval={approval}
      data-thinking={showThinking ? thinking : undefined}
      data-session-mode={showMode ? sessionMode?.id : undefined}
    >
      {showThinking ? (
        <button
          type="button"
          className="model-picker session-run-btn"
          data-testid="session-run-thinking"
          aria-label={`${t('composer.thinkingLevel')} · ${thinkingLabel}`}
          aria-haspopup="menu"
          title={`${t('composer.thinkingLevel')} · ${thinkingLabel}`}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openMenu(thinkingItems, event.currentTarget)
          }}
        >
          <span className="session-run-level">{thinkingLabel}</span>
        </button>
      ) : null}
      {showMode && sessionMode ? (
        <button
          type="button"
          className="model-picker session-run-btn is-icon"
          data-testid="session-run-mode"
          aria-label={[t('composer.sessionMode'), sessionMode.name, sessionMode.description]
            .filter(Boolean)
            .join(' · ')}
          aria-haspopup="menu"
          title={[t('composer.sessionMode'), sessionMode.name, sessionMode.description]
            .filter(Boolean)
            .join(' · ')}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openMenu(modeItems, event.currentTarget)
          }}
        >
          <ModeIcon mode={sessionMode} />
        </button>
      ) : null}
      <button
        ref={approvalRef}
        type="button"
        className="model-picker session-run-btn is-icon"
        data-testid="session-run-approval"
        aria-label={`${t(approvalMeta.labelKey)} · ${t(approvalMeta.titleKey)}`}
        aria-haspopup="menu"
        title={`${t(approvalMeta.labelKey)} · ${t(approvalMeta.titleKey)}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          openMenu(approvalItems, event.currentTarget)
        }}
      >
        <ApprovalIcon mode={approval} />
      </button>
    </div>
  )
}

function ModeIcon({ mode }: { mode: AcpSessionMode }): React.JSX.Element {
  const id = mode.id.trim().toLowerCase()
  const title = mode.name
  if (id.includes('plan')) return <ListTodo size={12} strokeWidth={2} aria-label={title} />
  if (id.includes('ask')) return <MessageCircle size={12} strokeWidth={2} aria-label={title} />
  if (id.includes('build')) return <Hammer size={12} strokeWidth={2} aria-label={title} />
  return <Bot size={12} strokeWidth={2} aria-label={title} />
}

function ApprovalIcon({ mode }: { mode: ApprovalMode }): React.JSX.Element {
  if (mode === 'bypass') return <ShieldCheck size={12} strokeWidth={2} />
  if (mode === 'edit') return <FilePen size={12} strokeWidth={2} />
  return <Sparkles size={12} strokeWidth={2} />
}
