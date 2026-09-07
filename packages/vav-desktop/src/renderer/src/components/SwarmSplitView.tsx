import type { JSX } from 'react'
import type { TerminalLayoutNode, TerminalSplitAxis } from '@shared/types'
import { collectSwarmLeaves } from '@shared/swarmLayout'
import { useSessionStore } from '../state/sessionStore'
import { SessionPane } from './SessionPane'

const SPLIT_RESIZER_PX = 4
const SPLIT_MIN_WEIGHT = 0.35

function splitFlex(weight: number): string {
  return `${Math.max(SPLIT_MIN_WEIGHT, weight)} 1 0%`
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

export function SwarmSplitView({
  rootId,
  layout,
  compact
}: {
  rootId: string
  layout: TerminalLayoutNode
  compact: boolean
}): JSX.Element {
  const focusedId = useSessionStore((s) => s.activeId)
  const persist = (next: TerminalLayoutNode): void => {
    void window.vav.conversations.setSwarmLayout(rootId, next).then((list) => {
      useSessionStore.setState((state) => ({
        conversations: state.conversations.map((c) => list.find((n) => n.id === c.id) ?? c)
      }))
    })
  }

  return (
    <div
      className="terminal-stack multi-split session-swarm-split"
      data-testid="swarm-split"
      data-multi-pane={compact}
    >
      <div className="terminal-split-root">
        <LayoutNode
          rootId={rootId}
          node={layout}
          root={layout}
          compact={compact}
          focusedId={focusedId}
          onCommit={persist}
        />
      </div>
    </div>
  )
}

function LayoutNode({
  rootId,
  node,
  root,
  compact,
  focusedId,
  onCommit
}: {
  rootId: string
  node: TerminalLayoutNode
  root: TerminalLayoutNode
  compact: boolean
  focusedId: string
  onCommit: (next: TerminalLayoutNode) => void
}): JSX.Element {
  if (node.type === 'leaf') {
    return (
      <div
        className={`terminal-split-pane${node.tabId === focusedId ? ' is-active' : ''}${
          compact ? ' is-multi' : ''
        }`}
        style={{ flex: splitFlex(node.weight) }}
      >
        <SessionPane
          conversationId={node.tabId}
          compact={compact}
          focused={node.tabId === focusedId}
          onFocus={() => void useSessionStore.getState().selectConversation(node.tabId)}
          onClose={
            compact
              ? () => void useSessionStore.getState().closeSwarmPane(node.tabId)
              : undefined
          }
        />
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
      <LayoutNode
        key={layoutNodeKey(a)}
        rootId={rootId}
        node={a}
        root={root}
        compact={compact}
        focusedId={focusedId}
        onCommit={onCommit}
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
          const startLayout = structuredClone(root) as TerminalLayoutNode
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
          const finish = (): void => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', finish)
            delete document.documentElement.dataset.resizing
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            onCommit(latest)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', finish)
        }}
      />
      <LayoutNode
        key={layoutNodeKey(b)}
        rootId={rootId}
        node={b}
        root={root}
        compact={compact}
        focusedId={focusedId}
        onCommit={onCommit}
      />
    </div>
  )
}

export function swarmLayoutLeaves(layout: TerminalLayoutNode | null | undefined): string[] {
  return collectSwarmLeaves(layout)
}
