import { useEffect, useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import {
  CLI_SURFACE_KEY,
  useWorkspaceStore,
  type TerminalLayoutNode,
  type TerminalSplitAxis
} from '../state/workspaceStore'
import {
  acquireTerminal,
  blitTerminal,
  claimTerminalAttach,
  pauseTerminalPaint,
  resumeTerminalPaint,
  scheduleParkIfOrphaned
} from '../lib/terminalRegistry'
import { proposedCellsDiffer } from '../lib/terminalFit'
import { isPendingCliTabId } from '../lib/cliPendingLayout'
import { requestCloseAgentTab, setUiFocusScope } from '../lib/uiFocus'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'
import { CliAgentPicker } from './CliAgentPicker'

function countLeaves(node: TerminalLayoutNode | null): number {
  if (!node) return 0
  if (node.type === 'leaf') return 1
  return countLeaves(node.children[0]) + countLeaves(node.children[1])
}

function layoutLeaves(node: TerminalLayoutNode): string[] {
  if (node.type === 'leaf') return [node.tabId]
  return [...layoutLeaves(node.children[0]), ...layoutLeaves(node.children[1])]
}

function leafIsPending(
  tabId: string,
  tabs: Array<{ id: string; pendingCli?: boolean }> | undefined
): boolean {
  if (isPendingCliTabId(tabId)) return true
  return Boolean(tabs?.find((t) => t.id === tabId)?.pendingCli)
}

function escapeSlotSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function findTerminalSlot(
  surface: 'bash' | 'agent',
  tabId: string
): HTMLElement | null {
  const stack = document.querySelector(`.terminal-stack[data-terminal-surface="${surface}"]`)
  if (!(stack instanceof HTMLElement)) return null
  const slot = stack.querySelector(`[data-terminal-slot="${escapeSlotSelector(tabId)}"]`)
  return slot instanceof HTMLElement ? slot : null
}

/**
 * Multi-split terminal with a binary layout tree.
 * - `bash` (default): Tools-tray user shells
 * - `agent`: unified CLI Agent surface (picker panes + multi-type PTYs)
 */
export function TerminalPanel({
  visible,
  surface = 'bash'
}: {
  visible: boolean
  surface?: 'bash' | 'agent'
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const bashBackground = useSessionStore((s) => s.settings.bashBackground ?? 'theme')
  // Unified CLI surface (preferred) — falls back to legacy per-agent host.
  const agentSurface = useWorkspaceStore((s) => {
    if (surface !== 'agent') return null
    const ws = s.workspaces[activeId]
    if (!ws) return null
    return (
      ws.agentHostSessions[CLI_SURFACE_KEY] ??
      (ws.activeHostAgentId
        ? (ws.agentHostSessions[ws.activeHostAgentId] ?? null)
        : null)
    )
  })
  const agentHostLayout = agentSurface?.layout ?? null
  const agentHostActiveTabId = agentSurface?.activeTabId ?? ''
  const agentHostFirstTabId = agentSurface?.tabs[0]?.id ?? null
  const bashLayout = useWorkspaceStore((s) => s.workspaces[activeId]?.layout ?? null)
  const bashActiveTabId = useWorkspaceStore((s) => s.workspaces[activeId]?.activeTabId ?? '')
  const bashFirstTabId = useWorkspaceStore((s) => s.workspaces[activeId]?.tabs[0]?.id ?? null)
  const bashTabs = useWorkspaceStore((s) => s.workspaces[activeId]?.tabs)

  const layout = surface === 'agent' ? agentHostLayout : bashLayout
  const activeTabId = surface === 'agent' ? agentHostActiveTabId : bashActiveTabId
  const firstTabId = surface === 'agent' ? agentHostFirstTabId : bashFirstTabId
  const recoverId = activeTabId || firstTabId
  const displayLayout: TerminalLayoutNode | null =
    layout ?? (recoverId ? { type: 'leaf', tabId: recoverId, weight: 1 } : null)
  const empty = !displayLayout
  const multiPane = countLeaves(displayLayout) > 1
  const tabs = surface === 'agent' ? agentSurface?.tabs : bashTabs
  const leaves = displayLayout ? layoutLeaves(displayLayout) : []
  const layoutEpoch = leaves.join('\n')

  return (
    <div
      className="terminal-stack multi-split"
      data-empty={empty}
      data-terminal-surface={surface}
      data-bash-bg={surface === 'bash' ? bashBackground : undefined}
      data-multi-pane={multiPane ? 'true' : 'false'}
    >
      {empty ? (
        surface === 'agent' ? (
          <CliAgentPicker conversationId={activeId} />
        ) : (
          <EmptyState
            title={t('tools.noTerminalTitle')}
            description={t('tools.bashHint')}
          />
        )
      ) : (
        <>
          <div className="terminal-split-root">
            <LayoutNodeView
              conversationId={activeId}
              node={displayLayout}
              visible={visible}
              surface={surface}
              multiPane={multiPane}
            />
          </div>
          {leaves
            .filter((tabId) => !leafIsPending(tabId, tabs))
            .map((tabId) => (
              <TerminalHost
                key={`${activeId}:${tabId}`}
                conversationId={activeId}
                tabId={tabId}
                hidden={!visible}
                autoFocus={visible && tabId === activeTabId}
                surface={surface}
                layoutEpoch={layoutEpoch}
              />
            ))}
        </>
      )}
    </div>
  )
}

function leafIds(node: TerminalLayoutNode): string {
  if (node.type === 'leaf') return node.tabId
  return `${leafIds(node.children[0])}/${leafIds(node.children[1])}`
}

function layoutNodeKey(node: TerminalLayoutNode): string {
  return node.type === 'leaf' ? node.tabId : `split:${leafIds(node)}`
}

function findBranch(
  root: TerminalLayoutNode,
  branchKey: string
): TerminalLayoutNode | null {
  if (root.type === 'leaf') return null
  if (leafIds(root) === branchKey) return root
  return findBranch(root.children[0], branchKey) ?? findBranch(root.children[1], branchKey)
}

/**
 * Map pointer delta (px) → flex weight delta using the branch's real size so the
 * divider tracks the mouse 1:1. The old fixed `/240` scale overshot (~2×) on
 * typical agent panels whose flex track is ~480–960px.
 *
 * Resizer is a fixed 4px flex sibling; weights only share the remaining track.
 */
const SPLIT_RESIZER_PX = 4
const SPLIT_MIN_WEIGHT = 0.35

/**
 * Flex shorthand with basis 0 so row *and* column splits share space by weight.
 * A bare `flex: N` leaves basis `auto`, and xterm's intrinsic height then
 * collapses ⌘⇧D (top/bottom) panes to content size instead of 50/50.
 */
function splitFlex(weight: number): string {
  return `${Math.max(SPLIT_MIN_WEIGHT, weight)} 1 0%`
}

function adjustBranchWeightsByPixels(
  root: TerminalLayoutNode,
  branchKey: string,
  deltaPx: number,
  branchSizePx: number
): TerminalLayoutNode {
  const flexSpace = Math.max(1, branchSizePx - SPLIT_RESIZER_PX)
  const walk = (node: TerminalLayoutNode): TerminalLayoutNode => {
    if (node.type === 'leaf') return node
    const key = leafIds(node)
    if (key === branchKey) {
      const [a, b] = node.children
      const total = a.weight + b.weight
      const weightDelta = (deltaPx / flexSpace) * total
      const na = Math.max(
        SPLIT_MIN_WEIGHT,
        Math.min(total - SPLIT_MIN_WEIGHT, a.weight + weightDelta)
      )
      return {
        ...node,
        children: [
          { ...a, weight: na },
          { ...b, weight: total - na }
        ]
      }
    }
    return {
      ...node,
      children: [walk(node.children[0]), walk(node.children[1])]
    }
  }
  return walk(root)
}

function LayoutNodeView({
  conversationId,
  node,
  visible,
  surface,
  multiPane
}: {
  conversationId: string
  node: TerminalLayoutNode
  visible: boolean
  surface: 'bash' | 'agent'
  multiPane: boolean
}): React.JSX.Element {
  const t = useT()
  const activeTabId = useWorkspaceStore((s) => {
    if (surface === 'agent') {
      const ws = s.workspaces[conversationId]
      const surfaceHost =
        ws?.agentHostSessions[CLI_SURFACE_KEY] ??
        (ws?.activeHostAgentId
          ? ws.agentHostSessions[ws.activeHostAgentId]
          : undefined)
      return surfaceHost?.activeTabId ?? ''
    }
    return s.workspaces[conversationId]?.activeTabId ?? ''
  })
  const paneTab = useWorkspaceStore((s) => {
    if (node.type !== 'leaf') return null
    if (surface === 'agent') {
      const ws = s.workspaces[conversationId]
      const surfaceHost =
        ws?.agentHostSessions[CLI_SURFACE_KEY] ??
        (ws?.activeHostAgentId
          ? ws.agentHostSessions[ws.activeHostAgentId]
          : undefined)
      return surfaceHost?.tabs.find((t) => t.id === node.tabId) ?? null
    }
    return s.workspaces[conversationId]?.tabs.find((t) => t.id === node.tabId) ?? null
  })
  const pendingCli = !!paneTab?.pendingCli
  const selectTab = useWorkspaceStore((s) => s.selectTab)
  const selectAgentTab = useWorkspaceStore((s) => s.selectAgentTab)
  const closeTab = useWorkspaceStore((s) => s.closeTab)

  if (node.type === 'leaf') {
    const isActive = node.tabId === activeTabId
    return (
      <div
        className={`terminal-split-pane${isActive ? ' is-active' : ''}${pendingCli ? ' is-pending-cli' : ''}${multiPane ? ' is-multi' : ''}`}
        style={{ flex: splitFlex(node.weight) }}
        tabIndex={surface === 'agent' ? -1 : undefined}
        data-cli-pane={surface === 'agent' ? node.tabId : undefined}
        data-bash-pane={surface === 'bash' ? node.tabId : undefined}
        onMouseDown={(e) => {
          if (surface === 'agent') {
            selectAgentTab(conversationId, node.tabId)
            setUiFocusScope('agent')
            const pane = e.currentTarget
            requestAnimationFrame(() => {
              if (pendingCli) {
                // Pending: land on first agent option for keyboard pick.
                const first = pane.querySelector(
                  '.cli-agent-picker-item'
                ) as HTMLButtonElement | null
                try {
                  if (first) first.focus({ preventScroll: true })
                  else pane.focus({ preventScroll: true })
                } catch {
                  // ignore
                }
              } else {
                // Live PTY: ensure xterm textarea gets keys after pane click.
                focusXtermIn(pane)
              }
              setUiFocusScope('agent')
            })
          } else {
            selectTab(conversationId, node.tabId)
          }
        }}
      >
        {multiPane ? (
          <button
            type="button"
            className="terminal-split-pane-close"
            title={t('common.close')}
            aria-label={t('common.close')}
            onMouseDown={(e) => {
              e.stopPropagation()
              if (surface === 'agent') selectAgentTab(conversationId, node.tabId)
              else selectTab(conversationId, node.tabId)
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (surface === 'agent') {
                requestCloseAgentTab(conversationId, node.tabId)
              } else {
                closeTab(conversationId, node.tabId)
              }
            }}
          >
            <X size={12} strokeWidth={2} />
          </button>
        ) : null}
        {surface === 'agent' && pendingCli ? (
          <CliAgentPicker
            conversationId={conversationId}
            tabId={node.tabId}
            compact={multiPane}
          />
        ) : (
          <div
            className="terminal-host"
            data-terminal-slot={node.tabId}
            data-hidden={!visible ? 'true' : 'false'}
          />
        )}
      </div>
    )
  }

  const [a, b] = node.children
  const branchKey = leafIds(node)
  const direction: TerminalSplitAxis = node.direction

  return (
    <div
      className="terminal-split-branch"
      style={{ flexDirection: direction, flex: splitFlex(node.weight) }}
    >
      <LayoutNodeView
        key={layoutNodeKey(a)}
        conversationId={conversationId}
        node={a}
        visible={visible}
        surface={surface}
        multiPane={multiPane}
      />
      <div
        className={`terminal-split-resizer axis-${direction}`}
        data-branch-key={branchKey}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          const start = direction === 'column' ? event.clientY : event.clientX
          const branchEl = (event.currentTarget as HTMLElement).parentElement
          const branchSizePx =
            (direction === 'column' ? branchEl?.clientHeight : branchEl?.clientWidth) ?? 0
          if (branchSizePx <= 0) return
          const slice = useWorkspaceStore.getState().workspaces[conversationId]
          if (!slice) return
          const agentHostKey =
            surface === 'agent'
              ? slice.agentHostSessions[CLI_SURFACE_KEY]
                ? CLI_SURFACE_KEY
                : slice.activeHostAgentId
              : null
          const baseLayout =
            surface === 'agent'
              ? agentHostKey
                ? (slice.agentHostSessions[agentHostKey]?.layout ?? null)
                : null
              : slice.layout
          if (!baseLayout) return
          const startLayout = structuredClone(baseLayout) as TerminalLayoutNode
          // DOM-only during drag; commit layout once on pointerup (60fps feel).
          document.documentElement.dataset.resizing = 'true'
          document.body.style.cursor = direction === 'column' ? 'row-resize' : 'col-resize'
          document.body.style.userSelect = 'none'
          const childEls = branchEl
            ? ([...branchEl.children] as HTMLElement[]).filter(
                (el) => !el.classList.contains('terminal-split-resizer')
              )
            : []
          let latest = startLayout
          let raf = 0
          let pendingDelta = 0
          const paintWeights = (layout: TerminalLayoutNode): void => {
            const branch = findBranch(layout, branchKey)
            if (!branch || branch.type === 'leaf' || childEls.length < 2) return
            const [wa, wb] = branch.children
            childEls[0]!.style.flex = splitFlex(wa.weight)
            childEls[1]!.style.flex = splitFlex(wb.weight)
          }
          const onMove = (e: PointerEvent): void => {
            pendingDelta = (direction === 'column' ? e.clientY : e.clientX) - start
            if (raf) return
            raf = requestAnimationFrame(() => {
              raf = 0
              latest = adjustBranchWeightsByPixels(
                startLayout,
                branchKey,
                pendingDelta,
                branchSizePx
              )
              paintWeights(latest)
            })
          }
          const commitLayout = (next: TerminalLayoutNode): void => {
            useWorkspaceStore.setState((state) => {
              const cur = state.workspaces[conversationId]
              if (!cur) return state
              if (surface === 'agent' && agentHostKey) {
                const host = cur.agentHostSessions[agentHostKey]
                if (!host) return state
                return {
                  workspaces: {
                    ...state.workspaces,
                    [conversationId]: {
                      ...cur,
                      agentHostSessions: {
                        ...cur.agentHostSessions,
                        [agentHostKey]: { ...host, layout: next }
                      }
                    }
                  }
                }
              }
              return {
                workspaces: {
                  ...state.workspaces,
                  [conversationId]: { ...cur, layout: next }
                }
              }
            })
            useWorkspaceStore.getState().syncPtyLayouts(conversationId)
          }
          const onUp = (): void => {
            if (raf) cancelAnimationFrame(raf)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            delete document.documentElement.dataset.resizing
            commitLayout(latest)
            window.dispatchEvent(new Event('vav:resize-end'))
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        }}
      />
      <LayoutNodeView
        key={layoutNodeKey(b)}
        conversationId={conversationId}
        node={b}
        visible={visible}
        surface={surface}
        multiPane={multiPane}
      />
    </div>
  )
}

function focusXtermIn(host: HTMLElement | null): void {
  if (!host) return
  const ta = host.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
  if (!ta) return
  try {
    ta.focus({ preventScroll: true })
  } catch {
    ta.focus()
  }
  setUiFocusScope('agent')
}

function TerminalHost({
  conversationId,
  tabId,
  hidden,
  autoFocus,
  surface,
  layoutEpoch
}: {
  conversationId: string
  tabId: string
  hidden: boolean
  /** When false, fit/resize only — never yank focus from another pane’s picker. */
  autoFocus: boolean
  surface: 'bash' | 'agent'
  /** Changes when the split tree gains/loses a leaf — re-parent, do not remount. */
  layoutEpoch: string
}): null {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  /** Stable across Thread↔Swarm visibility toggles — do not tear down xterm. */
  const fitRef = useRef<(force?: boolean) => void>(() => {})
  const autoFocusRef = useRef(autoFocus)
  autoFocusRef.current = autoFocus

  useLayoutEffect(() => {
    const host = findTerminalSlot(surface, tabId)
    if (!host) {
      scheduleParkIfOrphaned(conversationId, tabId)
      return
    }
    claimTerminalAttach(conversationId, tabId)
    const entry = acquireTerminal({
      conversationId,
      tabId,
      fontFamily: `"${codeFont}", Menlo, Monaco, "Courier New", monospace`,
      fontSize: Math.max(11, fontSize - 1),
      surface,
      paintPaused: hidden
    })
    // Companion window parked this viewer — leave the xterm detached so we
    // do not steal PTY geometry. Thread keep-alive (hidden, not parked) stays.
    if (entry.parked) {
      return () => scheduleParkIfOrphaned(conversationId, tabId)
    }
    if (!hidden) entry.parked = false
    if (entry.container.parentElement !== host) {
      host.appendChild(entry.container)
    }
    blitTerminal(entry.term)

    let raf = 0
    let debounce: ReturnType<typeof setTimeout> | null = null
    let liveFitAt = 0
    let cancelled = false

    /** Only the focused window should fit→resize the shared PTY. */
    const fit = (force = false): void => {
      if (cancelled) return
      if (!force && !document.hasFocus()) return
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      // Parked / Thread-hidden hosts keep last geometry — never SIGWINCH.
      if (entry.parked || entry.paintPaused || host.dataset.hidden === 'true') return
      try {
        const dims = entry.fit.proposeDimensions?.()
        if (!proposedCellsDiffer(entry.term.cols, entry.term.rows, dims)) return
        entry.fit.fit()
      } catch {
        // ignore
      }
    }
    fitRef.current = fit

    /** Retry fit until the flex pane has non-zero size (picker → live swap). */
    const fitWhenReady = (attempt: number): void => {
      if (cancelled) return
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        if (host.dataset.hidden !== 'true') {
          fit()
          if (autoFocusRef.current) focusXtermIn(host)
        }
        return
      }
      if (attempt < 12) {
        requestAnimationFrame(() => fitWhenReady(attempt + 1))
      }
    }

    // Live window / panel drag: track the pointer, but not every frame —
    // FitAddon.clear() + alt-buffer rebuilds flash the whole column (and the
    // Files / preview empty states beside it). PTY SIGWINCH stays gated in
    // terminalRegistry until settle.
    const scheduleFit = (): void => {
      if (host.dataset.hidden === 'true') return
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        if (document.documentElement.dataset.resizing === 'true') {
          const now = performance.now()
          if (now - liveFitAt < 80) return
          liveFitAt = now
          fit()
          return
        }
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          debounce = null
          fit()
        }, 180)
      })
    }
    const onResizeEnd = (): void => {
      if (debounce) {
        clearTimeout(debounce)
        debounce = null
      }
      // Triple-rAF after maximize/restore: native frame → flex → final host box.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => fit(true))
        })
      })
    }
    const onFocus = (): void => {
      // Reclaim PTY geometry when this window becomes frontmost.
      requestAnimationFrame(() => fit(true))
    }
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(host)
    // Also watch the split pane — host may be 0×0 for a frame after reparent.
    const pane = host.parentElement
    if (pane) observer.observe(pane)
    window.addEventListener('vav:resize-end', onResizeEnd)
    window.addEventListener('focus', onFocus)
    // Initial mount / reuse: wait for layout, then fit (+ focus only if active).
    requestAnimationFrame(() => fitWhenReady(0))

    return () => {
      cancelled = true
      observer.disconnect()
      window.removeEventListener('vav:resize-end', onResizeEnd)
      window.removeEventListener('focus', onFocus)
      if (raf) cancelAnimationFrame(raf)
      if (debounce) clearTimeout(debounce)
      if (entry.container.parentElement === host) {
        host.removeChild(entry.container)
      }
      scheduleParkIfOrphaned(conversationId, tabId)
    }
    // autoFocus stays out (picker must keep keys). layoutEpoch re-parents
    // into the new slot; hidden reclaim re-attaches after a companion closes.
  }, [conversationId, tabId, codeFont, fontSize, surface, layoutEpoch, hidden])

  // Pause canvas work while Thread (or another surface) covers this pane.
  // Resume replays the last PTY screen — do not keep writing hidden xterms.
  useEffect(() => {
    if (hidden) {
      pauseTerminalPaint(conversationId, tabId)
      return
    }
    resumeTerminalPaint(conversationId, tabId)
    let cancelled = false
    const run = (attempt: number): void => {
      if (cancelled) return
      const host = findTerminalSlot(surface, tabId)
      if (!host) return
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        fitRef.current()
        if (autoFocus) focusXtermIn(host)
        return
      }
      if (attempt < 12) requestAnimationFrame(() => run(attempt + 1))
    }
    requestAnimationFrame(() => run(0))
    return () => {
      cancelled = true
    }
  }, [hidden, conversationId, tabId, autoFocus, surface, layoutEpoch])

  return null
}
