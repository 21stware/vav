import type {
  ApprovalMode,
  CliHostKind,
  ProviderResumeCursor,
  QuotaWindow
} from '@shared/types'

/** Normalized events from a CLI transport → CliAgentHost projects these to TurnEvent. */
export type DriverEvent =
  | { type: 'connected'; cursor: ProviderResumeCursor }
  | { type: 'turn-started' }
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | {
      type: 'tool'
      id: string
      name: string
      input: unknown
      status: 'started' | 'updated' | 'completed' | 'error'
      output?: string
    }
  | {
      type: 'permission'
      requestId: string
      toolName: string
      summary: string
      detail?: string
      input?: unknown
    }
  | {
      type: 'usage'
      /** Per-turn (or delta) input tokens, excluding cache-read when the host splits them. */
      inputTokens?: number
      outputTokens?: number
      cacheRead?: number
      cacheWrite?: number
      /** Absolute tokens currently in the context window (preferred for the ring). */
      contextUsed?: number
      /** Host-reported context window size. */
      contextSize?: number
      /** Host-reported cumulative session cost in USD. */
      sessionCostUsd?: number
      /** Host-reported cost for this turn sample in USD (optional). */
      turnCostUsd?: number
      /**
       * When false, update fill/limit/cost only — do not append a turn sample
       * (e.g. ACP `usage_update` has no per-turn breakdown).
       * Defaults to true when turn token fields are present.
       */
      recordHistory?: boolean
      /**
       * Live subscription / rate-limit windows with known used %.
       * Merged into the conversation by id (does not replace unknown windows).
       */
      quotaWindows?: QuotaWindow[]
    }
  | {
      type: 'quota'
      /** Windows with known used % from a live rate-limit stream event. */
      windows: QuotaWindow[]
    }
  | { type: 'turn-finished'; success: boolean; error?: string; resumeAt?: string | null }
  | { type: 'error'; message: string }
  | { type: 'process-exited'; code: number | null }

export interface DriverStartOptions {
  binary: string
  cwd: string
  approvalMode: ApprovalMode
  model?: string | null
  cursor?: ProviderResumeCursor | null
  env?: Record<string, string>
  /** Extra argv from AgentConfig.defaultArgs that are still relevant. */
  extraArgs?: string[]
}

export interface DriverControl {
  prompt(text: string): void
  /** Inject into the running turn when the transport supports it. */
  steer?(text: string): void
  supportsSteer(): boolean
  cancel(): void
  respond(requestId: string, optionId: 'allow' | 'deny', message?: string): void
  applyOptions?(opts: { model?: string | null; approvalMode?: ApprovalMode }): boolean
  dispose(): void
}

export type DriverEventSink = (event: DriverEvent) => void

export type DriverFactory = (
  options: DriverStartOptions,
  emit: DriverEventSink
) => Promise<DriverControl>

export interface CliHostDescriptor {
  kind: CliHostKind
  /** Binary candidates for resolveAgentExecutable. */
  candidates: string[]
}
