import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { quoteSummaryFromContent } from '@shared/quote'
import { ROOT_LEAF, branchPoints } from '@shared/thread'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import { BranchPager, MessageRow } from './MessageRow'
import { StreamingMessage } from './StreamingMessage'
import { Button, EmptyState } from './ui'
import { useT } from '../i18n/useT'

export function Transcript(): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const nodes = useSessionStore((s) => s.messages[s.activeId])
  const messages = useSessionStore((s) => visibleMessages(s, s.activeId))
  const turn = useSessionStore((s) => s.turns[s.activeId])
  const search = useSessionStore((s) => s.search)
  const flashMessageId = useSessionStore((s) => s.flashMessageId)
  const flashTick = useSessionStore((s) => s.flashTick)
  const apiKeyPresent = useSessionStore((s) => s.settings.apiKeyPresent)
  const setQuote = useSessionStore((s) => s.setQuote)
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
  const prevLeaf = useRef(activeLeaf)
  const [branchSwap, setBranchSwap] = useState(0)
  const [branchSwapActive, setBranchSwapActive] = useState(false)

  // Whole-path feedback when the active branch changes (pager click / regenerate).
  useEffect(() => {
    if (prevLeaf.current === activeLeaf) return
    const hadLeaf = prevLeaf.current != null
    prevLeaf.current = activeLeaf
    if (!hadLeaf || !activeLeaf) return
    setBranchSwap((n) => n + 1)
    setBranchSwapActive(false)
    const frame = window.requestAnimationFrame(() => setBranchSwapActive(true))
    const timer = window.setTimeout(() => setBranchSwapActive(false), 280)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [activeLeaf])

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

  // Quote strip / bubble citation: jump + 1.5s yellow flash.
  useEffect(() => {
    if (!flashMessageId || flashTick === 0) return
    document
      .getElementById(`msg-${flashMessageId}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [flashMessageId, flashTick])

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
      if (!activeId || message.role === 'system') return
      const body =
        message.content.trim() ||
        message.blocks
          .filter((b): b is Extract<ChatMessage['blocks'][number], { kind: 'text' }> => b.kind === 'text')
          .map((b) => b.text)
          .join('\n')
      const summary = quoteSummaryFromContent(body)
      if (!summary) return
      setQuote(activeId, {
        messageId: message.id,
        summary,
        role: message.role === 'user' ? 'user' : 'assistant'
      })
      focusComposer()
    },
    [activeId, setQuote, focusComposer]
  )

  const isEmpty = messages.length === 0 && !turn?.isRunning
  const rootBranch = branches.get(ROOT_LEAF)

  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll}>
      <div className={`transcript-inner${branchSwapActive ? ' is-branch-swap' : ''}`}>
        {isEmpty && !apiKeyPresent && (
          /* Four elements used to say "there is no key yet": this description,
             a warning card's heading, its body, and the button. The logo says
             the app's name, the heading says what is missing, the description
             says what still works meanwhile, and the button does the one thing
             worth doing. Nothing is amber — on a first run nothing is wrong. */
          <EmptyState
            logo
            title={t('transcript.configureKey')}
            description={t('transcript.configureKeyDesc')}
          >
            <Button
              label={t('transcript.openSettings')}
              variant="primary"
              onClick={() => openSettings('api')}
            />
          </EmptyState>
        )}

        {isEmpty && apiKeyPresent && (
          <EmptyState logo title={t('transcript.startSession')} />
        )}

        {/* Branches that start before the first prompt have no message to
            hang off, so their pager sits at the top of the transcript. */}
        {rootBranch && (
          <div className="branch-pager-row">
            <BranchPager
              index={rootBranch.index}
              count={rootBranch.targets.length}
              pulseKey={branchSwap}
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
              flash={flashMessageId === message.id ? flashTick : 0}
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
