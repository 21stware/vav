import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent
} from 'react'
import type { ChatMessage, LeafCompaction } from '@shared/types'
import { quoteSummaryFromContent } from '@shared/quote'
import { compactionBoundaryIndex, compactionForLeaf } from '@shared/compaction'
import { ROOT_LEAF, branchPoints } from '@shared/thread'
import { getProjection } from '../state/StreamProjection'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import { CompactionBanner } from './CompactionBanner'
import { BranchPager, MessageRow } from './MessageRow'
import { StreamingMessage } from './StreamingMessage'
import { displayNameForCliHost, enabledCliAgents, isStructuredCliHost } from '@shared/types'
import { Button, EmptyState } from './ui'
import { AgentBrandMark } from './AgentBrandMark'
import { SessionWorkspaceChrome } from './SessionWorkspaceChrome'
import { useT } from '../i18n/useT'

/**
 * Stick-to-bottom with hysteresis so scroll-up is not trapped:
 *
 * - While following: leave only after rising more than UNPIN_PX from the end
 *   (and stream lag is suppressed separately — see PROGRAMMATIC_SUPPRESS_MS).
 * - While reading history: re-enter follow only when truly at the end (≤ REPIN_PX).
 *
 * A single large band (e.g. 240px both ways) made mild upward scrolls re-pin
 * and yank the viewport back down mid-gesture.
 */
const UNPIN_PX = 96
const REPIN_PX = 28

/** While following, ignore scroll pin updates after a programmatic jump. */
const PROGRAMMATIC_SUPPRESS_MS = 150

/** Window sealed rows when the leaf path is long — keeps DOM / layout bounded. */
const VIRTUALIZE_AFTER = 48
/** Rows kept mounted near the bottom while following the stream. */
const KEEP_TAIL = 40
const EST_ROW_PX = 132
const OVERSCAN_ROWS = 8

type TranscriptItem =
  | { key: string; kind: 'message'; message: ChatMessage }
  | { key: string; kind: 'compaction'; compaction: LeafCompaction }

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

/** Instant jump — never smooth, or the stream outruns the animation. */
function scrollToBottomNow(el: HTMLElement): void {
  // Direct assignment is more reliable than scrollTo during rapid growth.
  el.scrollTop = el.scrollHeight
}

function estimateOffset(
  items: TranscriptItem[],
  end: number,
  heights: Map<string, number>
): number {
  let total = 0
  for (let i = 0; i < end; i++) {
    total += heights.get(items[i]!.key) ?? EST_ROW_PX
  }
  return total
}

export function Transcript(): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const nodes = useSessionStore((s) => s.messages[s.activeId])
  const activeLeaf = useSessionStore((s) => s.activeLeaf[s.activeId] ?? null)
  // Never select visibleMessages() directly — even with pathCache, interleaving
  // calls can still hand React a new array identity mid-getSnapshot.
  const messages = useMemo(
    () => visibleMessages(useSessionStore.getState(), activeId),
    [activeId, nodes, activeLeaf]
  )
  const turnRunning = useSessionStore((s) => !!s.turns[s.activeId]?.isRunning)
  const turnPhase = useSessionStore((s) => s.turns[s.activeId]?.phase)
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
  const clearCompaction = useSessionStore((s) => s.clearCompaction)
  // Do not `?? []` here — a fresh array each snapshot loops zustand/React.
  const compactions = useSessionStore((s) => s.compactions[s.activeId])
  const cliHost = useSessionStore(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.cliHost ?? null
  )
  const cliAgents = useSessionStore((s) => s.settings.cliAgents)

  const emptyLogoAgent = useMemo(() => {
    if (cliHost && isStructuredCliHost(cliHost)) {
      const named = enabledCliAgents(cliAgents).find((a) => a.id === cliHost)
      return {
        id: cliHost,
        name: named?.name ?? displayNameForCliHost(cliHost)
      }
    }
    return { id: 'vav', name: t('agents.plainShell') }
  }, [cliHost, cliAgents, t])

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  /** Sticky follow flag — only flipped by clear user intent or return-to-bottom. */
  const pinnedToBottom = useRef(true)
  /**
   * After programmatic follow: ignore onScroll so layout lag cannot unpin.
   * After user scroll-up: briefly ignore re-pin so a same-frame onScroll at
   * distance≈0 cannot immediately re-stick and yank the viewport down.
   */
  const suppressUnpinUntil = useRef(0)
  const suppressRepinUntil = useRef(0)
  /**
   * Branch pager (and similar) wants a forced pin+scroll. Stream end also
   * updates `activeLeaf` (user → assistant) — that must NOT re-pin if the user
   * scrolled up to read history.
   */
  const forcePinOnNextLeaf = useRef(false)
  const prevLeaf = useRef(activeLeaf)
  const prevActiveId = useRef(activeId)
  const [branchSwap, setBranchSwap] = useState(0)
  const [branchSwapActive, setBranchSwapActive] = useState(false)
  /** Scroll metrics for the virtual window (rAF-coalesced). */
  const [view, setView] = useState({ top: 0, height: 600 })
  const heightsRef = useRef(new Map<string, number>())
  const [heightEpoch, setHeightEpoch] = useState(0)
  /** Keep a search/flash target mounted even when outside the estimated window. */
  const [anchorMessageId, setAnchorMessageId] = useState<string | null>(null)

  const followToBottom = useCallback((): void => {
    const el = scrollRef.current
    if (!el || !pinnedToBottom.current) return
    // Hold unpin long enough that lag from large layout jumps cannot kill follow.
    suppressUnpinUntil.current = performance.now() + PROGRAMMATIC_SUPPRESS_MS
    scrollToBottomNow(el)
    // Double rAF: first paint may still have a stale scrollHeight (tool card
    // open, markdown reflow). Snap again after layout settles.
    window.requestAnimationFrame(() => {
      const a = scrollRef.current
      if (!a || !pinnedToBottom.current) return
      scrollToBottomNow(a)
      window.requestAnimationFrame(() => {
        const b = scrollRef.current
        if (!b || !pinnedToBottom.current) return
        scrollToBottomNow(b)
        suppressUnpinUntil.current = performance.now() + PROGRAMMATIC_SUPPRESS_MS
      })
    })
  }, [])

  const pinAndScrollToBottom = useCallback((): void => {
    pinnedToBottom.current = true
    suppressRepinUntil.current = 0
    followToBottom()
  }, [followToBottom])

  /**
   * Leaf changes for two reasons:
   * 1. Intentional (branch pager) → always pin + scroll to the new path end.
   * 2. Seal (user send seals, stream end moves leaf to assistant, …) →
   *    only follow if the user was already at the bottom. Re-pinning here was
   *    yanking readers back down every time a turn finished.
   */
  useEffect(() => {
    // Session switch already snaps the transcript — no branch-swap cinema.
    const switchedSession = prevActiveId.current !== activeId
    prevActiveId.current = activeId
    if (prevLeaf.current === activeLeaf) return
    const hadLeaf = prevLeaf.current != null
    prevLeaf.current = activeLeaf
    if (!hadLeaf || !activeLeaf) return

    let frame = 0
    let timer = 0
    if (!switchedSession) {
      setBranchSwap((n) => n + 1)
      setBranchSwapActive(false)
      frame = window.requestAnimationFrame(() => setBranchSwapActive(true))
      timer = window.setTimeout(() => setBranchSwapActive(false), 280)
    } else {
      setBranchSwapActive(false)
    }

    const forceNav = forcePinOnNextLeaf.current
    forcePinOnNextLeaf.current = false
    // New user turn (send) lands the leaf on the user message — jump down so
    // the reply is visible. Stream completion lands on the assistant message
    // and must not re-pin if the user is reading above.
    const leafRole = (nodes ?? []).find((m) => m.id === activeLeaf)?.role
    const force = forceNav || leafRole === 'user'
    if (force) {
      pinAndScrollToBottom()
    } else if (pinnedToBottom.current) {
      // Still following — chase layout after stream seal.
      followToBottom()
    }
    // else: user scrolled away — leave viewport alone.

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      if (timer) window.clearTimeout(timer)
    }
  }, [activeLeaf, activeId, nodes, pinAndScrollToBottom, followToBottom])

  /**
   * Hysteresis on pin:
   * - following  → unpin only if distance > UNPIN_PX (clear leave)
   * - not following → pin only if distance ≤ REPIN_PX (really at bottom)
   *
   * Never re-pin from a half-scroll inside a large single band.
   */
  const onScroll = useCallback(() => {
    const now = performance.now()
    const element = scrollRef.current
    if (!element) return
    const distance = distanceFromBottom(element)
    if (pinnedToBottom.current) {
      if (now < suppressUnpinUntil.current) return
      if (distance > UNPIN_PX) pinnedToBottom.current = false
    } else {
      if (now < suppressRepinUntil.current) return
      if (distance <= REPIN_PX) pinnedToBottom.current = true
    }
    setView({ top: element.scrollTop, height: element.clientHeight })
  }, [])

  /**
   * Wheel/trackpad up: release follow on a clear upward gesture so stream
   * growth cannot re-trap the viewport. Micro-jitter is ignored.
   * Block re-pin for a short window so the matching onScroll (still near 0)
   * cannot stick us again before the scroll position moves.
   */
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY >= 0) return
    // Ignore trackpad noise at rest.
    if (event.deltaY > -6) return
    pinnedToBottom.current = false
    suppressUnpinUntil.current = 0
    // Keep unpinned until gesture + layout settle; then REPIN_PX applies.
    suppressRepinUntil.current = performance.now() + 280
  }, [])

  // Switching conversations always lands at the bottom and re-enables follow.
  useEffect(() => {
    heightsRef.current.clear()
    setAnchorMessageId(null)
    pinAndScrollToBottom()
  }, [activeId, pinAndScrollToBottom])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setView({ top: el.scrollTop, height: el.clientHeight })
  }, [activeId, messages.length])

  /**
   * Content height changes (stream tokens, tool cards, images, new messages).
   * ResizeObserver alone is not enough if a tick grows content after we scroll
   * to a stale height — combine with stream projection ticks.
   */
  useEffect(() => {
    const content = contentRef.current
    if (!content) return

    let raf = 0
    const scheduleFollow = (): void => {
      if (!pinnedToBottom.current) return
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        followToBottom()
      })
    }

    const ro = new ResizeObserver(scheduleFollow)
    ro.observe(content)
    scheduleFollow()

    return () => {
      ro.disconnect()
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [activeId, followToBottom])

  /**
   * StreamProjection ticks every ~80ms while a turn is live — follow on each
   * publish when pinned. This is the reliable path for token deltas (content
   * often grows without a separate “message count” change).
   */
  useEffect(() => {
    const projection = getProjection(activeId)
    return projection.subscribe(() => {
      if (!pinnedToBottom.current) return
      followToBottom()
    })
  }, [activeId, followToBottom])

  // New sealed messages / phase changes — snap once so send feels instant.
  useEffect(() => {
    if (!pinnedToBottom.current) return
    followToBottom()
  }, [messages.length, turnPhase, followToBottom])

  // Search hit: leave the bottom band so the stream does not yank the match.
  useEffect(() => {
    if (!search.open) return
    const id = search.matchIds[search.index]
    if (!id) return
    pinnedToBottom.current = false
    suppressUnpinUntil.current = 0
    suppressRepinUntil.current = performance.now() + 400
    setAnchorMessageId(id)
    // Wait a frame so the virtual window mounts the row.
    window.requestAnimationFrame(() => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [search.open, search.index, search.tick, search.matchIds])

  // Quote strip / bubble citation: jump + 1.5s yellow flash.
  useEffect(() => {
    if (!flashMessageId || flashTick === 0) return
    pinnedToBottom.current = false
    suppressUnpinUntil.current = 0
    suppressRepinUntil.current = performance.now() + 400
    setAnchorMessageId(flashMessageId)
    window.requestAnimationFrame(() => {
      document
        .getElementById(`msg-${flashMessageId}`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
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
      // Explicit branch navigation: land at the end of the chosen path.
      forcePinOnNextLeaf.current = true
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

  const isEmpty = messages.length === 0 && !turnRunning
  const rootBranch = branches.get(ROOT_LEAF)

  // Manual compact is VAV-only; CLI hosts manage their own context.
  const activeCompaction = useMemo(
    () =>
      cliHost
        ? null
        : compactionForLeaf(compactions ?? null, nodes ?? [], activeLeaf),
    [cliHost, compactions, nodes, activeLeaf]
  )
  /**
   * Index of the first message still sent in full to the model.
   * The compact log sits *here* (after folded, before kept + any later sends),
   * not at the end of the list — otherwise a new user bubble jumps above the log.
   */
  const boundary = useMemo(
    () => compactionBoundaryIndex(messages, activeCompaction),
    [messages, activeCompaction]
  )
  const showCompactLog = !!activeCompaction && boundary > 0

  const items = useMemo((): TranscriptItem[] => {
    const out: TranscriptItem[] = []
    const before = showCompactLog ? messages.slice(0, boundary) : messages
    const after = showCompactLog ? messages.slice(boundary) : []
    for (const message of before) {
      out.push({ key: message.id, kind: 'message', message })
    }
    if (showCompactLog && activeCompaction) {
      out.push({
        key: `compaction:${activeCompaction.leafId}:${activeCompaction.createdAt}`,
        kind: 'compaction',
        compaction: activeCompaction
      })
    }
    for (const message of after) {
      out.push({ key: message.id, kind: 'message', message })
    }
    return out
  }, [messages, boundary, showCompactLog, activeCompaction])

  void heightEpoch
  const virtualize = items.length > VIRTUALIZE_AFTER
  const range = useMemo(() => {
    if (!virtualize) return { start: 0, end: items.length }
    const n = items.length
    if (pinnedToBottom.current) {
      const start = Math.max(0, n - KEEP_TAIL)
      return { start, end: n }
    }
    const heights = heightsRef.current
    let start = 0
    let acc = 0
    while (start < n && acc + (heights.get(items[start]!.key) ?? EST_ROW_PX) < view.top) {
      acc += heights.get(items[start]!.key) ?? EST_ROW_PX
      start++
    }
    start = Math.max(0, start - OVERSCAN_ROWS)
    let end = start
    let covered = 0
    const budget = view.height + OVERSCAN_ROWS * EST_ROW_PX * 2
    while (end < n && covered < budget) {
      covered += heights.get(items[end]!.key) ?? EST_ROW_PX
      end++
    }
    end = Math.min(n, end + OVERSCAN_ROWS)

    if (anchorMessageId) {
      const idx = items.findIndex(
        (it) => it.kind === 'message' && it.message.id === anchorMessageId
      )
      if (idx >= 0) {
        start = Math.min(start, Math.max(0, idx - OVERSCAN_ROWS))
        end = Math.max(end, Math.min(n, idx + OVERSCAN_ROWS + 1))
      }
    }
    return { start, end }
  }, [virtualize, items, view.top, view.height, anchorMessageId, heightEpoch])

  const padTop = virtualize ? estimateOffset(items, range.start, heightsRef.current) : 0
  const padBottom = virtualize
    ? estimateOffset(items, items.length, heightsRef.current) -
      estimateOffset(items, range.end, heightsRef.current)
    : 0

  const measureItem = useCallback((key: string, node: HTMLElement | null) => {
    if (!node) return
    const height = node.getBoundingClientRect().height
    if (height <= 0) return
    const prev = heightsRef.current.get(key)
    if (prev !== undefined && Math.abs(prev - height) < 2) return
    heightsRef.current.set(key, height)
    setHeightEpoch((n) => n + 1)
  }, [])

  const renderItem = (item: TranscriptItem): React.JSX.Element => {
    if (item.kind === 'compaction') {
      return (
        <div
          key={item.key}
          ref={(node) => measureItem(item.key, node)}
          className="transcript-virtual-item"
        >
          <CompactionBanner
            compaction={item.compaction}
            busy={turnRunning}
            onClear={() => void clearCompaction()}
          />
        </div>
      )
    }
    const message = item.message
    const branch = branches.get(message.id)
    return (
      <div
        key={item.key}
        ref={(node) => measureItem(item.key, node)}
        className="transcript-virtual-item"
      >
        <MessageRow
          message={message}
          highlight={highlight && search.matchIds.includes(message.id) ? highlight : undefined}
          isCurrentMatch={message.id === currentMatchId}
          flash={flashMessageId === message.id ? flashTick : 0}
          branchIndex={branch?.index ?? 0}
          branchCount={branch?.targets.length ?? 1}
          busy={turnRunning}
          onStepBranch={onStepBranch}
          onRegenerate={regenerate}
          onEdit={editUserMessage}
          onQuote={onQuote}
          onFork={fork}
          onContinueInNewSession={continueInNewSession}
        />
      </div>
    )
  }

  const visibleItems = virtualize ? items.slice(range.start, range.end) : items

  return (
    <div className="transcript" ref={scrollRef} onScroll={onScroll} onWheel={onWheel}>
      <div
        ref={contentRef}
        className={`transcript-inner${branchSwapActive ? ' is-branch-swap' : ''}`}
      >
        {isEmpty && (
          /* One empty tree — swapping nokey/ready remounted the agent name and
             replayed stagger while `.is-entering` was still on. */
          <EmptyState
            layout="session"
            logo={<AgentBrandMark agent={emptyLogoAgent} size={96} />}
            logoKey={emptyLogoAgent.id}
            logoLabel={emptyLogoAgent.name}
            enterKey={activeId}
            title={!apiKeyPresent ? t('transcript.configureKey') : undefined}
            description={!apiKeyPresent ? t('transcript.configureKeyDesc') : undefined}
            foot={<SessionWorkspaceChrome />}
          >
            {!apiKeyPresent ? (
              <Button
                label={t('transcript.openSettings')}
                variant="primary"
                onClick={() => openSettings('api')}
              />
            ) : null}
          </EmptyState>
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

        {padTop > 0 ? <div style={{ height: padTop }} aria-hidden /> : null}
        {visibleItems.map(renderItem)}
        {padBottom > 0 ? <div style={{ height: padBottom }} aria-hidden /> : null}

        <StreamingMessage conversationId={activeId} />
      </div>
    </div>
  )
}
