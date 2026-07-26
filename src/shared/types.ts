/**
 * Domain model for vav.
 *
 * Mirrors README.rpml §6 (data & storage model). These types are shared by the
 * main process (owner of persistence + agent runtime) and the renderer.
 */

export type ToolName =
  | 'terminal'
  | 'fs_read'
  | 'fs_write'
  | 'fs_list'
  | 'request'
  | 'ask_user_question'

/**
 * What the tool card shows. The schema names above are the model's ABI and
 * stay stable across the wire; these are the names for humans.
 */
export const TOOL_LABELS: Record<ToolName, string> = {
  terminal: '运行命令',
  fs_read: '读取文件',
  fs_write: '写入文件',
  fs_list: '列出目录',
  request: '请求确认',
  ask_user_question: '提问'
}

export type ToolCallStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'error'
  | 'skipped'
  | 'expired'

export interface ToolCallBlock {
  kind: 'toolCall'
  /** Provider-assigned tool_use id; the routing key for user-interactive tools. */
  id: string
  tool: ToolName
  /** One-line human summary rendered on the collapsed card. */
  summary: string
  /** Raw JSON string of the tool input, as produced by the model. */
  input: string
  output: string
  status: ToolCallStatus
  /** ask_user_question only: preset answers rendered as buttons. */
  choices?: string[]
  /** terminal only: which terminal tab mirrored this command. */
  targetTabId?: string
}

export interface ReasoningBlock {
  kind: 'reasoning'
  text: string
}

export interface TextBlock {
  kind: 'text'
  /** Full markdown source. Disk always stores the complete string, never chunks. */
  text: string
}

export type MessageBlock = ReasoningBlock | ToolCallBlock | TextBlock

export interface ChatMessage {
  id: string
  /**
   * The message this one replies to; null for the root of a conversation.
   *
   * Messages form a tree, not a list. Regenerating a reply, or editing a
   * prompt, adds a sibling under the same parent instead of appending — that
   * is what makes them alternate versions rather than extra records.
   */
  parentId: string | null
  role: 'user' | 'assistant' | 'system'
  /** Plain-text projection, used for in-transcript search and auto-title. */
  content: string
  blocks: MessageBlock[]
  createdAt: number
  /** Set when the turn producing this message was cancelled or failed. */
  cancelled?: boolean
  errorText?: string
}

export interface ConversationMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Absolute path, or null for a Temporary Workspace. */
  workingDirectory: string | null
  model: string
  tokensUsed: number
  tokenLimit: number
  /** Pinned rows sort above every time group, newest pin first. */
  pinned: boolean
  /** When the pin was set; orders the pinned section. Null when unpinned. */
  pinTime: number | null
}

export interface Conversation extends ConversationMeta {
  /** Every node ever produced, in creation order — not the visible transcript. */
  messages: ChatMessage[]
  /** Selects which path through the tree is shown and sent to the model. */
  activeLeafId: string | null
}

export type ShellKind = 'zsh' | 'bash' | 'fish' | 'powershell'
export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings {
  apiEndpoint: string
  apiKeyPresent: boolean
  defaultModel: string
  customModels: string[]
  maxTokens: number
  temperature: number
  defaultWorkingDirectory: string
  shell: ShellKind
  /** Seconds. 10…600 step 10. Applies to one agent `terminal` tool call. */
  commandTimeout: number
  autoApproveReadonly: boolean
  theme: ThemeMode
  codeFont: string
  fontSize: number
  reduceMotion: boolean
  /** Electron accelerator, e.g. "Control+Command+Space". Empty disables. */
  globalHotkey: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiEndpoint: 'https://api.anthropic.com',
  apiKeyPresent: false,
  defaultModel: 'deepseek-v4-pro',
  customModels: [],
  maxTokens: 8192,
  temperature: 0.7,
  defaultWorkingDirectory: '',
  shell: 'zsh',
  commandTimeout: 120,
  autoApproveReadonly: true,
  theme: 'system',
  codeFont: 'SF Mono',
  fontSize: 12,
  reduceMotion: false,
  globalHotkey: 'Control+Command+Space'
}

export interface ModelOption {
  id: string
  label: string
}

export const PRESET_MODELS: ModelOption[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5' },
  { id: 'gpt-4o', label: 'GPT-4o' }
]

/** Product-level cap: one agent turn may run at most 12 tool iterations. */
export const MAX_ITERATIONS = 12

/** Bytes of tool output forwarded to the model; the middle is elided head/tail. */
export const TOOL_OUTPUT_CAP = 20_000

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

export interface FileEntry {
  path: string
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
  /** Present only on directories: null = not loaded yet, [] = loaded & empty. */
  children?: FileEntry[] | null
  /** Directory listings are capped; how many entries were dropped. */
  truncated?: number
}

export type FileSortKey = 'name' | 'date' | 'size' | 'kind'

export interface DirectoryListing {
  path: string
  entries: FileEntry[]
  truncated: number
  error?: string
}

/** Never enumerated, at any depth. */
export const IGNORED_NAMES = new Set(['.git', 'node_modules', '.DS_Store'])
export const DIRECTORY_ENTRY_CAP = 2000

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

export interface TerminalTab {
  id: string
  title: string
  /** The Agent tab is a read-only mirror; it never hosts an interactive shell. */
  isAgent: boolean
}

// ---------------------------------------------------------------------------
// Turn events (main → renderer)
// ---------------------------------------------------------------------------

export type TurnPhase =
  | 'idle'
  | 'thinking'
  | 'outputting'
  | 'working'
  | 'awaiting-user'
  | 'cancelled'
  | 'error'

export type TurnEvent =
  | { type: 'start'; conversationId: string }
  /** The prompt this turn answers, as stored — carries its place in the tree. */
  | { type: 'user'; conversationId: string; message: ChatMessage }
  | { type: 'phase'; conversationId: string; phase: TurnPhase }
  /**
   * Coalesced token deltas. `kind` selects reasoning vs. markdown body.
   *
   * `index` is the block's position in the assistant message. It is not
   * implied by arrival order: a model that resumes talking after a tool call
   * reopens an earlier position, so the renderer places by index rather than
   * appending (see AgentRuntime `slotFor`).
   */
  | {
      type: 'delta'
      conversationId: string
      index: number
      kind: 'reasoning' | 'text'
      text: string
    }
  /** A tool card was created or transitioned; carries the whole block. */
  | { type: 'tool'; conversationId: string; index: number; block: ToolCallBlock }
  /** A user-interactive tool is blocking this turn. */
  | {
      type: 'awaiting'
      conversationId: string
      toolCallId: string
      index: number
      block: ToolCallBlock
    }
  /** Terminal tool finished: mirror the transcript into the Agent tab. */
  | { type: 'mirror'; conversationId: string; text: string }
  /** fs_write finished: refresh only this parent directory. */
  | { type: 'fs-changed'; conversationId: string; parentPath: string; filePath: string }
  /** Turn is over: the finished assistant message replaces all streaming state. */
  | {
      type: 'end'
      conversationId: string
      message: ChatMessage
      tokensUsed: number
      /** Fatal error text, shown in the error banner. */
      error?: string
      cancelled?: boolean
    }

export interface TurnStatus {
  conversationId: string
  isRunning: boolean
  phase: TurnPhase
  toolCount: number
  awaitingToolCallId: string | null
}

// ---------------------------------------------------------------------------
// Misc IPC payloads
// ---------------------------------------------------------------------------

export interface ValidateKeyResult {
  ok: boolean
  message: string
}

export interface AboutInfo {
  version: string
  electron: string
  userDataPath: string
  conversationsPath: string
}
