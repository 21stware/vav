import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  BookOpen,
  Bot,
  ChevronDown,
  Hammer,
  ListTodo,
  MessageCircle,
  Rocket,
  Shield
} from 'lucide-react'
import type { ApprovalMode, ThinkingLevel } from '@shared/types'
import { acpCurrentModeId, acpSessionModes, type AcpSessionMode } from '@shared/acpSession'
import type { MessageKey } from '@shared/i18n'
import {
  clampThinkingLevel,
  parseThinkingLevel,
  sessionShowsFast,
  sessionShowsThinking,
  thinkingLevelsForSession
} from '@shared/thinkingLevel'
import { cursorModelFamilyId } from '@shared/cursorModel'
import { agentModelHostKey } from '@shared/agentModels'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { menuAnchorIfVisible, showMenu, type MenuItem } from '../lib/nativeMenu'
import {
  menuIconKeyForMode,
  warmMenuIcons,
  type LucideMenuIconKey
} from '../lib/menuIcons'

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
  iconKey: LucideMenuIconKey
}[] = [
  {
    value: 'auto',
    labelKey: 'approvalMode.auto',
    titleKey: 'approvalMode.autoTitle',
    iconKey: 'approval-auto'
  },
  {
    value: 'bypass',
    labelKey: 'approvalMode.bypass',
    titleKey: 'approvalMode.bypassTitle',
    iconKey: 'approval-bypass'
  },
  {
    value: 'edit',
    labelKey: 'approvalMode.edit',
    titleKey: 'approvalMode.editTitle',
    iconKey: 'approval-edit'
  }
]

/**
 * [mode · permission]  model picker  [thinking · Fast]
 * Thinking stays the bar icon; Fast is a word; mode and permission are icons.
 */
export function SessionRunPicker({
  conversationId,
  children
}: {
  conversationId: string
  children?: ReactNode
}): React.JSX.Element | null {
  const t = useT()
  const conversation = useSessionStore((s) =>
    s.conversations.find((c) => c.id === conversationId)
  )
  const setThinkingLevel = useSessionStore((s) => s.setThinkingLevel)
  const setFast = useSessionStore((s) => s.setFast)
  const setApprovalMode = useSessionStore((s) => s.setApprovalMode)
  const setAcpMode = useSessionStore((s) => s.setAcpMode)
  const setAcpConfigOption = useSessionStore((s) => s.setAcpConfigOption)
  const approvalMenuNonce = useSessionStore((s) => s.approvalMenuNonce)
  const approvalConversationId = useSessionStore((s) => s.approvalConversationId)
  const approvalRef = useRef<HTMLButtonElement>(null)
  const seenApprovalMenuNonce = useRef(0)

  const catalog = useSessionStore((s) => s.agentModelCatalog)
  const showThinking = sessionShowsThinking(conversation?.cliHost, conversation?.model)
  const showFast = sessionShowsFast(conversation?.cliHost)
  const catalogueDefault = (() => {
    if (conversation?.cliHost !== 'cursor' || !conversation.model) return null
    const family = cursorModelFamilyId(conversation.model)
    const models = catalog[agentModelHostKey('cursor')]?.models ?? []
    return models.find((model) => model.id === family)?.defaultThinkingLevel ?? null
  })()
  const allowedThinking = thinkingLevelsForSession({
    cliHost: conversation?.cliHost,
    modelId: conversation?.model,
    acpThinkingLevels: conversation?.acpSession?.thinkingLevels,
    catalogueDefault
  })
  const thinking = clampThinkingLevel(
    parseThinkingLevel(conversation?.thinkingLevel),
    allowedThinking
  )
  const thinkingLabel = t(LEVEL_KEYS[thinking])
  const fast = conversation?.fast === true

  const sessionModes = acpSessionModes(conversation?.acpSession)
  const sessionModeId = acpCurrentModeId(conversation?.acpSession)
  const sessionMode = sessionModes.find((mode) => mode.id === sessionModeId) ?? sessionModes[0]
  const showMode = Boolean(conversation?.cliHost && sessionMode)

  const approval: ApprovalMode = conversation?.approvalMode ?? 'auto'
  const approvalMeta = APPROVAL_OPTIONS.find((row) => row.value === approval) ?? APPROVAL_OPTIONS[0]!

  const thinkingItems = useMemo((): MenuItem[] => {
    if (!conversation || !showThinking) return []
    return [...allowedThinking].reverse().map((value) => ({
      label: t(LEVEL_KEYS[value]),
      checked: value === thinking,
      onSelect: () => void setThinkingLevel(conversation.id, value)
    }))
  }, [allowedThinking, conversation, setThinkingLevel, showThinking, t, thinking])

  const modeItems = useMemo((): MenuItem[] => {
    if (!conversation || !showMode) return []
    return sessionModes.map((mode) => ({
      label: mode.name,
      checked: mode.id === sessionMode?.id,
      icon: { kind: 'lucide', key: menuIconKeyForMode(mode.id) },
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
      icon: { kind: 'lucide', key: row.iconKey },
      onSelect: () => void setApprovalMode(conversation.id, row.value)
    }))
  }, [approval, conversation, setApprovalMode, t])

  // Rasterize the small static icon set ahead of the first menu open.
  useEffect(() => {
    warmMenuIcons([
      ...APPROVAL_OPTIONS.map((row) => ({
        kind: 'lucide' as const,
        key: row.iconKey
      })),
      ...sessionModes.map((mode) => ({
        kind: 'lucide' as const,
        key: menuIconKeyForMode(mode.id)
      }))
    ])
  }, [sessionModes])

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
      data-fast={showFast ? (fast ? 'true' : 'false') : undefined}
      data-session-mode={showMode ? sessionMode?.id : undefined}
    >
      <span className="session-run-config">
        {showMode && sessionMode ? (
          <button
            type="button"
            className="model-picker session-run-btn is-icon has-caret"
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
            <ChevronDown size={9} className="session-run-caret" aria-hidden />
          </button>
        ) : null}
        <button
          ref={approvalRef}
          type="button"
          className="model-picker session-run-btn is-icon has-caret"
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
          <ChevronDown size={9} className="session-run-caret" aria-hidden />
        </button>
      </span>
      {children}
      {showThinking || showFast ? (
        <span className="session-run-options">
          {showThinking ? (
            <button
              type="button"
              className="model-picker session-run-btn is-icon"
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
              <ThinkingIcon level={thinking} />
            </button>
          ) : null}
          {showFast ? (
            <button
              type="button"
              className="model-picker session-run-btn"
              data-testid="session-run-fast"
              aria-pressed={fast}
              aria-label={`${t('composer.fast')} · ${fast ? t('composer.fast.on') : t('composer.fast.off')}`}
              title={`${t('composer.fast')} · ${fast ? t('composer.fast.on') : t('composer.fast.off')}`}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (!conversation) return
                void setFast(conversation.id, !fast)
              }}
            >
              <span className="session-run-level">{t('composer.fast')}</span>
            </button>
          ) : null}
        </span>
      ) : null}
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
  if (mode === 'bypass') return <Rocket size={12} strokeWidth={2} />
  if (mode === 'edit') return <BookOpen size={12} strokeWidth={2} />
  return <Shield size={12} strokeWidth={2} />
}

function ThinkingIcon({ level }: { level: ThinkingLevel }): React.JSX.Element {
  const n =
    level === 'low' ? 1 : level === 'medium' ? 2 : level === 'high' ? 3 : level === 'max' ? 4 : 0

  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {[0, 1, 2, 3].map((i) => {
        const isHighlight = i + 1 === n
        const isBelow = i + 1 < n
        const barHeight = 1.2
        const gap = 1.2
        const totalHeight = 4 * barHeight + 3 * gap
        const offset = (12 - totalHeight) / 2
        const y = 12 - offset - (i + 1) * barHeight - i * gap

        let fill = 'currentColor'
        let opacity = 0.15

        if (isHighlight) {
          fill = 'var(--accent)'
          opacity = 1
        } else if (isBelow) {
          fill = 'currentColor'
          opacity = 1
        }

        return (
          <rect
            key={i}
            x="0"
            y={y}
            width="12"
            height={barHeight}
            rx={0.4}
            fill={fill}
            style={{ opacity }}
          />
        )
      })}
    </svg>
  )
}

