/**
 * Simple left-to-right tree layout for mind-map canvas.
 */

import type { MindNode } from '@shared/mindmap'

export type LaidOutNode = {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  depth: number
  parentId: string | null
}

export type MindLayout = {
  nodes: LaidOutNode[]
  edges: Array<{ from: string; to: string }>
  width: number
  height: number
}

const NODE_H = 32
const H_GAP = 48
const V_GAP = 12
const PAD = 32
const MIN_W = 72
const MAX_W = 220
const CHAR_W = 7.2

function measureTitle(title: string): number {
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(title.length * CHAR_W) + 24))
}

/** Subtree height including gaps. */
function subtreeHeight(node: MindNode): number {
  if (node.children.length === 0) return NODE_H
  let h = 0
  node.children.forEach((c, i) => {
    h += subtreeHeight(c)
    if (i < node.children.length - 1) h += V_GAP
  })
  return Math.max(NODE_H, h)
}

function layoutRec(
  node: MindNode,
  depth: number,
  x: number,
  yTop: number,
  parentId: string | null,
  out: LaidOutNode[],
  edges: Array<{ from: string; to: string }>
): void {
  const h = subtreeHeight(node)
  const w = measureTitle(node.title)
  const y = yTop + h / 2 - NODE_H / 2
  out.push({
    id: node.id,
    title: node.title,
    x,
    y,
    width: w,
    height: NODE_H,
    depth,
    parentId
  })
  if (parentId) edges.push({ from: parentId, to: node.id })

  let cy = yTop
  const childX = x + w + H_GAP
  for (const child of node.children) {
    const ch = subtreeHeight(child)
    layoutRec(child, depth + 1, childX, cy, node.id, out, edges)
    cy += ch + V_GAP
  }
}

export function layoutMindMap(root: MindNode): MindLayout {
  const nodes: LaidOutNode[] = []
  const edges: Array<{ from: string; to: string }> = []
  layoutRec(root, 0, PAD, PAD, null, nodes, edges)
  let maxX = 0
  let maxY = 0
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  return {
    nodes,
    edges,
    width: Math.max(maxX + PAD, 320),
    height: Math.max(maxY + PAD, 200)
  }
}
