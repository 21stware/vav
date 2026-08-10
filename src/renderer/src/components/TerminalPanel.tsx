import { useEffect, useRef } from 'react'
// useEffect still used by TerminalHost
import { useSessionStore } from '../state/sessionStore'
import {
  useWorkspaceStore,
  type TerminalLayoutNode,
  type TerminalSplitAxis
} from '../state/workspaceStore'
import { acquireTerminal } from '../lib/terminalRegistry'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'

/**
 * Multi-split terminal with a binary layout tree.
 * - `bash` (default): Tools-tray user shells
 * - `agent`: main-surface CLI agent host (separate store, never tools chips)
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
  const agentId = useWorkspaceStore((s) => s.workspaces[activeId]?.activeHostAgentId ?? null)
  const agentHostLayout = useWorkspaceStore((s) =>
    surface === 'agent' && agentId
      ? (s.workspaces[activeId]?.agentHostSessions[agentId]?.layout ?? null)
      : null
  )
  const agentHostActiveTabId = useWorkspaceStore((s) =>
    surface === 'agent' && agentId
      ? (s.workspaces[activeId]?.agentHostSessions[agentId]?.activeTabId ?? '')
      : ''
  )
  const agentHostFirstTabId = useWorkspaceStore((s) =>
    surface === 'agent' && agentId
      ? (s.workspaces[activeId]?.agentHostSessions[agentId]?.tabs[0]?.id ?? null)
      : null
  )
  const bashLayout = useWorkspaceStore((s) => s.workspaces[activeId]?.layout ?? null)
  const bashActiveTabId = useWorkspaceStore((s) => s.workspaces[activeId]?.activeTabId ?? '')
  const bashFirstTabId = useWorkspaceStore((s) => s.workspaces[activeId]?.tabs[0]?.id ?? null)

  const layout = surface === 'agent' ? agentHostLayout : bashLayout
  const activeTabId = surface === 'agent' ? agentHostActiveTabId : bashActiveTabId
  const firstTabId = surface === 'agent' ? agentHostFirstTabId : bashFirstTabId
  const recoverId = activeTabId || firstTabId
  const displayLayout: TerminalLayoutNode | null =
    layout ?? (recoverId ? { type: 'leaf', tabId: recoverId, weight: 1 } : null)
  const empty = !displayLayout

  return (
    <div
      className="terminal-stack multi-split"
      data-empty={empty}
      data-terminal-surface={surface}
    >
      {empty ? (
        <EmptyState
          title={
            surface === 'agent' ? t('agents.hostEmptyTitle') : t('tools.noTerminalTitle')
          }
          description={
            surface === 'agent' ? t('agents.hostEmptyDesc') : t('tools.bashHint')
          }
        />
      ) : (
        <div className="terminal-split-root">
          <LayoutNodeView
            conversationId={activeId}
            node={displayLayout}
            visible={visible}
            surface={surface}
          />
        </div>
      )}
    </div>
  )
}

function leafIds(node: TerminalLayoutNode): string {
  if (node.type === 'leaf') return node.tabId
  return `${leafIds(node.children[0])}/${leafIds(node.children[1])}`
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
  surface
}: {
  conversationId: string
  node: TerminalLayoutNode
  visible: boolean
  surface: 'bash' | 'agent'
}): React.JSX.Element {
  const agentId = useWorkspaceStore((s) => s.workspaces[conversationId]?.activeHostAgentId)
  const activeTabId = useWorkspaceStore((s) => {
    if (surface === 'agent') {
      const id = s.workspaces[conversationId]?.activeHostAgentId
      return id
        ? (s.workspaces[conversationId]?.agentHostSessions[id]?.activeTabId ?? '')
        : ''
    }
    return s.workspaces[conversationId]?.activeTabId ?? ''
  })
  const selectTab = useWorkspaceStore((s) => s.selectTab)
  const selectAgentTab = useWorkspaceStore((s) => s.selectAgentTab)
  void agentId

  if (node.type === 'leaf') {
    return (
      <div
        className={`terminal-split-pane${node.tabId === activeTabId ? ' is-active' : ''}`}
        style={{ flex: splitFlex(node.weight) }}
        onMouseDown={() =>
          surface === 'agent'
            ? selectAgentTab(conversationId, node.tabId)
            : selectTab(conversationId, node.tabId)
        }
      >
        <TerminalHost conversationId={conversationId} tabId={node.tabId} hidden={!visible} />
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
        conversationId={conversationId}
        node={a}
        visible={visible}
        surface={surface}
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
          const baseLayout =
            surface === 'agent'
              ? slice.activeHostAgentId
                ? slice.agentHostSessions[slice.activeHostAgentId]?.layout
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
              if (surface === 'agent' && cur.activeHostAgentId) {
                const host = cur.agentHostSessions[cur.activeHostAgentId]
                if (!host) return state
                return {
                  workspaces: {
                    ...state.workspaces,
                    [conversationId]: {
                      ...cur,
                      agentHostSessions: {
                        ...cur.agentHostSessions,
                        [cur.activeHostAgentId]: { ...host, layout: next }
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
        conversationId={conversationId}
        node={b}
        visible={visible}
        surface={surface}
      />
    </div>
  )
}

function TerminalHost({
  conversationId,
  tabId,
  hidden
}: {
  conversationId: string
  tabId: string
  hidden: boolean
}): React.JSX.Element {
  const codeFont = useSessionStore((s) => s.settings.codeFont)
  const fontSize = useSessionStore((s) => s.settings.fontSize)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const entry = acquireTerminal({
      conversationId,
      tabId,
      fontFamily: `"${codeFont}", Menlo, Monaco, "Courier New", monospace`,
      fontSize: Math.max(11, fontSize - 1)
    })
    host.appendChild(entry.container)

    let raf = 0
    let debounce: ReturnType<typeof setTimeout> | null = null
    let liveFitAt = 0
    /** Only the focused window should fit→resize the shared PTY. */
    const fit = (force = false): void => {
      if (!force && !document.hasFocus()) return
      if (host.clientWidth === 0 || host.clientHeight === 0) return
      // Hidden tools-tray hosts still sit in the layout; fitting them only
      // feeds the scrollbar↔cols oscillation that SIGWINCH-flashes the agent.
      if (!force && host.dataset.hidden === 'true') return
      try {
        const dims = entry.fit.proposeDimensions?.()
        if (
          dims &&
          dims.cols === entry.term.cols &&
          dims.rows === entry.term.rows
        ) {
          return
        }
        entry.fit.fit()
      } catch {
        // ignore
      }
    }
    // Live window / panel drag: track the pointer, but not every frame —
    // FitAddon.clear() + alt-buffer rebuilds flash the whole column (and the
    // Files / preview empty states beside it). PTY SIGWINCH stays gated in
    // terminalRegistry until settle.
    const scheduleFit = (): void => {
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
    window.addEventListener('vav:resize-end', onResizeEnd)
    window.addEventListener('focus', onFocus)
    // Initial mount: fit even if focus is racing ready-to-show.
    fit(true)

    return () => {
      observer.disconnect()
      window.removeEventListener('vav:resize-end', onResizeEnd)
      window.removeEventListener('focus', onFocus)
      if (raf) cancelAnimationFrame(raf)
      if (debounce) clearTimeout(debounce)
      if (entry.container.parentElement === host) host.removeChild(entry.container)
    }
  }, [conversationId, tabId, codeFont, fontSize])

  useEffect(() => {
    if (hidden) return
    const ta = hostRef.current?.querySelector(
      '.xterm-helper-textarea'
    ) as HTMLTextAreaElement | null
    ta?.focus()
  }, [hidden, tabId])

  return (
    <div
      className="terminal-host"
      ref={hostRef}
      data-hidden={hidden ? 'true' : 'false'}
      style={{ flex: 1, minHeight: 0, minWidth: 0 }}
    />
  )
}
