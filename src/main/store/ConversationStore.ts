import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ApprovalMode,
  ChatMessage,
  Conversation,
  ConversationMeta,
  TokenSnapshot
} from '@shared/types'
import { CACHE_TTL_MS, TOKEN_HISTORY_LIMIT } from '@shared/tokenUsage'
import { deepestLeaf, newestLeafId, threadPath } from '@shared/thread'
import { defaultSessionTitle, isDefaultSessionTitle, t } from '@shared/i18n'
import { currentLocale } from '../i18n'

const AUTO_TITLE_LIMIT = 40

/**
 * Conversations live in a single JSON document under Application Support.
 *
 * The sidebar only ever reads {@link listMeta}, which strips message bodies —
 * that projection is what keeps the source list independent of transcript size
 * (sidebar-conversation-list.rpml, "数据源与刷新").
 *
 * Writes are debounced and atomic (tmp + rename). Callers persist at tool
 * boundaries and turn end, never per token.
 */
export class ConversationStore {
  private readonly file = join(app.getPath('userData'), 'conversations.json')
  private conversations: Conversation[] = []
  private flushTimer: NodeJS.Timeout | null = null
  /**
   * Whether {@link load} has run. An empty in-memory list means two entirely
   * different things before and after that call — "not read yet" and "the user
   * has none" — and only the second one is safe to write to disk.
   */
  private loaded = false

  get path(): string {
    return this.file
  }

  load(defaults: { model: string; mintWorkdir: () => string }): Conversation[] {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        if (Array.isArray(raw?.conversations)) {
          this.conversations = raw.conversations.filter((c: Conversation) => !!c?.id)
        }
      }
    } catch (err) {
      console.error('[conversations] load failed, starting fresh', err)
      this.conversations = []
    }

    // Every conversation owns a real directory; "Temporary Workspace" is a
    // label for one under the system temp dir, not the absence of a path.
    for (const conversation of this.conversations) {
      if (!conversation.workingDirectory) conversation.workingDirectory = defaults.mintWorkdir()
      if (typeof conversation.pinned !== 'boolean') conversation.pinned = false
      if (conversation.pinTime === undefined) conversation.pinTime = null
      if (conversation.duplicateSourceId === undefined) conversation.duplicateSourceId = null
      if (conversation.duplicateSourceTitle === undefined) conversation.duplicateSourceTitle = null
      if (typeof conversation.archived !== 'boolean') conversation.archived = false
      if (conversation.archivedAt === undefined) conversation.archivedAt = null
      if (!conversation.approvalMode) conversation.approvalMode = 'auto'
      if (!Array.isArray(conversation.tokenHistory)) conversation.tokenHistory = []
      if (conversation.cacheCreatedAt === undefined) conversation.cacheCreatedAt = null
      if (conversation.cacheExpiresAt === undefined) conversation.cacheExpiresAt = null
      if (conversation.fileId === undefined) conversation.fileId = null
      if (conversation.fileReadOnly === undefined) conversation.fileReadOnly = false
      if (conversation.agentBinaryName === undefined) conversation.agentBinaryName = null
      if (conversation.focusedFilePath === undefined) conversation.focusedFilePath = null
      // Legacy untitled titles from earlier builds; normalize to the current locale.
      if (isDefaultSessionTitle(conversation.title) && !conversation.fileId) {
        conversation.title = defaultSessionTitle(currentLocale())
      }
      this.adoptTreeShape(conversation)
    }

    this.loaded = true

    // Launch invariant: the product always has at least one visible conversation.
    if (this.conversations.filter((c) => !c.fileId).length === 0) {
      this.create(defaults.mintWorkdir(), defaults.model)
    }
    return this.conversations
  }

  all(): Conversation[] {
    return this.conversations
  }

  listMeta(): ConversationMeta[] {
    return this.conversations
      .filter((c) => !c.fileId)
      .map(
        ({
          messages: _messages,
          tokenHistory: _history,
          cacheCreatedAt: _created,
          cacheExpiresAt: _expires,
          ...meta
        }) => {
          void _messages
          void _history
          void _created
          void _expires
          return meta
        }
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id)
  }

  create(
    workingDirectory: string | null,
    model: string,
    options?: { fileId?: string | null; title?: string; fileReadOnly?: boolean }
  ): Conversation {
    const now = Date.now()
    const conversation: Conversation = {
      id: randomUUID(),
      title: options?.title ?? defaultSessionTitle(currentLocale()),
      createdAt: now,
      updatedAt: now,
      workingDirectory,
      model,
      tokensUsed: 0,
      tokenLimit: 200_000,
      messages: [],
      activeLeafId: null,
      tokenHistory: [],
      cacheCreatedAt: null,
      cacheExpiresAt: null,
      pinned: false,
      pinTime: null,
      duplicateSourceId: null,
      duplicateSourceTitle: null,
      archived: false,
      archivedAt: null,
      approvalMode: 'auto',
      fileId: options?.fileId ?? null,
      fileReadOnly: options?.fileReadOnly ?? false,
      agentBinaryName: null,
      focusedFilePath: null
    }
    this.conversations.unshift(conversation)
    this.scheduleFlush()
    return conversation
  }

  /**
   * Deep-copies every message (branch tree intact) into a new conversation.
   *
   * Inherits workdir and model; resets tokens and streaming-related state.
   * The copy is selected by the caller — this only mints and returns it.
   */
  duplicate(id: string): Conversation | undefined {
    const source = this.get(id)
    if (!source) return undefined

    const idMap = new Map<string, string>()
    for (const message of source.messages) idMap.set(message.id, randomUUID())

    const now = Date.now()
    const copy: Conversation = {
      id: randomUUID(),
      title: t(currentLocale(), 'sidebar.copySuffix', { title: source.title }),
      createdAt: now,
      updatedAt: now,
      workingDirectory: source.workingDirectory,
      model: source.model,
      tokensUsed: 0,
      tokenLimit: source.tokenLimit,
      pinned: false,
      pinTime: null,
      duplicateSourceId: source.id,
      duplicateSourceTitle: source.title,
      archived: false,
      archivedAt: null,
      approvalMode: source.approvalMode ?? 'auto',
      activeLeafId: source.activeLeafId ? (idMap.get(source.activeLeafId) ?? null) : null,
      tokenHistory: [],
      cacheCreatedAt: null,
      cacheExpiresAt: null,
      messages: source.messages.map((message) => ({
        ...structuredClone(message),
        id: idMap.get(message.id)!,
        parentId: message.parentId ? (idMap.get(message.parentId) ?? null) : null
      }))
    }
    this.conversations.unshift(copy)
    this.scheduleFlush()
    return copy
  }

  /**
   * Patch conversation fields without changing recency.
   *
   * `updatedAt` is last *conversation* activity (messages), not last open/view
   * or metadata edit. Selecting a session, focusing a file, renaming, changing
   * model, etc. must not reorder the sidebar — only append/replace message
   * (and create/archive flows) touch `updatedAt`.
   */
  updateMeta(id: string, patch: Partial<ConversationMeta>): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    // Strip updatedAt so callers cannot rewrite recency through this path.
    const { updatedAt: _ignore, ...safe } = patch
    void _ignore
    Object.assign(conversation, safe)
    this.scheduleFlush()
    return conversation
  }

  /** The leaf the transcript currently follows; null on an empty conversation. */
  activeLeaf(id: string): string | null {
    const conversation = this.get(id)
    if (!conversation) return null
    return conversation.activeLeafId ?? newestLeafId(conversation.messages)
  }

  /** Adding a message always makes it the new leaf — it is what you just said. */
  appendMessage(id: string, message: ChatMessage): void {
    const conversation = this.get(id)
    if (!conversation) return
    conversation.messages.push(message)
    conversation.activeLeafId = message.id
    conversation.updatedAt = Date.now()
    this.applyAutoTitle(conversation)
    this.scheduleFlush()
  }

  replaceMessage(id: string, message: ChatMessage): void {
    const conversation = this.get(id)
    if (!conversation) return
    const index = conversation.messages.findIndex((m) => m.id === message.id)
    if (index >= 0) {
      conversation.messages[index] = message
    } else {
      conversation.messages.push(message)
      conversation.activeLeafId = message.id
    }
    conversation.updatedAt = Date.now()
    this.scheduleFlush()
  }

  /**
   * Switches to one variant of a message and follows its newest branch down.
   *
   * Returns the resulting leaf so the caller can hand the renderer the exact
   * path it should now show.
   */
  selectBranch(id: string, messageId: string): string | null {
    const conversation = this.get(id)
    if (!conversation?.messages.some((m) => m.id === messageId)) return null
    conversation.activeLeafId = deepestLeaf(conversation.messages, messageId)
    this.scheduleFlush()
    return conversation.activeLeafId
  }

  setActiveLeaf(id: string, leafId: string | null): void {
    const conversation = this.get(id)
    if (!conversation) return
    conversation.activeLeafId = leafId
    this.scheduleFlush()
  }

  addTokens(id: string, tokens: number): void {
    const conversation = this.get(id)
    if (!conversation) return
    conversation.tokensUsed += tokens
    this.scheduleFlush()
  }

  /** Append a usage sample and refresh cache TTL when a write was observed. */
  recordTokenSnapshot(id: string, snapshot: TokenSnapshot): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    if (!Array.isArray(conversation.tokenHistory)) conversation.tokenHistory = []
    conversation.tokenHistory = [...conversation.tokenHistory, snapshot].slice(-TOKEN_HISTORY_LIMIT)
    if (snapshot.cacheWriteTokens > 0) {
      conversation.cacheCreatedAt = snapshot.timestamp
      conversation.cacheExpiresAt = snapshot.timestamp + CACHE_TTL_MS
    }
    this.scheduleFlush()
    return conversation
  }

  /**
   * Removes conversations, refusing to empty the sidebar list.
   * File-preview sessions (`fileId` set) can always be deleted in isolation —
   * they do not count toward the "at least one sidebar conversation" guard.
   * Returns the ids actually removed; empty means the guard fired.
   */
  remove(ids: string[]): string[] {
    const target = new Set(ids)
    const remaining = this.conversations.filter((c) => !target.has(c.id))
    // Never empty the *sidebar* set — file-preview sessions don't count.
    if (remaining.filter((c) => !c.fileId).length === 0) {
      // Still allow pure file-session deletes when the only victims have fileId.
      const deletingSidebar = this.conversations.some((c) => target.has(c.id) && !c.fileId)
      if (deletingSidebar) return []
    }
    const removed = this.conversations.filter((c) => target.has(c.id)).map((c) => c.id)
    this.conversations = remaining
    this.scheduleFlush()
    return removed
  }

  /** Toggles the pin, stamping pinTime so the pinned section can order itself. */
  setPinned(id: string, pinned: boolean): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.pinned = pinned
    conversation.pinTime = pinned ? Date.now() : null
    this.scheduleFlush()
    return conversation
  }

  /**
   * Archives or restores a conversation.
   * Refuses to archive the last non-archived conversation.
   */
  setArchived(id: string, archived: boolean): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    if (archived) {
      const activeCount = this.conversations.filter((c) => !c.archived).length
      if (!conversation.archived && activeCount <= 1) return undefined
      conversation.archived = true
      conversation.archivedAt = Date.now()
      conversation.pinned = false
      conversation.pinTime = null
    } else {
      conversation.archived = false
      conversation.archivedAt = null
    }
    conversation.updatedAt = Date.now()
    this.scheduleFlush()
    return conversation
  }

  setApprovalMode(id: string, mode: ApprovalMode): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.approvalMode = mode
    this.scheduleFlush()
    return conversation
  }

  /**
   * Copies the visible thread up to and including `messageId` into a brand new
   * conversation. The copy is a fresh linear chain — branches the user did not
   * pick are deliberately left behind, since the point is a clean checkpoint.
   */
  branchToNewConversation(id: string, messageId: string): Conversation | undefined {
    const source = this.get(id)
    if (!source) return undefined
    const path = threadPath(source.messages, source.activeLeafId)
    const cut = path.findIndex((m) => m.id === messageId)
    if (cut < 0) return undefined

    const next = this.create(source.workingDirectory, source.model)
    next.title = source.title
    next.tokenLimit = source.tokenLimit
    // Token usage is inherited only up to the fork point, not the whole source.
    next.tokensUsed = Math.round((source.tokensUsed * (cut + 1)) / Math.max(path.length, 1))

    let parentId: string | null = null
    for (const message of path.slice(0, cut + 1)) {
      const copy: ChatMessage = {
        ...message,
        id: randomUUID(),
        parentId,
        blocks: structuredClone(message.blocks)
      }
      next.messages.push(copy)
      parentId = copy.id
    }
    next.activeLeafId = parentId
    this.scheduleFlush()
    return next
  }

  /**
   * Brings a conversation written before messages were a tree up to date:
   * chain the flat list into parent links and point the leaf at its end.
   */
  private adoptTreeShape(conversation: Conversation): void {
    let previous: string | null = null
    for (const message of conversation.messages) {
      const stored = message as Partial<ChatMessage>
      if (stored.parentId === undefined) message.parentId = previous
      previous = message.id
    }
    const known = conversation.messages.some((m) => m.id === conversation.activeLeafId)
    if (!known) conversation.activeLeafId = newestLeafId(conversation.messages)
  }

  /**
   * Derives a title from the first user message, once. Conversations the user
   * renamed, or that already auto-titled, are left alone.
   */
  private applyAutoTitle(conversation: Conversation): void {
    if (!isDefaultSessionTitle(conversation.title)) return
    const firstUser = threadPath(conversation.messages, conversation.activeLeafId).find(
      (m) => m.role === 'user'
    )
    if (!firstUser) return
    const source = firstUser.content.replace(/\s+/g, ' ').trim()
    if (!source) return
    const chars = [...source]
    conversation.title =
      chars.length > AUTO_TITLE_LIMIT ? `${chars.slice(0, AUTO_TITLE_LIMIT).join('')}…` : source
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, 400)
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    // Writing before a read would replace the file with this process's blank
    // slate. Quit paths run whether or not startup got far enough to load.
    if (!this.loaded) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, conversations: this.conversations }), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[conversations] flush failed', err)
    }
  }
}
