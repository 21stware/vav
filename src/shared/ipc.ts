import type {
  AboutInfo,
  AppLocale,
  AppSettings,
  Conversation,
  ConversationMeta,
  ConversationPtyLayouts,
  DirectoryListing,
  DisplayCurrency,
  FileSortKey,
  PreviewRef,
  QuoteDraft,
  ShellKind,
  ThemeMode,
  TokenSnapshot,
  TurnEvent,
  TurnStatus,
  ValidateKeyResult
} from './types'
import type { ChangeSet, UpdateState } from './changeSet'
import type { Platform } from './platform'

export interface Bootstrap {
  settings: AppSettings
  /** Resolved from settings.locale + OS; same value main uses for menus. */
  resolvedLocale: AppLocale
  /**
   * Current OS accent as `#rrggbb` (macOS / Windows). Used when
   * `settings.colorTint === 'system'`.
   */
  systemAccentColor: string
  conversations: ConversationMeta[]
  activeConversationId: string
  apiKeyHint: string | null
  platform: Platform
  home: string
  tmp: string
  about: AboutInfo
}

export interface PtyDataEvent {
  tabId: string
  data: string
}

/** Fired when a conversation's live PTY set changes (create/kill/exit). */
export interface PtyChangedEvent {
  conversationId: string
}

/**
 * What a terminal is doing, as the tab list reports it.
 *
 * `running` and `idle` are derived in main from stdout activity plus a
 * foreground-child check; `exited` is terminal — the PTY is gone and the tab
 * survives only as a tombstone until the user closes it.
 */
export type PtyActivityStatus = 'running' | 'idle' | 'exited'

export interface PtyStatusEvent {
  tabId: string
  conversationId: string
  status: PtyActivityStatus
}

/**
 * Snapshot of a live PTY — main is authoritative so detached + main windows
 * share the same tab ids / agent hosts instead of each spawning their own.
 */
export interface PtySessionMeta {
  id: string
  conversationId: string
  /** `null` bash · `vav` mirror · CLI agent id for host panes. */
  agentId: string | null
  title: string
  createdAt: number
  /** Live sessions only, so a freshly attached window paints the right dot. */
  status: Exclude<PtyActivityStatus, 'exited'>
}

/** Live PTYs plus the split trees every window must hydrate from. */
export interface PtyListResult {
  sessions: PtySessionMeta[]
  layouts: ConversationPtyLayouts
}

/** Options for `pty.create` — spawn a CLI agent directly into the PTY. */
export interface PtyCreateOptions {
  preferredId?: string
  /** Executable name or absolute path (Claude Code, Codex, …). */
  command?: string
  args?: string[]
  /** Alternate command names if `command` is not on PATH. */
  commandCandidates?: string[]
  env?: Record<string, string>
  /**
   * Ambient session context for the agent (focused file, block notes).
   * Injected at spawn via CLI flags when {@link contextLaunchStrategy} is a
   * launch-argv strategy (e.g. Claude). For `prompt-paste` agents the renderer
   * fills the TUI prompt after spawn instead.
   */
  launchContext?: string | null
  /**
   * Which argv strategy to use for {@link launchContext}.
   * e.g. `claude-append-system-prompt-file` → writes a temp file and passes
   * `--append-system-prompt-file <path>`. `prompt-paste` → no argv change.
   */
  contextLaunchStrategy?: import('./agentContextInject').AgentContextLaunchStrategy
  /**
   * Logical owner for multi-window restore.
   * omit/`null` = tools bash; CLI agent id for agent hosts; `vav` for mirror.
   */
  agentId?: string | null
  title?: string
}

export interface FsDirtyEvent {
  conversationId: string
  dirs: string[]
}

/** A row in a native popup menu. `role` defers the action to Electron itself. */
export interface NativeMenuItem {
  /** Echoed back when this row is chosen; omit for separators and roles. */
  id?: string
  label?: string
  separator?: boolean
  enabled?: boolean
  checked?: boolean
  role?: 'copy' | 'cut' | 'paste' | 'selectAll' | 'undo' | 'redo'
}

export type SettingsView =
  | 'api'
  | 'workspace'
  | 'appearance'
  | 'notifications'
  | 'cli'
  | 'agents'
  | 'file-associations'
  | 'about'

export interface FileAssociationStatus {
  id: string
  label: string
  extensions: string[]
  uti: string
  tier: 'p0' | 'p1'
  defaultApp: string | null
  defaultBundleId: string | null
  isVav: boolean
}

export type CliInstallLocation = '/usr/local/bin' | '~/.local/bin'

export interface CliStatus {
  installed: boolean
  path: string | null
  preferredLocation: CliInstallLocation
  pathInPath: boolean
  version: string | null
  installedAt: number | null
  error?: string
  /** Soft note (e.g. auto-fallback to ~/.local/bin). */
  notice?: string
}

export interface CreateConversationOptions {
  /** Absolute workdir; omit to use the Settings default / Temporary mint. */
  workingDirectory?: string | null
  /** Defaults to Settings.defaultModel when omitted. */
  model?: string
}

/** One session in a file's FileSessionStore history list. */
export interface FileSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  tokensUsed: number
}

export interface FileSessionsState {
  fileId: string
  activeSessionId: string
  sessions: FileSessionMeta[]
}

export interface FileSessionsDeleteResult extends FileSessionsState {
  ok: boolean
  error?: string
  removed: string[]
}

/** One row in the sidebar “Show file sessions” list. */
export interface FileSessionListEntry {
  fileId: string
  path: string
  pathStatus: 'ok' | 'file_missing' | 'dir_missing'
  sessionId: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  tokensUsed: number
  isActive: boolean
}

/**
 * Lean hydrate payload for the native token-usage panel.
 * Main builds this from ConversationStore so the popup never bootstraps the app.
 */
export interface TokenUsageViewPayload {
  conversationId: string
  model: string
  tokensUsed: number
  tokenLimit: number
  history: TokenSnapshot[]
  cacheCreatedAt: number | null
  cacheExpiresAt: number | null
  isRunning: boolean
  apiEndpoint: string
  theme: ThemeMode
  locale: AppLocale
  /** Currency for estimated cost labels (converted from USD estimates). */
  displayCurrency: DisplayCurrency
  /** Wall clock at emit time — used for cache-expiry relative labels. */
  now: number
  /** Active leaf has a manual compaction. */
  hasCompaction: boolean
  /** Messages folded into the active-leaf summary (0 if none). */
  compactedCount: number
  /** Path length on the active leaf — panel uses this to enable Compact. */
  pathMessageCount: number
  /**
   * Context-window fill for the bar. After compact this is the estimated
   * next-request size; otherwise last-turn total input (or tokensUsed).
   */
  contextTokens: number
  /** True when contextTokens is a post-compact estimate (not provider-reported). */
  contextTokensEstimated: boolean
}

export interface CliOpenEvent {
  conversationId: string
  toast: string | null
  /** Absolute file paths to seed the composer attachment strip (Dock / CLI file open). */
  attachments?: string[]
}

export type FilePreviewKind =
  | 'text'
  | 'csv'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'binary'
  | 'directory'
  | 'zip'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'sqlite'
  /** Rendered HTML canvas (sandbox); source remains editable via Agent + Save. */
  | 'html'

/** One entry in a ZIP archive structure preview (no content extraction). */
export interface ZipEntryInfo {
  /** Relative path inside the archive (dirs end with `/`). */
  path: string
  name: string
  isDirectory: boolean
  compressedSize: number
  uncompressedSize: number
  modifiedAt?: number
}

export interface ZipArchiveInfo {
  entries: ZipEntryInfo[]
  entryCount: number
  compressedSize: number
  uncompressedSize: number
  /** 0–100 integer compression ratio (saved %). */
  ratio: number
}

/** Extra metadata for binary / unsupported file preview canvas. */
export interface BinaryFileMeta {
  uti: string
  permissions: string
  owner: string
  createdAt: number | null
  modifiedAt: number | null
  inode: string
  defaultApp: string | null
}

/** Camera / format tags for image previews (esp. HEIC). */
export interface ImageMetaField {
  key: string
  value: string
}

/** One window of a large UTF-8 file (byte-oriented; not a product size cap). */
export interface TextWindowResult {
  content: string
  /** Absolute byte offset of the first returned byte. */
  startByte: number
  /** Exclusive end offset in the file. */
  endByte: number
  totalBytes: number
  /** True when endByte < totalBytes (more content remains). */
  truncated: boolean
  error?: string
}

export interface SqliteTableInfo {
  name: string
  columns: string[]
  rowCount: number
}

/** Lightweight schema index for SQLite previews (rows load on demand). */
export interface SqliteDatabaseInfo {
  tables: SqliteTableInfo[]
}

export interface SqliteQueryResult {
  columns: string[]
  rows: string[][]
  total: number
  offset: number
  limit: number
  error?: string
}

export interface FileInspectResult {
  path: string
  name: string
  size: number
  /** File mtime (ms) — preview uses this to detect agent/shell rewrites. */
  mtimeMs?: number
  kind: FilePreviewKind
  mime: string
  error?: string
  /**
   * When preview bytes live elsewhere (legacy convert / HEIC JPEG sidecar),
   * renderers load this path while UI identity stays {@link path}.
   */
  contentPath?: string
  /**
   * Soft notices (legacy conversion, HEIC sidecar, password-zip, windowed text).
   * Never a hard product "file too large" wall.
   */
  warnings?: string[]
  /** UTF-8 text when kind is text/csv (or plainText for structured docs). */
  text?: string
  /**
   * True when `text` is an initial window of a larger file (more bytes remain).
   * Not a refusal — call {@link VavApi.files.readTextWindow} for further ranges.
   */
  truncated?: boolean
  /** Byte window covered by `text` when truncated. */
  textWindow?: { startByte: number; endByte: number; totalBytes: number }
  /**
   * Streamable local URL (`vav-local://…`) for media / PDF / large binaries.
   * Prefer over embedding bytes in the inspect payload.
   */
  streamUrl?: string
  /** @deprecated Prefer streamUrl — kept for tiny inline fallbacks. */
  dataUrl?: string
  /** Image EXIF / sips tags (HEIC, JPEG, …). */
  imageMeta?: ImageMetaField[]
  lineCount?: number
  /**
   * Structured office/PDF document (block-selectable). Present for
   * kind pdf | docx | xlsx | pptx when parse succeeds.
   */
  structured?: import('./structuredDoc').StructuredDocument
  /** SQLite schema index when kind is sqlite. */
  sqlite?: SqliteDatabaseInfo
  /** ZIP archive tree (structure only — no entry contents). */
  zip?: ZipArchiveInfo
  /**
   * ZIP encryption / password hint. Structure may still be partial.
   * We do not prompt for passwords in-app (product boundary).
   */
  zipEncrypted?: boolean
  /** Binary / unsupported type metadata panel. */
  binaryMeta?: BinaryFileMeta
}

/** The full renderer-facing API, exposed on `window.vav` by the preload script. */
export interface VavApi {
  /**
   * Synchronous, unlike everything else here: keyboard hints and title-bar
   * metrics are decided while modules load, long before bootstrap resolves.
   */
  platform: Platform

  bootstrap(): Promise<Bootstrap>

  /**
   * Keychain / safeStorage gate (macOS). Call unlock from onboarding before
   * bootstrap so the system prompt is user-initiated.
   */
  secrets: {
    status(): Promise<{
      unlocked: boolean
      needsUnlock: boolean
      encryptionAvailable: boolean
      hasKeyFile: boolean
      /** Returning users skip the welcome/privacy tour. */
      onboardingComplete: boolean
    }>
    unlock(): Promise<{ ok: true } | { ok: false; error: string }>
  }

  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
    setApiKey(key: string): Promise<{ hint: string | null }>
    revealApiKey(): Promise<string | null>
    apiKeyHint(): Promise<string | null>
    /** Brave Search API subscription token (encrypted, not the LLM key). */
    setBraveSearchKey(key: string): Promise<{ hint: string | null }>
    braveSearchKeyHint(): Promise<string | null>
    validateKey(key: string): Promise<ValidateKeyResult>
    availableFonts(): Promise<string[]>
    pickDirectory(): Promise<string | null>
    /** `ok: false` means the accelerator is already taken by another app. */
    setHotkey(accelerator: string): Promise<{ ok: boolean; settings: AppSettings }>
    cliStatus(): Promise<CliStatus>
    cliSetLocation(location: CliInstallLocation): Promise<CliStatus>
    cliInstall(): Promise<CliStatus>
    cliUninstall(): Promise<CliStatus>
    /** macOS Launch Services: list / set / unset default opener per format. */
    fileAssociations(): Promise<FileAssociationStatus[]>
    fileAssociationForPath(path: string): Promise<FileAssociationStatus | null>
    setFileAssociation(formatId: string): Promise<FileAssociationStatus>
    unsetFileAssociation(formatId: string): Promise<FileAssociationStatus>
    registerAllFileAssociations(): Promise<{
      updated: string[]
      failed: { id: string; error: string }[]
    }>
  }

  conversations: {
    list(): Promise<ConversationMeta[]>
    get(id: string): Promise<Conversation | null>
    create(options?: CreateConversationOptions): Promise<ConversationMeta>
    rename(id: string, title: string): Promise<ConversationMeta[]>
    setModel(id: string, model: string): Promise<ConversationMeta[]>
    /** CLI agent id for new terminal splits (null = plain shell). */
    setAgentBinaryName(id: string, agentBinaryName: string | null): Promise<ConversationMeta[]>
    /** Workspace preview focus — carried into agent context. */
    setFocusedFile(id: string, path: string | null): Promise<ConversationMeta[]>
    setWorkingDirectory(id: string, path: string): Promise<ConversationMeta[]>
    pickWorkingDirectory(id: string): Promise<ConversationMeta[] | null>
    /** Move a Temporary Workspace folder to a permanent path. */
    locateWorkspace(
      id: string,
      destinationDir: string,
      name: string
    ): Promise<{ ok: true; conversations: ConversationMeta[] } | { ok: false; error: string }>
    remove(ids: string[]): Promise<{ removed: string[]; conversations: ConversationMeta[] }>
    revealInFinder(path: string): Promise<void>
    copyToClipboard(text: string): Promise<void>
    /** Put a PNG on the system clipboard (base64, no data-URL prefix). */
    copyImageToClipboard(base64Png: string): Promise<{ ok: true } | { ok: false; error: string }>
    /** Shows the variant `messageId` belongs to; resolves to the new leaf. */
    selectBranch(conversationId: string, messageId: string): Promise<string | null>
    /** Points the thread at an exact node — used for not-yet-written branches. */
    setLeaf(conversationId: string, leafId: string): Promise<void>
    /** Pinned rows sort above every time group. */
    setPinned(id: string, pinned: boolean): Promise<ConversationMeta[]>
    /** Archive / restore; refuses to archive the last active conversation. */
    setArchived(id: string, archived: boolean): Promise<ConversationMeta[]>
    /** Per-conversation Auto / Bypass / Edit tool approval policy. */
    setApprovalMode(
      id: string,
      mode: 'auto' | 'bypass' | 'edit'
    ): Promise<ConversationMeta[]>
    /** Deep-copies the thread up to `messageId` into a new conversation. */
    continueInNewSession(id: string, messageId: string): Promise<ConversationMeta | null>
    /** Deep-copies the whole conversation tree into a new session. */
    duplicate(id: string): Promise<ConversationMeta | null>
    /**
     * Export selected sessions as a `.vavpack` ZIP package
     * (text + manifest + binary blobs; no base64-in-JSON dumps).
     */
    exportPack(ids: string[]): Promise<
      | { ok: true; path: string; blobCount: number; conversationCount: number }
      | { ok: false; cancelled?: boolean; error?: string }
    >
    /** Import sessions from a `.vavpack` / `.zip` package (save dialog). */
    importPack(): Promise<
      | { ok: true; importedIds: string[]; path: string; blobCount: number }
      | { ok: false; cancelled?: boolean; error?: string }
    >
    /** Any window changing the list must reach the others. */
    onChanged(handler: (conversations: ConversationMeta[]) => void): () => void
  }

  agent: {
    send(
      conversationId: string,
      text: string,
      attachments: string[],
      quote?: QuoteDraft | null,
      contextBlocks?: PreviewRef[] | null,
      contextFile?: string | null
    ): Promise<void>
    /**
     * Append a system notice to the transcript (no agent turn). Used for UI
     * actions the model should see on the next send (e.g. Discard Changes).
     */
    appendNotice(conversationId: string, text: string): Promise<void>
    cancel(conversationId: string): Promise<void>
    answer(conversationId: string, toolCallId: string, answer: string): Promise<boolean>
    status(conversationId: string): Promise<TurnStatus>
    /** Another version of this reply, as a sibling rather than an appended one. */
    regenerate(conversationId: string, messageId: string): Promise<void>
    /** Rewrites a prompt and answers the new wording on a fresh branch. */
    editUserMessage(conversationId: string, messageId: string, text: string): Promise<void>
    /** Opens a sibling branch at `messageId` without sending anything yet. */
    fork(conversationId: string, messageId: string): Promise<string | null>
    /**
     * Manual context compact for the active leaf. Originals stay in the tree;
     * the model history uses a summary until cleared. Optional keepAfter keeps
     * that message and everything after it full.
     */
    compact(
      conversationId: string,
      options?: { keepAfterMessageId?: string | null }
    ): Promise<
      | { ok: true; compaction: import('./types').LeafCompaction }
      | { ok: false; error: string }
    >
    /** Remove compaction for one leaf path (restore full model context). */
    clearCompaction(
      conversationId: string,
      leafId: string
    ): Promise<{ ok: true } | { ok: false; error: string }>
    onEvent(handler: (event: TurnEvent) => void): () => void
    /** Fired when a leaf compaction is set or cleared. */
    onCompactionsChanged(
      handler: (payload: {
        conversationId: string
        compactions: import('./types').LeafCompaction[]
      }) => void
    ): () => void
  }

  files: {
    list(path: string, sort: FileSortKey, ascending: boolean): Promise<DirectoryListing>
    read(path: string): Promise<{ content: string; truncated: boolean; error?: string }>
    /**
     * Byte-window read for large UTF-8 files. Prefer this over loading the
     * whole file into the agent/renderer when size is unknown or large.
     */
    readTextWindow(
      path: string,
      opts?: { startByte?: number; maxBytes?: number; force?: boolean }
    ): Promise<TextWindowResult>
    /**
     * Binary file bytes as base64 for mature client renderers
     * (docx-preview / SheetJS). Prefer {@link streamUrl} / fetch(vav-local)
     * for large files — base64 is a convenience, not a product size gate.
     */
    readBinary(
      path: string
    ): Promise<{ ok: true; base64: string; size: number; mime: string } | { ok: false; error: string }>
    /**
     * Byte-window raw read for hex dump. Ephemeral override view — not stored.
     */
    readBinaryWindow(
      path: string,
      opts?: { startByte?: number; maxBytes?: number }
    ): Promise<
      | {
          ok: true
          base64: string
          startByte: number
          endByte: number
          totalBytes: number
          truncated: boolean
        }
      | { ok: false; error: string; startByte: number; endByte: number; totalBytes: number }
    >
    /** Write raw bytes (base64) — office discard / binary restore. */
    writeBinary(
      path: string,
      base64: string
    ): Promise<{ ok: true } | { ok: false; error?: string }>
    /**
     * Document sandbox: clone real path → working copy (or return existing).
     * Agent/tools then mutate the copy; Save/Accept promote; Discard drops it.
     */
    workingCopyEnsure(
      path: string,
      opts?: { fileId?: string | null }
    ): Promise<
      | { ok: true; realPath: string; copyPath: string; dirty: boolean }
      | { ok: false; error: string }
    >
    /** Promote working copy → real path (Save / Accept). */
    workingCopyPromote(
      path: string
    ): Promise<{ ok: true } | { ok: false; error: string }>
    /** Discard working copy and re-seed from real (Discard / Reject). */
    workingCopyDiscard(
      path: string
    ): Promise<{ ok: true; dirty?: boolean } | { ok: false; error: string }>
    /** Current sandbox status for a real path (null if none). */
    workingCopyStatus(
      path: string
    ): Promise<{ realPath: string; copyPath: string; dirty: boolean } | null>
    quickLook(path: string): Promise<void>
    /** Open path with the OS default application (binary "Open with …"). */
    openWithDefault(path: string): Promise<{ ok: true } | { ok: false; error: string }>
    watch(conversationId: string, root: string | null): Promise<void>
    onDirty(handler: (event: FsDirtyEvent) => void): () => void
    /** Resolves a dropped File to its absolute path. */
    pathForFile(file: File): string
    /** Overwrite an existing text file (file-preview Save). */
    write(
      path: string,
      content: string
    ): Promise<{ ok: true } | { ok: false; error?: string }>
    /** Save dialog + write text contents (markdown Copy/Save, file viewer). */
    saveAs(
      defaultName: string,
      content: string
    ): Promise<{ ok: true; path: string } | { ok: false; cancelled?: boolean; error?: string }>
    rename(
      path: string,
      newName: string
    ): Promise<{ ok: true; path: string } | { ok: false; error: string }>
    trash(paths: string[]): Promise<{ ok: true } | { ok: false; error: string }>
    /** Metadata + optional data URL for in-app preview. */
    inspect(path: string): Promise<FileInspectResult>
    /**
     * Background structured office/PDF parse (block pick / search).
     * Never required for first paint — call after provisional canvas mounts.
     */
    inspectStructured(
      path: string,
      opts?: { maxBlocks?: number; maxRows?: number }
    ): Promise<{
      ok: true
      structured: import('./structuredDoc').StructuredDocument
      partial: boolean
    } | { ok: false; error: string }>
    /**
     * Windowed read of a SQLite table (read-only). Used by the DB preview's
     * scroll virtualization — not a product page API.
     */
    dbQuery(
      path: string,
      table: string,
      offset?: number,
      limit?: number
    ): Promise<SqliteQueryResult>
    /**
     * AST / structured selectable blocks for a file's text (TS/JS via
     * TypeScript compiler; null = use renderer heuristic).
     */
    parseBlocks(
      path: string,
      text: string
    ): Promise<import('./previewBlock').PreviewBlock[] | null>
  }

  /** File Preview multi-session store (independent of sidebar conversations). */
  fileSessions: {
    open(path: string): Promise<FileSessionsState>
    create(path: string): Promise<FileSessionsState>
    setActive(fileId: string, sessionId: string): Promise<FileSessionsState | null>
    list(fileId: string): Promise<FileSessionsState | null>
    /** All file-bound sessions for the sidebar browser. */
    listAll(): Promise<FileSessionListEntry[]>
    /** Path + existence for a fileId (main detail panel). */
    resolve(
      fileId: string
    ): Promise<{ path: string; pathStatus: FileSessionListEntry['pathStatus'] } | null>
    setReadOnly(sessionId: string, readOnly: boolean): Promise<void>
    rename(fileId: string, sessionId: string, title: string): Promise<FileSessionsState | null>
    delete(
      fileId: string,
      sessionIds: string[]
    ): Promise<FileSessionsDeleteResult | null>
    /** Sidebar force-delete (no active/last protection). */
    forceDelete(
      fileId: string,
      sessionIds: string[]
    ): Promise<{ ok: boolean; error?: string; removed: string[] }>
  }

  /** Resolve a CLI agent binary on the login PATH (cached; pass force after install). */
  agents: {
    resolveBinary(candidates: string[], force?: boolean): Promise<string | null>
  }

  pty: {
    create(
      conversationId: string,
      cwd: string,
      cols: number,
      rows: number,
      options?: PtyCreateOptions | string
    ): Promise<string>
    /**
     * Fire-and-forget PTY input (keys, paste, mouse reports).
     * Uses one-way IPC — must not await a round-trip on every keystroke/wheel.
     */
    write(tabId: string, data: string): void
    /**
     * Fire-and-forget; resize storms during drag must not queue on invoke.
     * Pass force=true to re-deliver SIGWINCH even when cols/rows are unchanged
     * (used after a local alt-buffer rebuild so TUIs full-repaint).
     */
    resize(tabId: string, cols: number, rows: number, force?: boolean): void
    kill(tabId: string): Promise<void>
    /** Whether the tab's shell currently has a running (child) command. */
    isBusy(tabId: string): Promise<boolean>
    /** Live PTYs + split layouts for a conversation (multi-window hydrate). */
    list(conversationId: string): Promise<PtyListResult>
    /**
     * Persist bash / CLI-agent split trees so a detached window restores
     * ⌘D / ⌘⇧D directions instead of flattening to row.
     */
    setLayouts(conversationId: string, layouts: ConversationPtyLayouts): Promise<void>
    /** Recent scrollback for a tab (empty if unknown). */
    replay(tabId: string): Promise<string>
    onData(handler: (event: PtyDataEvent) => void): () => void
    onExit(handler: (tabId: string) => void): () => void
    onChanged(handler: (event: PtyChangedEvent) => void): () => void
    /** Running / idle transitions, and the final `exited` before teardown. */
    onStatus(handler: (event: PtyStatusEvent) => void): () => void
  }

  window: {
    /** Applies the resolved light/dark appearance to the native window chrome. */
    setTheme(theme: AppSettings['theme']): Promise<void>
    /**
     * Current OS accent colour as `#rrggbb` (macOS 10.14+ / Windows).
     * Falls back to a standard blue when the platform cannot report one.
     */
    getAccentColor(): Promise<string>
    /** Fired when the OS accent colour changes (or is re-sampled on focus). */
    onAccentColorChanged(handler: (hex: string) => void): () => void
    shellPath(shell: ShellKind): Promise<string>
    /** Settings live in their own window, not a sheet over the transcript. */
    openSettings(view?: SettingsView): Promise<void>
    closeSettings(): Promise<void>
    /** Opens (or raises) the standalone window for one conversation. */
    openSession(conversationId: string): Promise<void>
    /**
     * From a detached session window: show the main window and select this
     * conversation in the sidebar list (Reveal in List).
     */
    revealInList(conversationId: string): Promise<void>
    /**
     * Close the companion window for this conversation so the main shell can
     * host the live terminal again (“Take it back”).
     */
    closeDetachedSession(conversationId: string): Promise<void>
    /** Fresh conversation in its own window — the ⌘⇧↵ path. */
    newDetachedSession(): Promise<void>
    /**
     * Conversation ids that currently have a companion (detached) window.
     * Main window uses this so it does not mount a second live agent xterm
     * against the same PTY (one size only → half-screen black).
     */
    listDetachedSessions(): Promise<string[]>
    /** Fired whenever the set of open companion windows changes. */
    onDetachedChanged(handler: (conversationIds: string[]) => void): () => void
    /** Opens (or raises) a standalone file preview window for `path`. */
    openFilePreview(
      path: string,
      options?: { origin?: 'dock' | 'session'; conversationId?: string }
    ): Promise<void>
    /**
     * Warm preview shell: main pushes a new path without reloading the window.
     * Fired on the file-preview BrowserWindow only.
     */
    onPreviewNavigate(
      handler: (payload: {
        path: string
        origin?: 'dock' | 'session'
        conversationId?: string
        openSeq: number
        /** Date.now() when main received the open request (open→paint timing). */
        requestedAt?: number
      }) => void
    ): () => void
    /** Warm shell finished light bootstrap + chunk prefetch — ready to claim. */
    previewShellReady(): void
    /**
     * Warm session shell: main assigns a conversation without reloading the window.
     * Empty `conversationId` parks the shell idle (warm pool recycle).
     */
    onSessionNavigate(
      handler: (payload: {
        conversationId: string
        meta?: ConversationMeta
        /** True when the conversation has no messages — skip disk hydrate. */
        empty?: boolean
        collapseTools?: boolean
        openSeq: number
        /** Date.now() when main received the open request (hotkey→interactive). */
        requestedAt?: number
      }) => void
    ): () => void
    /** Warm session shell finished light bootstrap — ready to claim for ⌘⇧↵. */
    sessionShellReady(): void
    /** When true, the next native close is deferred to `onPreviewCloseAttempt`. */
    setPreviewCloseGuard(enabled: boolean): Promise<void>
    /** Close the preview window after the renderer cleared the unsaved guard. */
    forcePreviewClose(): Promise<void>
    onPreviewCloseAttempt(handler: () => void): () => void
    /**
     * Native context-window popup (panel shell, not a full document window).
     * `anchor` is the ring’s rect in the sender window’s content coordinates.
     */
    openTokenUsage(
      conversationId: string,
      anchor?: { x: number; y: number; width: number; height: number }
    ): Promise<void>
    /**
     * Token-usage panel hydrate payload (window is reused; no full bootstrap).
     * Prefer this over loading the whole app shell into the popup.
     */
    onTokenUsageView(handler: (payload: TokenUsageViewPayload) => void): () => void
    /** Relaunch the app (e.g. after Dock-hide preference). */
    relaunch(): Promise<void>
    /** Resolves to the chosen row's id, or null if the menu was dismissed. */
    popupMenu(
      items: NativeMenuItem[],
      position?: { x: number; y: number }
    ): Promise<string | null>
  }

  notifications: {
    /** System notification authorization for the settings hint. */
    permission(): Promise<'granted' | 'denied' | 'unknown'>
  }

  changeSets: {
    get(id: string): Promise<ChangeSet | null>
    active(conversationId: string): Promise<ChangeSet | null>
    accept(setId: string, filePaths: string[]): Promise<ChangeSet | null>
    reject(setId: string, filePaths: string[]): Promise<ChangeSet | null>
    acceptAll(setId: string): Promise<ChangeSet | null>
    rejectAll(setId: string): Promise<ChangeSet | null>
    undo(setId: string, filePath: string): Promise<ChangeSet | null>
    applyEdit(setId: string, filePath: string, content: string): Promise<ChangeSet | null>
  }

  updates: {
    getState(): Promise<UpdateState>
    check(): Promise<UpdateState>
    /** Download update in-app (packaged) or open the release asset (dev). */
    openDownload(): Promise<UpdateState>
    /** Apply a downloaded update and relaunch. */
    install(): Promise<void>
    onChanged(handler: (state: UpdateState) => void): () => void
  }

  dialog: {
    /** Native alert (single button). */
    alert(options: {
      title: string
      message: string
      confirmLabel?: string
    }): Promise<void>
    /** Native confirm; resolves true when the confirm button is chosen. */
    confirm(options: {
      title: string
      message: string
      confirmLabel?: string
      cancelLabel?: string
      destructive?: boolean
    }): Promise<boolean>
    /**
     * Native multi-button sheet (e.g. Save / Cancel / Discard).
     * Resolves to the chosen button index (0-based). Closing via Esc uses cancelId.
     */
    messageBox(options: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title: string
      message: string
      detail?: string
      buttons: string[]
      defaultId?: number
      cancelId?: number
    }): Promise<number>
  }

  /** Menu-driven commands (⌘N, ⌘F, ⌘, …) forwarded from the application menu. */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  /** Any window changing settings must reach the others. */
  onSettingsChanged(handler: (settings: AppSettings) => void): () => void
  /** Category to show, pushed when ⌘, hits an already-open settings window. */
  onSettingsView(handler: (view: SettingsView) => void): () => void
  /** `vav /path` from the installed CLI — select the minted conversation. */
  onCliOpen(handler: (event: CliOpenEvent) => void): () => void
  /** Native fullscreen entered/left — used to collapse traffic-light inset. */
  onFullscreen(handler: (fullscreen: boolean) => void): () => void
}

export type MenuCommand =
  | 'new-conversation'
  | 'focus-composer'
  | 'find'
  | 'find-next'
  | 'find-previous'
  | 'open-settings'
  | 'toggle-sidebar'
  | 'toggle-tools-panel'
  | 'toggle-panel-segment'
  | 'new-terminal'
  /** Ctrl+` — expand tools tray Terminal and focus bash. */
  | 'focus-bash'
  | 'switch-workdir'
  | 'send'
  /** Stop the in-flight agent turn for the active session. */
  | 'cancel-turn'
  /** Import / export .vav session packs (same as sidebar ⋮). */
  | 'import-pack'
  | 'export-pack'
  /** Raise the in-app keyboard shortcuts sheet. */
  | 'open-shortcuts'
  /** Sidebar list modes: main sessions / archive / file-bound sessions. */
  | 'show-sessions'
  | 'show-archive'
  | 'show-file-sessions'
  /** Trigger the same update check as Settings → About. */
  | 'check-updates'
  /**
   * ⌘W — context close via uiFocus (bash tab / collapse Files tray / agent pane),
   * else close the window. Replaces bare role:close so the renderer can decide.
   */
  | 'close-context'
  /** ⌘1…⌘9 — slot 1 = Workspace; 2+ = bash tabs in order (Agent first). */
  | 'focus-tools-1'
  | 'focus-tools-2'
  | 'focus-tools-3'
  | 'focus-tools-4'
  | 'focus-tools-5'
  | 'focus-tools-6'
  | 'focus-tools-7'
  | 'focus-tools-8'
  | 'focus-tools-9'

export const IPC = {
  bootstrap: 'vav:bootstrap',
  secretsStatus: 'vav:secrets:status',
  secretsUnlock: 'vav:secrets:unlock',

  settingsGet: 'vav:settings:get',
  settingsUpdate: 'vav:settings:update',
  settingsReset: 'vav:settings:reset',
  settingsSetKey: 'vav:settings:set-key',
  settingsRevealKey: 'vav:settings:reveal-key',
  settingsKeyHint: 'vav:settings:key-hint',
  settingsSetBraveSearchKey: 'vav:settings:set-brave-search-key',
  settingsBraveSearchKeyHint: 'vav:settings:brave-search-key-hint',
  settingsValidateKey: 'vav:settings:validate-key',
  settingsFonts: 'vav:settings:fonts',
  settingsPickDirectory: 'vav:settings:pick-directory',
  settingsSetHotkey: 'vav:settings:set-hotkey',
  settingsCliStatus: 'vav:settings:cli-status',
  settingsCliSetLocation: 'vav:settings:cli-set-location',
  settingsCliInstall: 'vav:settings:cli-install',
  settingsCliUninstall: 'vav:settings:cli-uninstall',
  settingsFileAssociations: 'vav:settings:file-associations',
  settingsFileAssociationForPath: 'vav:settings:file-association-for-path',
  settingsSetFileAssociation: 'vav:settings:set-file-association',
  settingsUnsetFileAssociation: 'vav:settings:unset-file-association',
  settingsRegisterAllFileAssociations: 'vav:settings:register-all-file-associations',

  convList: 'vav:conv:list',
  convGet: 'vav:conv:get',
  convCreate: 'vav:conv:create',
  convRename: 'vav:conv:rename',
  convSetModel: 'vav:conv:set-model',
  convSetAgentBinary: 'vav:conv:set-agent-binary',
  convSetFocusedFile: 'vav:conv:set-focused-file',
  convSetWorkdir: 'vav:conv:set-workdir',
  convPickWorkdir: 'vav:conv:pick-workdir',
  convLocateWorkspace: 'vav:conv:locate-workspace',
  convRemove: 'vav:conv:remove',
  convReveal: 'vav:conv:reveal',
  convCopy: 'vav:conv:copy',
  /** PNG bytes as base64 (no data-URL prefix) → system clipboard as image. */
  convCopyImage: 'vav:conv:copy-image',
  convSelectBranch: 'vav:conv:select-branch',
  convSetLeaf: 'vav:conv:set-leaf',
  convSetPinned: 'vav:conv:set-pinned',
  convSetArchived: 'vav:conv:set-archived',
  convSetApprovalMode: 'vav:conv:set-approval-mode',
  convContinueNew: 'vav:conv:continue-new',
  convDuplicate: 'vav:conv:duplicate',
  /** Export one or more sessions as a .vavpack (zip) package. */
  convExportPack: 'vav:conv:export-pack',
  /** Import sessions from a .vavpack / .zip package. */
  convImportPack: 'vav:conv:import-pack',
  convChanged: 'vav:conv:changed',

  agentSend: 'vav:agent:send',
  agentAppendNotice: 'vav:agent:append-notice',
  agentCancel: 'vav:agent:cancel',
  agentAnswer: 'vav:agent:answer',
  agentStatus: 'vav:agent:status',
  agentRegenerate: 'vav:agent:regenerate',
  agentEditUser: 'vav:agent:edit-user',
  agentFork: 'vav:agent:fork',
  agentCompact: 'vav:agent:compact',
  agentClearCompaction: 'vav:agent:clear-compaction',
  /** Main → all windows after compact/clear so the transcript can refresh. */
  compactionsChanged: 'vav:agent:compactions-changed',
  agentEvent: 'vav:agent:event',

  filesList: 'vav:files:list',
  filesRead: 'vav:files:read',
  filesReadTextWindow: 'vav:files:read-text-window',
  filesReadBinary: 'vav:files:read-binary',
  filesReadBinaryWindow: 'vav:files:read-binary-window',
  filesWriteBinary: 'vav:files:write-binary',
  filesDbQuery: 'vav:files:db-query',
  filesWrite: 'vav:files:write',
  filesWorkingCopyEnsure: 'vav:files:working-copy-ensure',
  filesWorkingCopyPromote: 'vav:files:working-copy-promote',
  filesWorkingCopyDiscard: 'vav:files:working-copy-discard',
  filesWorkingCopyStatus: 'vav:files:working-copy-status',
  filesQuickLook: 'vav:files:quick-look',
  filesWatch: 'vav:files:watch',
  filesDirty: 'vav:files:dirty',
  filesSaveAs: 'vav:files:save-as',
  filesRename: 'vav:files:rename',
  filesTrash: 'vav:files:trash',
  filesInspect: 'vav:files:inspect',
  filesInspectStructured: 'vav:files:inspect-structured',
  previewNavigate: 'vav:preview:navigate',
  previewShellReady: 'vav:preview:shell-ready',
  sessionNavigate: 'vav:session:navigate',
  sessionShellReady: 'vav:session:shell-ready',
  filesParseBlocks: 'vav:files:parse-blocks',
  previewCloseAttempt: 'vav:preview:close-attempt',
  previewSetCloseGuard: 'vav:preview:set-close-guard',
  previewForceClose: 'vav:preview:force-close',

  fileSessionsOpen: 'vav:file-sessions:open',
  fileSessionsCreate: 'vav:file-sessions:create',
  fileSessionsSetActive: 'vav:file-sessions:set-active',
  fileSessionsList: 'vav:file-sessions:list',
  fileSessionsListAll: 'vav:file-sessions:list-all',
  fileSessionsResolve: 'vav:file-sessions:resolve',
  fileSessionsSetReadOnly: 'vav:file-sessions:set-read-only',
  fileSessionsRename: 'vav:file-sessions:rename',
  fileSessionsDelete: 'vav:file-sessions:delete',
  fileSessionsForceDelete: 'vav:file-sessions:force-delete',
  filesOpenWithDefault: 'vav:files:open-with-default',

  agentsResolveBinary: 'vav:agents:resolve-binary',
  ptyCreate: 'vav:pty:create',
  ptyWrite: 'vav:pty:write',
  ptyResize: 'vav:pty:resize',
  ptyKill: 'vav:pty:kill',
  ptyIsBusy: 'vav:pty:is-busy',
  ptyList: 'vav:pty:list',
  ptySetLayouts: 'vav:pty:set-layouts',
  ptyReplay: 'vav:pty:replay',
  ptyData: 'vav:pty:data',
  ptyExit: 'vav:pty:exit',
  ptyChanged: 'vav:pty:changed',
  ptyStatus: 'vav:pty:status',

  windowSetTheme: 'vav:window:set-theme',
  windowGetAccentColor: 'vav:window:get-accent-color',
  accentColorChanged: 'vav:window:accent-color-changed',
  windowShellPath: 'vav:window:shell-path',
  windowOpenSettings: 'vav:window:open-settings',
  windowCloseSettings: 'vav:window:close-settings',
  windowPopupMenu: 'vav:window:popup-menu',
  windowOpenSession: 'vav:window:open-session',
  windowRevealInList: 'vav:window:reveal-in-list',
  windowCloseDetached: 'vav:window:close-detached',
  windowNewDetached: 'vav:window:new-detached',
  windowListDetached: 'vav:window:list-detached',
  windowDetachedChanged: 'vav:window:detached-changed',
  windowOpenFilePreview: 'vav:window:open-file-preview',
  windowOpenTokenUsage: 'vav:window:open-token-usage',
  tokenUsageView: 'vav:token-usage:view',
  windowRelaunch: 'vav:window:relaunch',
  windowFullscreen: 'vav:window:fullscreen',
  notificationsPermission: 'vav:notifications:permission',
  dialogAlert: 'vav:dialog:alert',
  dialogConfirm: 'vav:dialog:confirm',
  dialogMessageBox: 'vav:dialog:message-box',

  menuCommand: 'vav:menu:command',
  settingsChanged: 'vav:settings:changed',
  settingsView: 'vav:settings:view',
  cliOpen: 'vav:cli:open',

  changeSetGet: 'vav:changeset:get',
  changeSetActive: 'vav:changeset:active',
  changeSetAccept: 'vav:changeset:accept',
  changeSetReject: 'vav:changeset:reject',
  changeSetAcceptAll: 'vav:changeset:accept-all',
  changeSetRejectAll: 'vav:changeset:reject-all',
  changeSetUndo: 'vav:changeset:undo',
  changeSetApplyEdit: 'vav:changeset:apply-edit',

  updatesGet: 'vav:updates:get',
  updatesCheck: 'vav:updates:check',
  updatesOpenDownload: 'vav:updates:open-download',
  updatesInstall: 'vav:updates:install',
  updatesChanged: 'vav:updates:changed'
} as const
