import type { ToolCallBlock, TurnPhase } from '@shared/types'
import { MarkdownSegmenter } from '../lib/segmenter'

/** UI refresh cadence during a turn. Deltas arriving between ticks accumulate. */
const TICK_MS = 80

export type StreamBlock =
  | { kind: 'reasoning'; key: string; text: string }
  | { kind: 'tool'; key: string; block: ToolCallBlock }
  | { kind: 'text'; key: string; sealed: string[]; tail: string }

export interface StreamSnapshot {
  active: boolean
  phase: TurnPhase
  blocks: StreamBlock[]
}

const EMPTY_SNAPSHOT: StreamSnapshot = { active: false, phase: 'idle', blocks: [] }

type Internal =
  | { kind: 'reasoning'; key: string; text: string }
  | { kind: 'tool'; key: string; block: ToolCallBlock }
  | { kind: 'text'; key: string; segmenter: MarkdownSegmenter }

/**
 * The live view of one in-flight turn.
 *
 * This deliberately sits outside React state: token deltas mutate it directly,
 * and a single 80 ms tick publishes a new snapshot. Only the component
 * subscribed to this projection re-renders — the finished transcript above it
 * never does (README §8, main-chat-streaming.rpml "流式不变量").
 */
export class StreamProjection {
  private listeners = new Set<() => void>()
  /** Sparse: indexed by the block's position in the assistant message. */
  private slots: (Internal | undefined)[] = []
  private phase: TurnPhase = 'idle'
  private active = false
  private dirty = false
  private timer: ReturnType<typeof setInterval> | null = null
  private snapshot: StreamSnapshot = EMPTY_SNAPSHOT

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): StreamSnapshot => this.snapshot

  start(): void {
    this.slots = []
    this.phase = 'thinking'
    this.active = true
    this.publish()
    this.ensureTicking()
  }

  setPhase(phase: TurnPhase): void {
    if (this.phase === phase) return
    this.phase = phase
    // Phase changes are structural, not token noise: publish immediately so the
    // composer and sidebar react without waiting for the next tick.
    this.publish()
  }

  appendText(index: number, text: string): void {
    const slot = this.slots[index]
    if (slot?.kind === 'text') slot.segmenter.push(text)
    else {
      const segmenter = new MarkdownSegmenter()
      segmenter.push(text)
      this.slots[index] = { kind: 'text', key: `t${index}`, segmenter }
    }
    this.dirty = true
    this.ensureTicking()
  }

  appendReasoning(index: number, text: string): void {
    const slot = this.slots[index]
    if (slot?.kind === 'reasoning') slot.text += text
    else this.slots[index] = { kind: 'reasoning', key: `r${index}`, text }
    this.dirty = true
    this.ensureTicking()
  }

  upsertTool(index: number, block: ToolCallBlock): void {
    this.slots[index] = { kind: 'tool', key: `c${block.id}`, block }
    // Tool state transitions are structural; show them without tick latency.
    this.publish()
  }

  /** Turn is over: the finished message takes over, so drop the live view. */
  end(): void {
    this.stopTicking()
    this.slots = []
    this.phase = 'idle'
    this.active = false
    this.dirty = false
    this.snapshot = EMPTY_SNAPSHOT
    this.notify()
  }

  private ensureTicking(): void {
    if (this.timer !== null || !this.active) return
    this.timer = setInterval(() => {
      if (!this.dirty) return
      this.publish()
    }, TICK_MS)
  }

  private stopTicking(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
  }

  private publish(): void {
    this.dirty = false
    const blocks: StreamBlock[] = []
    for (const block of this.slots) {
      // Holes are possible: a tool call's slot is claimed at toolcall_start,
      // and an index may be reserved before its first delta arrives.
      if (!block) continue
      if (block.kind === 'text') {
        blocks.push({
          kind: 'text',
          key: block.key,
          // Sealed chunk identities are stable, so memoised children skip re-render.
          sealed: block.segmenter.sealed,
          tail: block.segmenter.tail
        })
      } else {
        blocks.push(block)
      }
    }
    this.snapshot = { active: this.active, phase: this.phase, blocks }
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

const projections = new Map<string, StreamProjection>()

export function getProjection(conversationId: string): StreamProjection {
  let projection = projections.get(conversationId)
  if (!projection) {
    projection = new StreamProjection()
    projections.set(conversationId, projection)
  }
  return projection
}

export function disposeProjection(conversationId: string): void {
  projections.get(conversationId)?.end()
  projections.delete(conversationId)
}
