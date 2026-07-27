/**
 * Domain model for vav.
 *
 * Mirrors README.rpml §6 (data & storage model). These types are shared by the
 * main process (owner of persistence + agent runtime) and the renderer.
 */

export type ToolName =
  | 'terminal'
  | 'wait'
  | 'read_bash_session'
  | 'fs_read'
  | 'fs_write'
  | 'fs_list'
  | 'request'
  | 'ask_user_question'
  | 'plan'

/**
 * What the tool card shows. The schema names above are the model's ABI and
 * stay stable across the wire; these are the names for humans.
 */
export const TOOL_LABELS: Record<ToolName, string> = {
  terminal: '运行命令',
  wait: '等待输出',
  read_bash_session: '读取终端',
  fs_read: '读取文件',
  fs_write: '写入文件',
  fs_list: '列出目录',
  request: '请求确认',
  ask_user_question: '提问',
  plan: '计划'
}

export type PlanStepStatus = 'pending' | 'executing' | 'done' | 'error' | 'skipped'

export interface PlanStep {
  id: string
  title: string
  status: PlanStepStatus
  subtitle?: string
}

/** One question inside an ask_user_question card (single- or multi-question). */
export interface AskQuestion {
  question: string
  choices?: string[]
  /** When true and choices are present, render checkboxes; otherwise radios. */
  multiSelect?: boolean
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
  /** ask_user_question: flattened choices when the card is a single question. */
  choices?: string[]
  /** ask_user_question: whether those choices are multi-select. */
  multiSelect?: boolean
  /** ask_user_question: one or more questions for the interactive card. */
  questions?: AskQuestion[]
  /** ask_user_question: optional card title when N > 1. */
  askTitle?: string
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

/**
 * Agent plan checklist. Driven by the `plan` tool — a UI projection, not a
 * tool card the user expands (main-chat-streaming.rpml, Plan 模式).
 */
export interface PlanBlock {
  kind: 'plan'
  title: string
  steps: PlanStep[]
}

export type MessageBlock = ReasoningBlock | ToolCallBlock | TextBlock | PlanBlock

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
  /** Quoted prior message (composer 引用); content stays user-typed only. */
  quoteMessageId?: string
  quoteSummary?: string
  quoteRole?: 'user' | 'assistant'
}

/** Pending quote attached to the composer before send (main-chat.rpml §引用). */
export interface QuoteDraft {
  messageId: string
  summary: string
  role: 'user' | 'assistant'
}

/** One agent-loop usage sample for the context-window popover chart. */
export interface TokenSnapshot {
  turnIndex: number
  totalInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  newInputTokens: number
  outputTokens: number
  timestamp: number
  estimatedCost: number
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
  /** Set when this conversation was created via 复制会话. */
  duplicateSourceId: string | null
  /** Title of the source conversation at the moment of duplication. */
  duplicateSourceTitle: string | null
  /** Hidden from the main sidebar; opened via the archive view. */
  archived: boolean
  /** When the conversation was archived; orders the archive list. */
  archivedAt: number | null
  /** Tool approval policy for this conversation. */
  approvalMode: ApprovalMode
}

export interface Conversation extends ConversationMeta {
  /** Every node ever produced, in creation order — not the visible transcript. */
  messages: ChatMessage[]
  /** Selects which path through the tree is shown and sent to the model. */
  activeLeafId: string | null
  /** Recent turn usage samples (max 30) for the token-usage window. */
  tokenHistory: TokenSnapshot[]
  /** When the latest cache write was observed (Anthropic TTL clock). */
  cacheCreatedAt: number | null
  /** cacheCreatedAt + 5 minutes. */
  cacheExpiresAt: number | null
}

export type ShellKind = 'zsh' | 'bash' | 'fish' | 'powershell'
export type ThemeMode = 'light' | 'dark' | 'system'
/** Sidebar list grouping; default is time buckets ("无分组" in the UI). */
export type SidebarGroupingMode = 'none' | 'workspace' | 'source'
/** Per-conversation tool approval policy (main-chat.rpml). */
export type ApprovalMode = 'auto' | 'bypass' | 'edit'

/** Files panel browser layout (files-panel.rpml). */
export type FileViewMode = 'tree' | 'column'

/** UI language preference; `system` follows the OS locale. */
export type LocalePreference = 'system' | 'zh-CN' | 'en'
/** Resolved BCP-47 tag used for catalogs and date formatting. */
export type AppLocale = 'zh-CN' | 'en'

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
  /** UI language; default follows the OS. */
  locale: LocalePreference
  codeFont: string
  fontSize: number
  reduceMotion: boolean
  /** Electron accelerator, e.g. "Control+Command+Space". Empty disables. */
  globalHotkey: string
  /** Sidebar grouping segmented control; persisted. */
  sidebarGroupingMode: SidebarGroupingMode
  /** Files panel: indented tree vs Finder-style columns. */
  fileViewMode: FileViewMode
  /** Files panel sort field (Finder-style). */
  fileSortKey: FileSortKey
  fileSortAscending: boolean
  /**
   * Recently used non-Temporary working directories, most recent first.
   * Cap 10; Temporary Workspace paths are never recorded.
   */
  recentWorkspaceDirectories: string[]
  /** Master switch for OS notifications. */
  notificationsEnabled: boolean
  /** Play the system notification sound. */
  notificationSound: boolean
  notifyOnTurnComplete: boolean
  notifyOnAskUserQuestion: boolean
  notifyOnToolApproval: boolean
  notifyOnRequest: boolean
  /** Show the menu-bar tray icon. */
  trayEnabled: boolean
  /** macOS: hide Dock icon (accessory). Requires restart. */
  hideDockIcon: boolean
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
  locale: 'system',
  codeFont: 'SF Mono',
  fontSize: 12,
  reduceMotion: false,
  globalHotkey: 'Control+Command+Space',
  sidebarGroupingMode: 'none',
  fileViewMode: 'tree',
  fileSortKey: 'name',
  fileSortAscending: true,
  recentWorkspaceDirectories: [],
  notificationsEnabled: true,
  notificationSound: true,
  notifyOnTurnComplete: true,
  notifyOnAskUserQuestion: true,
  notifyOnToolApproval: true,
  notifyOnRequest: true,
  trayEnabled: true,
  hideDockIcon: false
}

export const FILE_SORT_OPTIONS: { key: FileSortKey; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'application', label: 'Application' },
  { key: 'dateAdded', label: 'Date Added' },
  { key: 'dateModified', label: 'Date Modified' },
  { key: 'dateCreated', label: 'Date Created' },
  { key: 'size', label: 'Size' },
  { key: 'tags', label: 'Tags' }
]

export function normalizeFileSortKey(key: FileSortKey | string | undefined): FileSortKey {
  if (key === 'date') return 'dateModified'
  if (FILE_SORT_OPTIONS.some((option) => option.key === key)) return key as FileSortKey
  return 'name'
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
  /** birthtime when available — used for Date Created / Date Added. */
  createdAt: number
  /** Present only on directories: null = not loaded yet, [] = loaded & empty. */
  children?: FileEntry[] | null
  /** Directory listings are capped; how many entries were dropped. */
  truncated?: number
}

/** Finder-style sort keys (files-panel.rpml). Legacy `date` maps to dateModified. */
export type FileSortKey =
  | 'none'
  | 'name'
  | 'kind'
  | 'application'
  | 'dateAdded'
  | 'dateModified'
  | 'dateCreated'
  | 'size'
  | 'tags'
  | 'date'

export interface DirectoryListing {
  path: string
  entries: FileEntry[]
  truncated: number
  error?: string
}

/** Never enumerated, at any depth (exact basenames). */
export const IGNORED_NAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  'DerivedData',
  '.build'
])
/** Directory/file name suffixes skipped alongside {@link IGNORED_NAMES}. */
export const IGNORED_SUFFIXES = ['.xcodeproj'] as const
export const DIRECTORY_ENTRY_CAP = 2000

/** True when a basename should stay out of the Files panel. */
export function isIgnoredName(name: string): boolean {
  if (IGNORED_NAMES.has(name)) return true
  return IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix))
}

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
  /** Plan checklist created or replaced in the streaming assistant message. */
  | { type: 'plan'; conversationId: string; index: number; block: PlanBlock }
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
  /** Usage sample from an agent loop (may fire mid-turn on tool boundaries). */
  | {
      type: 'usage'
      conversationId: string
      tokensUsed: number
      history: TokenSnapshot[]
      cacheCreatedAt: number | null
      cacheExpiresAt: number | null
    }
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
  /** In-flight assistant message id; used to hydrate a late-joining window. */
  messageId: string | null
  /** Snapshot of blocks so far; empty when idle. */
  blocks: MessageBlock[]
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
