import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ChatMessage } from '@shared/types'
import { ROOT_LEAF, branchPoints } from '@shared/thread'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import { BranchPager, MessageRow } from './MessageRow'
import { StreamingMessage } from './StreamingMessage'
import { Button, EmptyState, InlineAlert } from './ui'
import { keys } from '../lib/platform'

const SUGGESTIONS = ['解释当前目录结构', '运行单元测试', '总结 git diff']

export function Transcript(): React.JSX.Element {
  const activeId = useSessionStore((s) => s.activeId)
  const nodes = useSessionStore((s) => s.messages[s.activeId])
  const messages = useSessionStore((s) => visibleMessages(s, s.activeId))
  const turn = useSessionStore((s) => s.turns[s.activeId])
  const search = useSessionStore((s) => s.search)
  const apiKeyPresent = useSessionStore((s) => s.settings.apiKeyPresent)
  const setDraft = useSessionStore((s) => s.setDraft)
  const focusComposer = useSessionStore((s) => s.focusComposer)
  const openSettings = useSessionStore((s) => s.openSettings)
  const regenerate = useSessionStore((s) => s.regenerate)
  const editUserMessage = useSessionStore((s) => s.editUserMessage)
  const selectBranch = useSessionStore((s) => s.selectBranch)
  const selectPendingBranch = useSessionStore((s) => s.selectPendingBranch)
  const fork = useSessionStore((s) => s.fork)
  const continueInNewSession = useSessionStore((s) => s.continueInNewSession)
  const activeLeaf = useSessionStore((s) => s.activeLeaf[s.activeId] ?? null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottom = useRef(true)

  const onScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    pinnedToBottom.current = distance < 80
  }, [])

  // Follow the stream, but yield to a user who has scrolled up to read.
  useEffect(() => {
    if (!pinnedToBottom.current) return
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [messages.length, activeId, turn?.phase])

  // Scroll to the active search hit; `tick` makes repeat navigation re-fire.
  useEffect(() => {
    if (!search.open) return
    const id = search.matchIds[search.index]
    if (!id) return
    document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [search.open, search.index, search.tick, search.matchIds])

  const currentMatchId = search.open ? search.matchIds[search.index] : undefined
  const highlight = search.open && search.query.trim() ? search.query : undefined

  /**
   * Where the thread could go more than one way, keyed by the message the
   * branches hang off. Recomputed on tree changes only, not while streaming.
   */
  const branches = useMemo(() => branchPoints(nodes ?? [], activeLeaf), [nodes, activeLeaf])

  const onStepBranch = useCallback(
    (key: string, step: number) => {
      const point = branches.get(key)
      if (!point) return
      const next = point.targets[point.index + step]
      if (!next) return
      // The branch named after its own starting point is the empty one.
      if (next === key) void selectPendingBranch(key)
      else void selectBranch(next)
    },
    [branches, selectBranch, selectPendingBranch]
  )

  const onQuote = useCallback(
    (message: ChatMessage) => {
      const quoted = message.content
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      setDraft(activeId, `${quoted}\n\n`)
      focusComposer()
    },
    [activeId, setDraft, focusComposer]
  )

  const isEmpty = messages.length === 0 && !turn?.isRunning
  const rootBranch = branches.get(ROOT_LEAF)

  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll}>
      <div className="transcript-inner">
        {isEmpty && !apiKeyPresent && (
          <EmptyState
            logo
            title="欢迎使用 vav"
            description="本机 AI 编程代理：会话 + 文件树 + 真实终端。先配置 API Key，再让 agent 读写目录与执行命令。"
          >
            <InlineAlert
              kind="warning"
              title="尚未配置 API Key"
              message="可先浏览文件与打开终端；发送 Agent 回合需要密钥。"
            />
            <Button label="打开 Settings" variant="primary" onClick={() => openSettings('api')} />
          </EmptyState>
        )}

        {isEmpty && apiKeyPresent && (
          <EmptyState
            logo
            title="开始新会话"
            description={`描述任务、粘贴报错，或指定工作目录后让 agent 改代码 / 跑命令。${keys('⌘↵')} 发送。`}
          >
            <div className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  className="chip"
                  onClick={() => {
                    setDraft(activeId, suggestion)
                    focusComposer()
                  }}
                >
                  <span className="chip-label">{suggestion}</span>
                </button>
              ))}
            </div>
          </EmptyState>
        )}

        {/* Branches that start before the first prompt have no message to
            hang off, so their pager sits at the top of the transcript. */}
        {rootBranch && (
          <div className="branch-pager-row">
            <BranchPager
              index={rootBranch.index}
              count={rootBranch.targets.length}
              onStep={(step) => onStepBranch(ROOT_LEAF, step)}
            />
          </div>
        )}

        {messages.map((message) => {
          const branch = branches.get(message.id)
          return (
            <MessageRow
              key={message.id}
              message={message}
              highlight={highlight && search.matchIds.includes(message.id) ? highlight : undefined}
              isCurrentMatch={message.id === currentMatchId}
              branchIndex={branch?.index ?? 0}
              branchCount={branch?.targets.length ?? 1}
              busy={!!turn?.isRunning}
              onStepBranch={onStepBranch}
              onRegenerate={regenerate}
              onEdit={editUserMessage}
              onQuote={onQuote}
              onFork={fork}
              onContinueInNewSession={continueInNewSession}
            />
          )
        })}

        <StreamingMessage conversationId={activeId} />
      </div>
    </div>
  )
}
