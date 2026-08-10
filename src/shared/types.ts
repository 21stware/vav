/**
 * Domain model for vav.
 *
 * Mirrors README.rpml §6 (data & storage model). These types are shared by the
 * main process (owner of persistence + agent runtime) and the renderer.
 */

import type { ChangeSet } from './changeSet'

export type ToolName =
  | 'terminal'
  | 'wait'
  | 'read_bash_session'
  | 'fs_read'
  | 'fs_write'
  | 'fs_list'
  | 'doc_search'
  | 'doc_fetch'
  | 'web_search'
  | 'web_fetch'
  | 'request'
  | 'ask_user_question'
  | 'plan'
  | 'sql_query'
  | 'load_skill'

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
  doc_search: '文档检索',
  doc_fetch: '取回文档块',
  web_search: '网页搜索',
  web_fetch: '抓取网页',
  request: '请求确认',
  ask_user_question: '提问',
  plan: '计划',
  sql_query: 'SQL 查询',
  load_skill: '加载技能'
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
  /**
   * Preview block references attached in the composer (file-preview edit).
   * Reconstituted into the model text as hidden context; the bubble body
   * stays user-typed only, exactly like {@link quoteSummary}.
   */
  contextBlocks?: PreviewRef[]
  /**
   * File Attachment Chip path at send time (snapshot). Shown on the message
   * like the composer chip; the model still sees the open file via system
   * prompt / focusedFilePath while the chip remains attached.
   */
  contextFile?: string
  /**
   * Paperclip paths attached at send time. Shown as chips; reconstituted for
   * the model in history (not baked into {@link content}).
   */
  attachments?: string[]
  /**
   * ChangeSet produced by this assistant turn (fs_write). Inline review card
   * in the transcript — not a full-screen takeover.
   */
  changeSetId?: string
}

/** Pending quote attached to the composer before send (main-chat.rpml §引用). */
export interface QuoteDraft {
  messageId: string
  summary: string
  role: 'user' | 'assistant'
}

/**
 * A block selected in the file-preview edit canvas, pinned above the composer
 * as a compact comment/reference chip. Sent to the model as hidden context.
 */
export interface PreviewRef {
  /** Stable identity for the chip (block id, scoped by file path). */
  id: string
  filePath: string
  /** Human label shown on the chip (block label or a lines range). */
  label: string
  startLine: number
  endLine: number
  /** Raw block content, streamed to the model but never into the bubble. */
  text: string
  /** File kind badge (e.g. TS, MD), shown for context. */
  badge?: string
  /**
   * Optional pick-mode note from the composer comment card. Stored with the
   * ref so the transcript can re-render the card UI; included in model text
   * via {@link formatPreviewContext}.
   */
  comment?: string
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
  /**
   * File-preview session key (inode:device or path-hash). When set, the
   * conversation is owned by FileSessionStore and hidden from the main sidebar.
   */
  fileId?: string | null
  /**
   * When true, the agent system prompt forbids file modifications (read-only
   * toggle on the File Preview chrome).
   */
  fileReadOnly?: boolean
  /**
   * CLI agent binary id for this session (matches {@link AgentConfig.id}).
   * Null = plain shell for new terminal splits (release 599702fe… terminal host).
   */
  agentBinaryName?: string | null
  /**
   * File currently focused in the workspace preview for this conversation.
   * Fed into the built-in agent system prompt and injected into CLI agent PTYs.
   */
  focusedFilePath?: string | null
}

/**
 * Configured CLI agent host entry (origin release 599702fe… §2.3 / §6).
 * vav spawns `binaryPath` as the PTY process (direct, not typed into a shell).
 */
export interface AgentConfig {
  /** Stable id (e.g. "claude", "codex", "custom-1"). */
  id: string
  /** Display name in the agent selector. */
  name: string
  /** Primary executable on PATH or absolute path. */
  binaryPath: string
  /**
   * Alternate command names tried when `binaryPath` is missing
   * (e.g. cursor-agent | agent, pi | pi-agent).
   */
  binaryCandidates?: string[]
  defaultArgs: string[]
  envVars: Record<string, string>
  enabled: boolean
  /** Optional Keychain provider key namespace (anthropic, openai, xai, …). */
  providerName?: string | null
  /** Built-in catalogue entry — not removable; path/args still editable. */
  builtin?: boolean
  /** Shell one-liner to install the CLI when missing from PATH. */
  installCommand?: string | null
  /** Docs / download page. */
  installDocsUrl?: string | null
}

/**
 * Well-known coding-agent CLIs — always present, no manual "add agent" needed.
 * User only needs the matching binary installed on PATH (or override the path).
 */
/**
 * Built-in catalogue — defaultArgs skip interactive security / approval prompts
 * so agents can run inside vav without stopping for tool confirmations.
 * Flags are CLI-specific (verified against each binary’s --help / docs).
 */
export const DEFAULT_CLI_AGENTS: AgentConfig[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    binaryPath: 'claude',
    binaryCandidates: ['claude'],
    // Tool approvals off; workspace trust is pre-seeded in ~/.claude.json
    // (see claudeTrust.ts) because this flag does not skip Trust Folder.
    defaultArgs: ['--dangerously-skip-permissions'],
    envVars: {},
    enabled: true,
    providerName: 'anthropic',
    builtin: true,
    // Official native installer (Claude Code docs)
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    installDocsUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview'
  },
  {
    id: 'codex',
    name: 'Codex',
    binaryPath: 'codex',
    binaryCandidates: ['codex'],
    // skip approvals + sandbox (alias: --yolo)
    defaultArgs: ['--dangerously-bypass-approvals-and-sandbox'],
    envVars: {},
    enabled: true,
    providerName: 'openai',
    builtin: true,
    // OpenAI Codex official install script
    installCommand: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    installDocsUrl: 'https://github.com/openai/codex'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    binaryPath: 'cursor-agent',
    binaryCandidates: ['cursor-agent', 'agent', 'cursor'],
    // --force: auto-allow tool/shell commands; --trust: skip workspace trust prompt
    defaultArgs: ['--force', '--trust'],
    envVars: {},
    enabled: true,
    providerName: null,
    builtin: true,
    // Cursor CLI official installer
    installCommand: 'curl -fsSL https://cursor.com/install | bash',
    installDocsUrl: 'https://cursor.com/docs/cli/overview'
  },
  {
    id: 'grok',
    name: 'Grok',
    binaryPath: 'grok',
    binaryCandidates: ['grok'],
    // auto-approve tools; bypassPermissions for the full permission cycle
    defaultArgs: ['--always-approve', '--permission-mode', 'bypassPermissions'],
    envVars: {},
    enabled: true,
    providerName: 'xai',
    builtin: true,
    // xAI Grok Build official installer
    installCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    installDocsUrl: 'https://docs.x.ai/build/overview'
  },
  {
    id: 'devin',
    name: 'Devin',
    binaryPath: 'devin',
    binaryCandidates: ['devin'],
    // bypass ≈ /yolo — auto-approve all tools
    defaultArgs: ['--permission-mode', 'bypass'],
    envVars: {},
    enabled: true,
    providerName: null,
    builtin: true,
    // Cognition Devin CLI official installer
    installCommand: 'curl -fsSL https://cli.devin.ai/install.sh | bash',
    installDocsUrl: 'https://docs.devin.ai/cli'
  },
  {
    id: 'pi',
    name: 'Pi',
    binaryPath: 'pi',
    binaryCandidates: ['pi', 'pi-agent'],
    // trust project-local settings without the interactive approve prompt
    defaultArgs: ['--approve'],
    envVars: {},
    enabled: true,
    providerName: null,
    builtin: true,
    // pi.dev official installer
    installCommand: 'curl -fsSL https://pi.dev/install.sh | sh',
    installDocsUrl: 'https://pi.dev/'
  }
]

/**
 * Ensure builtin safety/skip flags are present in a user-edited args list.
 * Does not reorder user args; only appends missing builtin tokens (and their
 * following values when the builtin flag takes a value, e.g. `--permission-mode X`).
 */
export function mergeBuiltinDefaultArgs(
  userArgs: string[] | null | undefined,
  builtinArgs: string[]
): string[] {
  const user = Array.isArray(userArgs)
    ? userArgs.filter((a): a is string => typeof a === 'string' && a.length > 0)
    : []
  if (user.length === 0) return [...builtinArgs]
  if (builtinArgs.length === 0) return user

  const out = [...user]
  for (let i = 0; i < builtinArgs.length; i++) {
    const flag = builtinArgs[i]!
    // Value for flags like `--permission-mode bypass` (next token without leading -)
    const next = builtinArgs[i + 1]
    const takesValue = !!next && !next.startsWith('-')
    if (takesValue) {
      const idx = out.indexOf(flag)
      if (idx < 0) {
        out.push(flag, next)
      } else if (out[idx + 1] !== next) {
        // Flag present with a different/missing value — force the bypass value
        if (out[idx + 1] && !out[idx + 1]!.startsWith('-')) out[idx + 1] = next
        else out.splice(idx + 1, 0, next)
      }
      i++ // consumed value
      continue
    }
    if (!out.includes(flag)) out.push(flag)
  }
  return out
}

/** Stable ids of the built-in catalogue (used when merging settings). */
export const BUILTIN_AGENT_IDS = DEFAULT_CLI_AGENTS.map((a) => a.id)

/**
 * Agents shown in the session switcher.
 * Falls back to the built-in catalogue when settings were saved with `cliAgents: []`.
 *
 * Results are cached by input-array identity so React/zustand getSnapshot can
 * call this repeatedly without seeing a new array every time (which used to
 * trip "Maximum update depth exceeded" in Sidebar / SessionDetail).
 */
let enabledCliAgentsCacheIn: AgentConfig[] | null | undefined = undefined
let enabledCliAgentsCacheOut: AgentConfig[] | null = null
let enabledCliAgentsFallback: AgentConfig[] | null = null

export function enabledCliAgents(cliAgents: AgentConfig[] | null | undefined): AgentConfig[] {
  if (cliAgents === enabledCliAgentsCacheIn && enabledCliAgentsCacheOut) {
    return enabledCliAgentsCacheOut
  }
  const list =
    Array.isArray(cliAgents) && cliAgents.length > 0
      ? cliAgents
      : (enabledCliAgentsFallback ??= DEFAULT_CLI_AGENTS.map((a) => ({
          ...a,
          envVars: { ...a.envVars },
          defaultArgs: [...a.defaultArgs],
          binaryCandidates: a.binaryCandidates ? [...a.binaryCandidates] : undefined
        })))
  const out = list.filter((a) => a.enabled !== false)
  enabledCliAgentsCacheIn = cliAgents
  enabledCliAgentsCacheOut = out
  return out
}

/**
 * Manual context compaction for one branch path.
 *
 * Full messages stay on disk; only {@link buildHistory} substitutes
 * {@link summary} for everything on the path before {@link keepAfterMessageId}.
 * UI can expand the originals anytime. One entry per leaf (re-compact replaces).
 */
export interface LeafCompaction {
  /** Active leaf when the user compacted (branch identity). */
  leafId: string
  /**
   * First message on the path that remains full for the model.
   * All earlier messages on that path are covered by {@link summary}.
   */
  keepAfterMessageId: string
  summary: string
  createdAt: number
  /** How many path messages were folded into the summary (UI). */
  compactedCount: number
  /**
   * Rough next-request input size after compact (summary + kept tail).
   * Used by the context-window ring / popup so fill shrinks immediately.
   */
  estimatedContextTokens: number
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
  /**
   * Per-leaf context compressions. Originals remain in {@link messages};
   * the model sees the summary + tail of the active path.
   */
  compactions?: LeafCompaction[]
}

export type ShellKind = 'zsh' | 'bash' | 'fish' | 'powershell'
export type ThemeMode = 'light' | 'dark' | 'system'
/**
 * Accent / surface tint.
 * - `system` (default): follow the OS accent colour (macOS / Windows).
 * - `mono`: black–white chrome.
 * - Fixed hues recolour interactive accents (and a soft selected wash) without
 *   changing theme.
 */
export type ColorTint =
  | 'system'
  | 'mono'
  | 'lavender'
  | 'blue'
  | 'teal'
  | 'rose'
  | 'amber'
  | 'green'
export const COLOR_TINTS: readonly ColorTint[] = [
  'system',
  'mono',
  'lavender',
  'blue',
  'teal',
  'rose',
  'amber',
  'green'
] as const
/** Sidebar list grouping; default is time buckets ("无分组" in the UI). */
export type SidebarGroupingMode = 'none' | 'workspace'
/** Per-conversation tool approval policy (main-chat.rpml). */
export type ApprovalMode = 'auto' | 'bypass' | 'edit'

/** Files panel browser layout (files-panel.rpml). */
export type FileViewMode = 'tree' | 'column'

/** UI language preference; `system` follows the OS locale. */
export type LocalePreference = 'system' | 'zh-CN' | 'en'
/** Resolved BCP-47 tag used for catalogs and date formatting. */
export type AppLocale = 'zh-CN' | 'en'

/**
 * Currency for estimated token-cost display. Model rates are USD; amounts are
 * converted with a static FX table for presentation only.
 */
export type DisplayCurrency =
  | 'USD'
  | 'CNY'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'HKD'
  | 'TWD'
  | 'KRW'
  | 'SGD'
  | 'AUD'
  | 'CAD'

export const DISPLAY_CURRENCIES: readonly DisplayCurrency[] = [
  'USD',
  'CNY',
  'EUR',
  'GBP',
  'JPY',
  'HKD',
  'TWD',
  'KRW',
  'SGD',
  'AUD',
  'CAD'
] as const

export interface AppSettings {
  apiEndpoint: string
  apiKeyPresent: boolean
  defaultModel: string
  /**
   * Last-used tool approval mode for new conversations (auto / bypass / edit).
   * Updated whenever the user changes the composer approval picker.
   */
  defaultApprovalMode: ApprovalMode
  customModels: string[]
  maxTokens: number
  temperature: number
  defaultWorkingDirectory: string
  shell: ShellKind
  /** Seconds. 10…600 step 10. Applies to one agent `terminal` tool call. */
  commandTimeout: number
  autoApproveReadonly: boolean
  /**
   * Master flag kept in sync with search/fetch (true if either is on).
   * Prefer {@link webSearchEnabled} / {@link webFetchEnabled} for per-tool control.
   */
  webToolsEnabled: boolean
  /**
   * When false, `web_search` is not offered to the model.
   * Network stays local-first: requests leave the machine only when enabled.
   */
  webSearchEnabled: boolean
  /**
   * When false, `web_fetch` is not offered to the model.
   */
  webFetchEnabled: boolean
  /**
   * Milliseconds for one web_search / web_fetch HTTP attempt (including redirects).
   * Clamped 5_000…60_000.
   */
  webTimeoutMs: number
  /**
   * Search backend preference. `auto` = Brave (if key) → SearXNG (if URL) → DuckDuckGo.
   */
  webSearchProvider: 'auto' | 'duckduckgo' | 'searxng' | 'brave'
  /**
   * Optional SearXNG (or compatible) base URL, e.g. http://127.0.0.1:8080.
   */
  webSearxngBaseUrl: string
  /**
   * When true, web_fetch may open a hidden Chromium view for thin SPA shells.
   * Off by default (faster, lower resource use).
   */
  webFetchAllowRender: boolean
  /**
   * Renderer-only: whether a Brave Search API key is stored (never the key itself).
   */
  braveSearchKeyPresent?: boolean
  theme: ThemeMode
  /**
   * Accent colour tint. Default `system` follows the OS accent; `mono` keeps
   * chrome black/white; fixed hues colour buttons, selection, links, and focus.
   */
  colorTint: ColorTint
  /** UI language; default follows the OS. */
  locale: LocalePreference
  /**
   * Currency used when showing estimated turn / session cost.
   * Does not change how providers bill — display conversion only.
   */
  displayCurrency: DisplayCurrency
  codeFont: string
  fontSize: number
  reduceMotion: boolean
  /**
   * macOS: system window vibrancy (desktop blur behind the sidebar).
   * Ignored on Windows / Linux. Default on.
   */
  windowVibrancyEnabled: boolean
  /**
   * How the main composer submits a message.
   * - `enter` (default): Enter sends; Shift+Enter inserts a newline.
   * - `mod-enter`: ⌘↵ / Ctrl+Enter sends; Enter inserts a newline.
   */
  sendKey: 'enter' | 'mod-enter'
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
  /**
   * Workspaces pinned to the sidebar's 置顶 section, most recently pinned first.
   * A pinned workspace moves out of its normal bucket and takes its sessions
   * with it, so the same path must never appear twice.
   */
  pinnedWorkspaceDirectories: string[]
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
  /**
   * When true, check GitHub Releases for a newer build shortly after launch.
   * Manual “Check for Updates” in About always works regardless.
   */
  autoCheckUpdates: boolean
  /**
   * Configured CLI agents for the terminal host (release 599702fe…).
   * Defaults cover Claude Code, Codex, Cursor, Pi, Grok, Devin.
   */
  cliAgents: AgentConfig[]
  /** Default agent id for new terminal splits (null = plain shell). */
  defaultAgentId: string | null
  /**
   * When true, a square Agent mark sits outside the top-right of a selected
   * preview block (every file preview surface). Off hides the mark.
   */
  previewSelectionAgentMark: boolean
  /**
   * When true, Read mode still allows picking blocks for Agent context.
   * When false, block selection is Edit-only (Read is view + copy).
   */
  previewReadModeSelection: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiEndpoint: 'https://api.anthropic.com',
  apiKeyPresent: false,
  defaultModel: 'deepseek-v4-pro',
  defaultApprovalMode: 'auto',
  customModels: [],
  maxTokens: 8192,
  temperature: 0.7,
  defaultWorkingDirectory: '',
  shell: 'zsh',
  commandTimeout: 120,
  autoApproveReadonly: true,
  webToolsEnabled: true,
  webSearchEnabled: true,
  webFetchEnabled: true,
  webTimeoutMs: 15_000,
  webSearchProvider: 'auto',
  webSearxngBaseUrl: '',
  webFetchAllowRender: false,
  theme: 'system',
  colorTint: 'system',
  locale: 'system',
  displayCurrency: 'USD',
  codeFont: 'SF Mono',
  fontSize: 12,
  reduceMotion: false,
  windowVibrancyEnabled: true,
  sendKey: 'enter',
  globalHotkey: 'Control+Command+Space',
  sidebarGroupingMode: 'workspace',
  fileViewMode: 'tree',
  fileSortKey: 'name',
  fileSortAscending: true,
  recentWorkspaceDirectories: [],
  pinnedWorkspaceDirectories: [],
  notificationsEnabled: true,
  notificationSound: true,
  notifyOnTurnComplete: true,
  notifyOnAskUserQuestion: true,
  notifyOnToolApproval: true,
  notifyOnRequest: true,
  /** macOS optional menu-bar item; Windows always shows a tray (see NotificationCenter). */
  trayEnabled: false,
  hideDockIcon: false,
  autoCheckUpdates: true,
  cliAgents: DEFAULT_CLI_AGENTS.map((a) => ({ ...a, envVars: { ...a.envVars } })),
  /** null = plain vav shell (default host mode). */
  defaultAgentId: null,
  previewSelectionAgentMark: true,
  previewReadModeSelection: true
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
  /** CLI agent config id spawned in this pane (null = plain shell). */
  agentId?: string | null
  /** Flex weight for multi-split layout (default 1). */
  splitWeight?: number
}

/**
 * Split axis for a binary pane branch (VS Code style).
 * - `row` = left/right (⌘D)
 * - `column` = top/bottom (⌘⇧D)
 */
export type TerminalSplitAxis = 'row' | 'column'

/**
 * Binary split tree for terminal panes. Authoritative copy lives in the main
 * process so detached session windows restore the same directions/weights.
 */
export type TerminalLayoutNode =
  | { type: 'leaf'; tabId: string; weight: number }
  | {
      type: 'branch'
      direction: TerminalSplitAxis
      weight: number
      children: [TerminalLayoutNode, TerminalLayoutNode]
    }

/** Per-conversation terminal split trees shared across BrowserWindows. */
export interface ConversationPtyLayouts {
  /** Tools-tray plain bash. */
  bash: TerminalLayoutNode | null
  /** CLI agent id → host layout. */
  agents: Record<string, TerminalLayoutNode | null>
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
  /**
   * Workspace / UI notice (e.g. user discarded file changes). Shown muted in
   * the transcript and included in the next model history path.
   */
  | { type: 'notice'; conversationId: string; message: ChatMessage }
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
  /**
   * Agent turn wrote files. Review is inline in the transcript (not full-screen).
   * `messageId` is the assistant turn that produced the writes.
   * Prefer embedding `changeSet` so the renderer can paint without a get() race.
   */
  | {
      type: 'change-review'
      conversationId: string
      changeSetId: string
      pendingCount: number
      messageId?: string
      /** Full set when available — avoids "Loading changes…" after remount/next turn. */
      changeSet?: ChangeSet
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
  /** CFBundleVersion when available; falls back to the short version. */
  buildNumber: string
  electron: string
  userDataPath: string
  conversationsPath: string
}
