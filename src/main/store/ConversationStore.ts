import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChatMessage, Conversation, ConversationMeta } from '@shared/types'
import { deepestLeaf, newestLeafId, threadPath } from '@shared/thread'

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
      // "新对话" was the placeholder title before the 会话 rename; it is ours,
      // not something the user typed, so carrying it forward is safe.
      if (conversation.title === '新对话') conversation.title = '新会话'
      this.adoptTreeShape(conversation)
    }

    // Launch invariant: the product always has at least one conversation.
    if (this.conversations.length === 0) this.create(defaults.mintWorkdir(), defaults.model)
    return this.conversations
  }

  all(): Conversation[] {
    return this.conversations
  }

  listMeta(): ConversationMeta[] {
    return this.conversations
      .map(({ messages: _messages, ...meta }) => {
        void _messages
        return meta
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id)
  }

  create(workingDirectory: string | null, model: string): Conversation {
    const now = Date.now()
    const conversation: Conversation = {
      id: randomUUID(),
      title: '新会话',
      createdAt: now,
      updatedAt: now,
      workingDirectory,
      model,
      tokensUsed: 0,
      tokenLimit: 200_000,
      messages: [],
      activeLeafId: null,
      pinned: false,
      pinTime: null
    }
    this.conversations.unshift(conversation)
    this.scheduleFlush()
    return conversation
  }

  updateMeta(id: string, patch: Partial<ConversationMeta>): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    Object.assign(conversation, patch, { updatedAt: Date.now() })
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

  /**
   * Removes conversations, refusing to empty the list.
   * Returns the ids actually removed; empty means the guard fired.
   */
  remove(ids: string[]): string[] {
    const target = new Set(ids)
    const remaining = this.conversations.filter((c) => !target.has(c.id))
    if (remaining.length === 0) return []
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
    if (conversation.title !== '新会话') return
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
