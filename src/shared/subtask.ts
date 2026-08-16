/**
 * Shared helpers for subagent / subtask tool cards.
 *
 * OpenCode emits a first-class `subtask` part plus child sessions; Claude
 * streams Task-tool children with `parent_tool_use_id`. Both project onto a
 * `task` ToolCallBlock whose `children` hold the nested transcript.
 */
import type { MessageBlock, ToolCallBlock, ToolCallStatus } from './types'

export function isTaskToolName(raw: string): boolean {
  const n = raw.toLowerCase().replace(/[^a-z0-9_]/g, '')
  return (
    n === 'task' ||
    n === 'subtask' ||
    n === 'taskcreate' ||
    n === 'tasktool' ||
    n === 'spawnagent' ||
    n === 'subagent' ||
    n === 'delegatetask' ||
    n === 'delegate'
  )
}

const SESSION_ID_KEYS = [
  'sessionId',
  'sessionID',
  'session_id',
  'childSessionId',
  'child_session_id',
  'task_id',
  'taskId'
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Child session id from a task tool's input / metadata (OpenCode). */
export function childSessionIdFrom(input: unknown, metadata?: unknown): string | null {
  const bags: Record<string, unknown>[] = []
  const push = (value: unknown): void => {
    const rec = asRecord(value)
    if (rec) bags.push(rec)
  }
  push(input)
  push(metadata)
  for (const rec of [...bags]) {
    push(rec.session)
    push(rec.metadata)
    push(rec.state)
  }
  for (const rec of bags) {
    for (const key of SESSION_ID_KEYS) {
      const value = rec[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return null
}

export function findToolBlock(blocks: MessageBlock[], id: string): ToolCallBlock | null {
  for (const block of blocks) {
    if (block.kind !== 'toolCall') continue
    if (block.id === id) return block
    if (block.children?.length) {
      const hit = findToolBlock(block.children, id)
      if (hit) return hit
    }
  }
  return null
}

/** Index of the top-level tool card that owns `id` (itself or a descendant). */
export function topLevelToolIndex(blocks: MessageBlock[], id: string): number | null {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block?.kind !== 'toolCall') continue
    if (block.id === id || findToolBlock(block.children ?? [], id)) return i
  }
  return null
}

export function expireOpenTools(blocks: MessageBlock[], cancelled: boolean): void {
  const next: ToolCallStatus = cancelled ? 'expired' : 'skipped'
  for (const block of blocks) {
    if (block.kind !== 'toolCall') continue
    if (block.status === 'pending' || block.status === 'executing') block.status = next
    if (block.children?.length) expireOpenTools(block.children, cancelled)
  }
}

export function snapshotToolBlock(block: ToolCallBlock): ToolCallBlock {
  return {
    ...block,
    children: block.children ? [...block.children] : undefined
  }
}
