import type {
  AcpAuthMethod,
  AcpSessionState
} from '../../../shared/acpSession.ts'
import type {
  ApprovalMode,
  CliHostKind,
  ProviderResumeCursor,
  QuotaWindow,
  ThinkingLevel
} from '../../../shared/types.ts'
import type { HostProcess } from '../../host/HostProcess.ts'
import type { AcpFileAccess } from './acpFs.ts'

/** Normalized events from a CLI transport → CliAgentHost projects these to TurnEvent. */
export type DriverEvent =
  | { type: 'connected'; cursor: ProviderResumeCursor }
  | { type: 'turn-started' }
  | { type: 'text-delta'; text: string; parentId?: string }
  | { type: 'reasoning-delta'; text: string; parentId?: string }
  | {
      type: 'tool'
      id: string
      name: string
      /** Human-readable invocation title from the agent (e.g. ACP `title`); used as card summary. */
      title?: string
      input: unknown
      status: 'started' | 'updated' | 'completed' | 'error'
      output?: string
      /** Nest under this tool (Claude `parent_tool_use_id` / OpenCode child session). */
      parentId?: string
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
      type: 'elicitation'
      requestId: string
      toolCallId: string
      kind: 'plan_doc' | 'ask' | 'form' | 'url'
      title?: string
      input: unknown
    }
  | { type: 'session-state'; state: AcpSessionState }
  | {
      type: 'model-applied'
      modelId: string
      thinkingLevel?: ThinkingLevel
      fast?: boolean
    }
  | { type: 'auth-required'; methods: AcpAuthMethod[] }
  | { type: 'fs-write'; path: string; original: string | null; content: string }
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
  | {
      type: 'turn-finished'
      success: boolean
      error?: string
      /** Host interrupted / user-stopped this turn — not a failure. */
      cancelled?: boolean
      /** JSON-RPC / ACP error.code when the host sent one. */
      errorCode?: number
      /** Raw payload for the details sheet. */
      errorDetail?: string
      resumeAt?: string | null
    }
  | { type: 'error'; message: string; errorCode?: number; errorDetail?: string }
  | { type: 'process-exited'; code: number | null }

export interface DriverPromptExtras {
  attachments?: string[]
}

export interface DriverStartOptions {
  binary: string
  cwd: string
  approvalMode: ApprovalMode
  model?: string | null
  thinkingLevel?: ThinkingLevel | null
  fast?: boolean | null
  cursor?: ProviderResumeCursor | null
  env?: Record<string, string>
  /** Extra argv from AgentConfig.defaultArgs that are still relevant. */
  extraArgs?: string[]
  /** Workspace file I/O for ACP `fs/*` client methods. */
  files?: AcpFileAccess
  /** Spawn surface — local today, a remote daemon later. */
  hostProcess?: HostProcess
  /**
   * Called when resuming `cursor.sessionId` failed and the driver silently
   * fell back to a brand-new session. Returns a transcript preamble that the
   * driver prepends to the first prompt of the replacement session so the
   * conversation survives the swap (null when there is nothing to carry).
   */
  resumeHandoff?: () => string | null
}

export interface DriverControl {
  prompt(text: string, extras?: DriverPromptExtras): void
  /** Inject into the running turn when the transport supports it. */
  steer?(text: string): void
  supportsSteer(): boolean
  cancel(): void
  respond(requestId: string, optionId: 'allow' | 'deny', message?: string): void
  applyOptions?(opts: {
    model?: string | null
    thinkingLevel?: ThinkingLevel | null
    fast?: boolean | null
    approvalMode?: ApprovalMode
    /** ACP session/set_mode id (agent / plan / ask). */
    mode?: string | null
    configOption?: { id: string; value: string | boolean }
  }): boolean
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
