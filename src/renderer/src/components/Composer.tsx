import { useEffect, useMemo, useRef } from 'react'
import { ArrowUp, ChevronDown, Paperclip, Square, X } from 'lucide-react'
import { PRESET_MODELS } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { formatTokens } from '../lib/format'
import { basename } from '../lib/path'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { keys } from '../lib/platform'
import { Button } from './ui'

/**
 * Prompt input for the active conversation.
 *
 * Gating follows main-chat.rpml annotation 8: disabled while this conversation
 * is running, `canSend` requires text or an attachment, and a missing key turns
 * send into a prompt that opens Settings.
 */
/** Stable identity: a fresh [] from a selector would re-render forever. */
const NO_ATTACHMENTS: string[] = []

export function Composer(): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const draft = useSessionStore((s) => s.drafts[s.activeId] ?? '')
  const attachments = useSessionStore((s) => s.attachments[s.activeId] ?? NO_ATTACHMENTS)
  const turn = useSessionStore((s) => s.turns[s.activeId])
  const settings = useSessionStore((s) => s.settings)
  const focusTick = useSessionStore((s) => s.composerFocusTick)

  const setDraft = useSessionStore((s) => s.setDraft)
  const setAttachments = useSessionStore((s) => s.setAttachments)
  const send = useSessionStore((s) => s.send)
  const cancel = useSessionStore((s) => s.cancel)
  const setModel = useSessionStore((s) => s.setModel)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isRunning = !!turn?.isRunning
  const awaiting = !!turn?.awaitingToolCallId
  const canSend = !isRunning && (draft.trim().length > 0 || attachments.length > 0)

  // The shortcut hint used to be its own strip; the placeholder is where the
  // reader already is when they need it.
  const placeholder = awaiting
    ? '先回答 Agent 的问题…'
    : isRunning
      ? 'Agent 正在思考…'
      : `输入命令或问题…  ${keys('⌘↵')} 发送，可拖入文件`

  useEffect(() => {
    if (focusTick === 0) return
    textareaRef.current?.focus()
  }, [focusTick])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(180, element.scrollHeight)}px`
  }, [draft])

  const activeModel = conversation?.model ?? settings.defaultModel

  const modelItems = useMemo((): MenuItem[] => {
    const custom = settings.customModels.map((id) => ({
      label: id,
      checked: id === activeModel,
      onSelect: () => void setModel(activeId, id)
    }))
    const presets = PRESET_MODELS.map((model) => ({
      label: model.label,
      checked: model.id === activeModel,
      onSelect: () => void setModel(activeId, model.id)
    }))
    return custom.length ? [...presets, { label: '', divider: true }, ...custom] : presets
  }, [settings.customModels, activeId, activeModel, setModel])

  const submit = (): void => {
    if (!canSend) return
    void send(draft.trim(), attachments)
  }

  const tokenRatio = conversation
    ? Math.min(1, conversation.tokensUsed / Math.max(1, conversation.tokenLimit))
    : 0

  return (
    <div
      className="composer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const paths = [...event.dataTransfer.files]
          .map((file) => window.vav.files.pathForFile(file))
          .filter(Boolean)
        if (paths.length) setAttachments(activeId, [...new Set([...attachments, ...paths])])
      }}
    >
      {/* One surface: attachments, the prompt and the controls that act on it
          all live inside the box, so the composer is a single object rather
          than three strips stacked on top of each other. */}
      <div className="composer-box">
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((path) => (
              <span className="chip" key={path} title={path}>
                <Paperclip size={11} />
                <span className="chip-label">{basename(path)}</span>
                <button
                  className="btn icon-only sm"
                  style={{ width: 16, height: 16 }}
                  onClick={() => setAttachments(activeId, attachments.filter((p) => p !== path))}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={placeholder}
          value={draft}
          disabled={isRunning}
          onChange={(event) => setDraft(activeId, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        />

        <div className="composer-bar">
          <button
            className="model-picker"
            title="切换模型"
            onClick={(event) =>
              void showMenu(modelItems, menuAnchor(event.currentTarget as HTMLElement))
            }
          >
            <span className="model-name">
              {PRESET_MODELS.find((m) => m.id === activeModel)?.label ?? activeModel}
            </span>
            <ChevronDown size={11} />
          </button>

          <span className="spacer" />

          {conversation && (
            <span
              className="token-ring"
              data-level={tokenRatio > 0.9 ? 'full' : tokenRatio > 0.7 ? 'warn' : 'ok'}
              title="本会话 token 用量"
            >
              <span className="track">
                <span className="fill" style={{ width: `${tokenRatio * 100}%` }} />
              </span>
              {formatTokens(conversation.tokensUsed)} / {formatTokens(conversation.tokenLimit)}
            </span>
          )}

          {isRunning ? (
            <Button
              label="停止"
              icon={<Square size={11} />}
              variant="danger"
              size="sm"
              onClick={() => void cancel(activeId)}
            />
          ) : (
            <button className="send-button" disabled={!canSend} onClick={submit} title={`发送 ${keys('⌘↵')}`}>
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
