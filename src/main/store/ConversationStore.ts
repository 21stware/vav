import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync
} from 'node:fs'
import {
  writeFile as writeFileAsync,
  rename as renameAsync,
  unlink as unlinkAsync,
  mkdir as mkdirAsync
} from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  ApprovalMode,
  ChatMessage,
  CliHostKind,
  Conversation,
  ConversationMeta,
  HostTranscriptBucket,
  LeafCompaction,
  QuotaWindow,
  TerminalLayoutNode,
  ThinkingLevel,
  TokenSnapshot
} from '@shared/types'
import { conversationOnMachine, LOCAL_MACHINE_ID } from '@shared/workspaceHost'
import { mergeAdoptedHostMessages } from '@shared/remoteControlApply'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import { normalizeCursorConversationModel } from '@shared/cursorModel'
import { hostTranscriptKey } from '@shared/types'
import {
  expandRemovedSwarmIds,
  removeSwarmLeaf,
  sanitizeSwarmLayout
} from '@shared/swarmLayout'
import { removeCompaction, upsertCompaction } from '@shared/compaction'
import { applyMissingHostUsage } from '../agent/hostSessionUsage'
import {
  CACHE_TTL_MS,
  TOKEN_HISTORY_LIMIT,
  mergeQuotaWindows
} from '@shared/tokenUsage'
import { contextWindowFor } from '../agent/modelMeta'
import { deepestLeaf, leafAfterPrune, newestLeafId, pruneSubtree, threadPath } from '@shared/thread'
import { defaultSessionTitle, isDefaultSessionTitle, t } from '@shared/i18n'
import type { CliPaneBinding } from '@shared/cliPaneBinding'
import { currentLocale } from '../i18n'
import { conversationToMeta } from './conversationMeta.ts'
import { electronUserData } from './electronUserData.ts'

const AUTO_TITLE_LIMIT = 40
const INDEX_VERSION = 2

type ConversationIndex = { version: number; ids: string[] }

/**
 * Conversations live as one JSON file per id under
 * `userData/conversations/{id}.json`, plus a small `index.json` listing ids.
 *
 * Legacy installs used a single monolithic `userData/conversations.json`;
 * {@link load} migrates that into shards and renames the old file to
 * `conversations.json.bak`.
 *
 * The sidebar only ever reads {@link listMeta}, which strips message bodies —
 * that projection is what keeps the source list independent of transcript size
 * (sidebar-conversation-list.rpml, "数据源与刷新").
 *
 * Writes are debounced, dirty-tracked (only changed shards + index), and atomic
 * (tmp + rename). Callers persist at tool boundaries and turn end, never per token.
 * Quit / turn-end use sync {@link flush}; the debounce path uses async I/O.
 */
export class ConversationStore {
  /** Directory holding `index.json` and per-conversation shards. */
  private readonly dir: string
  private readonly indexPath: string
  /** Pre-shard monolithic file; migrated away on first load if present. */
  private readonly legacyFile: string

  constructor(userDataDir?: string) {
    const root = userDataDir ?? electronUserData()
    this.dir = join(root, 'conversations')
    this.indexPath = join(this.dir, 'index.json')
    this.legacyFile = join(root, 'conversations.json')
  }
  private conversations: Conversation[] = []
  private flushTimer: NodeJS.Timeout | null = null
  /** Conversation ids whose shard needs rewriting. */
  private dirty = new Set<string>()
  /** Ids removed from memory whose shard files still need deleting. */
  private deleted = new Set<string>()
  /** Generation per dirty id so a later mutation is not cleared by an older write. */
  private dirtyGen = new Map<string, number>()
  private flushInFlight: Promise<void> | null = null
  private flushAgain = false
  /** Bumped by sync {@link flush} so an in-flight async write abandons mid-flight. */
  private writeEpoch = 0
  /**
   * Whether {@link load} has run. An empty in-memory list means two entirely
   * different things before and after that call — "not read yet" and "the user
   * has none" — and only the second one is safe to write to disk.
   */
  private loaded = false

  /** Path shown in About / diagnostics — the sharded conversations directory. */
  get path(): string {
    return this.dir
  }

  load(defaults: { model: string; mintWorkdir: () => string }): Conversation[] {
    try {
      mkdirSync(this.dir, { recursive: true })
      if (existsSync(this.indexPath)) {
        this.conversations = this.loadFromIndex()
      } else if (existsSync(this.legacyFile)) {
        // One-time migrate: monolithic conversations.json → shards + index.json.
        this.conversations = this.migrateFromLegacy()
      } else {
        this.conversations = []
      }
    } catch (err) {
      console.error('[conversations] load failed, starting fresh', err)
      this.conversations = []
    }

    // Every conversation owns a real directory; "Temporary Workspace" is a
    // label for one under the system temp dir, not the absence of a path.
    for (const conversation of this.conversations) {
      if (!conversation.workingDirectory) conversation.workingDirectory = defaults.mintWorkdir()
      if (!conversation.machineId) conversation.machineId = LOCAL_MACHINE_ID
      if (typeof conversation.pinned !== 'boolean') conversation.pinned = false
      if (conversation.pinTime === undefined) conversation.pinTime = null
      if (conversation.duplicateSourceId === undefined) conversation.duplicateSourceId = null
      if (conversation.duplicateSourceTitle === undefined) conversation.duplicateSourceTitle = null
      if (typeof conversation.archived !== 'boolean') conversation.archived = false
      if (conversation.archivedAt === undefined) conversation.archivedAt = null
      if (!conversation.approvalMode) conversation.approvalMode = 'auto'
      conversation.thinkingLevel = parseThinkingLevel(conversation.thinkingLevel)
      if (typeof conversation.fast !== 'boolean') conversation.fast = false
      if (conversation.cliHost === 'cursor' && conversation.model) {
        const normalized = normalizeCursorConversationModel(conversation.model)
        if (normalized.migrated) {
          conversation.model = normalized.model
          if (normalized.fast === true) conversation.fast = true
        }
      }
      if (!Array.isArray(conversation.tokenHistory)) conversation.tokenHistory = []
      if (conversation.reportedSessionCostUsd === undefined) {
        conversation.reportedSessionCostUsd = null
      }
      if (!Array.isArray(conversation.quotaWindows)) conversation.quotaWindows = []
      if (conversation.cacheCreatedAt === undefined) conversation.cacheCreatedAt = null
      if (conversation.cacheExpiresAt === undefined) conversation.cacheExpiresAt = null
      if (conversation.fileId === undefined) conversation.fileId = null
      if (conversation.fileReadOnly === undefined) conversation.fileReadOnly = false
      if (conversation.agentBinaryName === undefined) conversation.agentBinaryName = null
      if (conversation.cliHost === undefined) conversation.cliHost = null
      if (conversation.cliResumeCursor === undefined) conversation.cliResumeCursor = null
      if (!conversation.cliPaneBindings || typeof conversation.cliPaneBindings !== 'object') {
        conversation.cliPaneBindings = {}
      }
      if (conversation.focusedFilePath === undefined) conversation.focusedFilePath = null
      if (conversation.accountId === undefined) conversation.accountId = null
      if (conversation.swarmParentId === undefined) conversation.swarmParentId = null
      conversation.swarmLayout = sanitizeSwarmLayout(conversation.swarmLayout)
      conversation.swarmLayoutFull = sanitizeSwarmLayout(conversation.swarmLayoutFull)
      if (typeof conversation.resultUnseen !== 'boolean') conversation.resultUnseen = false
      if (!Array.isArray(conversation.compactions)) conversation.compactions = []
      if (!conversation.hostTranscripts || typeof conversation.hostTranscripts !== 'object') {
        conversation.hostTranscripts = {}
      } else {
        for (const key of Object.keys(conversation.hostTranscripts)) {
          const bucket = conversation.hostTranscripts[key]
          if (!bucket || typeof bucket !== 'object') continue
          if (typeof bucket.tokenLimit !== 'number') {
            bucket.tokenLimit = contextWindowFor(bucket.model ?? conversation.model)
          }
          if (bucket.reportedSessionCostUsd === undefined) {
            bucket.reportedSessionCostUsd = null
          }
          if (!Array.isArray(bucket.quotaWindows)) bucket.quotaWindows = []
        }
      }
      // Legacy untitled titles from earlier builds; normalize to the current locale.
      if (isDefaultSessionTitle(conversation.title) && !conversation.fileId) {
        conversation.title = defaultSessionTitle(currentLocale())
      }
      this.adoptTreeShape(conversation)
    }

    this.loaded = true

    // Empty sidebar is allowed — the UI offers "New session" when none remain.
    return this.conversations
  }

  all(): Conversation[] {
    return this.conversations
  }

  listMeta(): ConversationMeta[] {
    return this.conversations
      .filter((c) => !c.fileId)
      .map(conversationToMeta)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id)
  }

  /** Adopted remote: local id, or the host id when adopt remapped a collision. */
  findOnHost(machineId: string, hostConversationId: string): Conversation | undefined {
    const hostId = hostConversationId.trim()
    if (!hostId) return undefined
    return this.conversations.find(
      (c) =>
        conversationOnMachine(c, machineId) &&
        (c.id === hostId || (c.duplicateSourceId ?? '').trim() === hostId)
    )
  }

  create(
    workingDirectory: string | null,
    model: string,
    options?: {
      fileId?: string | null
      title?: string
      fileReadOnly?: boolean
      approvalMode?: import('@shared/types').ApprovalMode
      thinkingLevel?: ThinkingLevel
      fast?: boolean
      /** Structured CLI host; null/omit = built-in VAV. */
      cliHost?: CliHostKind | null
      /** Settings → Accounts profile for new sessions. */
      accountId?: string | null
      swarmParentId?: string | null
      machineId?: string | null
    }
  ): Conversation {
    const now = Date.now()
    const cliHost = options?.cliHost ?? null
    const conversation: Conversation = {
      id: randomUUID(),
      title: options?.title ?? defaultSessionTitle(currentLocale()),
      createdAt: now,
      updatedAt: now,
      workingDirectory,
      machineId: options?.machineId || LOCAL_MACHINE_ID,
      model,
      tokensUsed: 0,
      tokenLimit: contextWindowFor(model),
      messages: [],
      activeLeafId: null,
      tokenHistory: [],
      reportedSessionCostUsd: null,
      quotaWindows: [],
      cacheCreatedAt: null,
      cacheExpiresAt: null,
      pinned: false,
      pinTime: null,
      duplicateSourceId: null,
      duplicateSourceTitle: null,
      archived: false,
      archivedAt: null,
      approvalMode: options?.approvalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(options?.thinkingLevel),
      fast: options?.fast === true,
      fileId: options?.fileId ?? null,
      fileReadOnly: options?.fileReadOnly ?? false,
      agentBinaryName: cliHost,
      cliHost,
      cliResumeCursor: null,
      acpSession: null,
      cliPaneBindings: {},
      focusedFilePath: null,
      resultUnseen: false,
      accountId: options?.accountId ?? null,
      swarmParentId: options?.swarmParentId ?? null,
      swarmLayout: null,
      swarmLayoutFull: null,
      compactions: [],
      hostTranscripts: {}
    }
    this.conversations.unshift(conversation)
    this.markDirty(conversation.id)
    return conversation
  }

  /**
   * Insert a conversation produced by package import (or other external builders).
   * Assigns fresh ids for the conversation and every message so imports never
   * collide with existing sessions; preserves tree shape via parent remapping.
   */
  importConversation(source: Conversation): Conversation {
    const idMap = new Map<string, string>()
    for (const message of source.messages ?? []) idMap.set(message.id, randomUUID())

    const now = Date.now()
    const imported: Conversation = {
      ...structuredClone(source),
      id: randomUUID(),
      createdAt: source.createdAt || now,
      updatedAt: now,
      pinned: false,
      pinTime: null,
      archived: false,
      archivedAt: null,
      duplicateSourceId: source.id ?? null,
      duplicateSourceTitle: source.title ?? null,
      activeLeafId: source.activeLeafId ? (idMap.get(source.activeLeafId) ?? null) : null,
      tokenHistory: Array.isArray(source.tokenHistory) ? source.tokenHistory : [],
      cacheCreatedAt: null,
      cacheExpiresAt: null,
      fileId: null,
      fileReadOnly: false,
      accountId: source.accountId ?? null,
      messages: (source.messages ?? []).map((message) => ({
        ...structuredClone(message),
        id: idMap.get(message.id)!,
        parentId: message.parentId ? (idMap.get(message.parentId) ?? null) : null
      }))
    }
    if (!imported.workingDirectory) {
      // Caller may still patch workdir; leave null-ish only if absent.
      imported.workingDirectory = source.workingDirectory ?? null
    }
    if (!imported.machineId) imported.machineId = source.machineId || LOCAL_MACHINE_ID
    if (!imported.model) imported.model = 'unknown'
    if (!imported.title) imported.title = defaultSessionTitle(currentLocale())
    if (!imported.approvalMode) imported.approvalMode = 'auto'
    imported.thinkingLevel = parseThinkingLevel(imported.thinkingLevel)
    if (typeof imported.fast !== 'boolean') imported.fast = false
    if (typeof imported.tokensUsed !== 'number') imported.tokensUsed = 0
    if (typeof imported.tokenLimit !== 'number') {
      imported.tokenLimit = contextWindowFor(imported.model)
    }
    if (imported.reportedSessionCostUsd === undefined) imported.reportedSessionCostUsd = null
    if (!Array.isArray(imported.quotaWindows)) imported.quotaWindows = []
    if (imported.agentBinaryName === undefined) imported.agentBinaryName = null
    if (imported.cliHost === undefined) imported.cliHost = null
    if (imported.cliResumeCursor === undefined) imported.cliResumeCursor = null
    // Native session ids belong to the source machine / live TUI — do not reuse.
    imported.cliPaneBindings = {}
    if (imported.focusedFilePath === undefined) imported.focusedFilePath = null
    imported.resultUnseen = false
    imported.swarmParentId = null
    imported.swarmLayout = sanitizeSwarmLayout(imported.swarmLayout)
    imported.swarmLayoutFull = sanitizeSwarmLayout(imported.swarmLayoutFull)
    if (!imported.hostTranscripts || typeof imported.hostTranscripts !== 'object') {
      imported.hostTranscripts = {}
    }
    imported.compactions = (source.compactions ?? [])
      .map((c) => {
        const leafId = idMap.get(c.leafId)
        const keepAfterMessageId = idMap.get(c.keepAfterMessageId)
        if (!leafId || !keepAfterMessageId) return null
        return { ...c, leafId, keepAfterMessageId }
      })
      .filter((c): c is NonNullable<typeof c> => !!c)

    this.conversations.unshift(imported)
    this.markDirty(imported.id)
    return imported
  }

  /**
   * Copy a conversation that already lives on another VAV (same ids when
   * free). Unlike {@link importConversation}, this is a sync of that machine's
   * store — not a duplicate — so the remote sidebar can show the host's
   * sessions instead of minting an empty chat on this computer.
   */
  adoptHostConversation(source: Conversation, hostMachineId: string): Conversation | null {
    if (!source || typeof source.id !== 'string' || !source.id.trim()) return null
    if (source.fileId) return null
    const hostId = hostMachineId.trim() || LOCAL_MACHINE_ID
    const now = Date.now()
    const cloned = structuredClone(source)

    const existingIndex = this.conversations.findIndex(
      (c) =>
        conversationOnMachine(c, hostId) &&
        (c.id === source.id || c.duplicateSourceId === source.id)
    )
    const idTakenByOther =
      existingIndex < 0 && this.conversations.some((c) => c.id === source.id)
    const id =
      existingIndex >= 0
        ? this.conversations[existingIndex]!.id
        : idTakenByOther
          ? randomUUID()
          : source.id

    const adopted: Conversation = {
      ...cloned,
      id,
      machineId: hostId,
      createdAt: typeof cloned.createdAt === 'number' ? cloned.createdAt : now,
      updatedAt: typeof cloned.updatedAt === 'number' ? cloned.updatedAt : now,
      pinned: cloned.pinned === true,
      pinTime: cloned.pinTime ?? null,
      archived: cloned.archived === true,
      archivedAt: cloned.archivedAt ?? null,
      duplicateSourceId: idTakenByOther ? source.id : (cloned.duplicateSourceId ?? null),
      duplicateSourceTitle: idTakenByOther
        ? (cloned.title ?? null)
        : (cloned.duplicateSourceTitle ?? null),
      workingDirectory: cloned.workingDirectory ?? null,
      model: cloned.model || 'unknown',
      title: cloned.title || defaultSessionTitle(currentLocale()),
      approvalMode: cloned.approvalMode || 'auto',
      thinkingLevel: parseThinkingLevel(cloned.thinkingLevel),
      fast: cloned.fast === true,
      tokensUsed: typeof cloned.tokensUsed === 'number' ? cloned.tokensUsed : 0,
      tokenLimit:
        typeof cloned.tokenLimit === 'number'
          ? cloned.tokenLimit
          : contextWindowFor(cloned.model || 'unknown'),
      reportedSessionCostUsd: cloned.reportedSessionCostUsd ?? null,
      quotaWindows: Array.isArray(cloned.quotaWindows) ? cloned.quotaWindows : [],
      tokenHistory: Array.isArray(cloned.tokenHistory) ? cloned.tokenHistory : [],
      cacheCreatedAt: cloned.cacheCreatedAt ?? null,
      cacheExpiresAt: cloned.cacheExpiresAt ?? null,
      fileId: null,
      fileReadOnly: false,
      agentBinaryName: cloned.agentBinaryName ?? null,
      cliHost: cloned.cliHost ?? null,
      cliResumeCursor: cloned.cliResumeCursor ?? null,
      acpSession: cloned.acpSession ?? null,
      cliPaneBindings: {},
      focusedFilePath: cloned.focusedFilePath ?? null,
      resultUnseen: false,
      accountId: cloned.accountId ?? null,
      swarmParentId: cloned.swarmParentId ?? null,
      swarmLayout: sanitizeSwarmLayout(cloned.swarmLayout),
      swarmLayoutFull: sanitizeSwarmLayout(cloned.swarmLayoutFull),
      hostTranscripts:
        cloned.hostTranscripts && typeof cloned.hostTranscripts === 'object'
          ? cloned.hostTranscripts
          : {},
      messages: Array.isArray(cloned.messages) ? cloned.messages : [],
      activeLeafId: cloned.activeLeafId ?? null,
      compactions: Array.isArray(cloned.compactions) ? cloned.compactions : []
    }
    if (existingIndex >= 0) {
      const existing = this.conversations[existingIndex]!
      adopted.messages = mergeAdoptedHostMessages(adopted.messages, existing.messages)
      if (existing.updatedAt > adopted.updatedAt) adopted.updatedAt = existing.updatedAt
      const leafStillThere =
        existing.activeLeafId && adopted.messages.some((message) => message.id === existing.activeLeafId)
      if (leafStillThere) adopted.activeLeafId = existing.activeLeafId
    }
    this.adoptTreeShape(adopted)

    if (existingIndex >= 0) this.conversations[existingIndex] = adopted
    else this.conversations.unshift(adopted)
    this.markDirty(adopted.id)
    return adopted
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
      machineId: source.machineId || LOCAL_MACHINE_ID,
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
      thinkingLevel: parseThinkingLevel(source.thinkingLevel),
      fast: source.fast === true,
      agentBinaryName: source.agentBinaryName ?? source.cliHost ?? null,
      cliHost: source.cliHost ?? null,
      accountId: source.accountId ?? null,
      swarmParentId: null,
      swarmLayout: null,
      swarmLayoutFull: null,
      activeLeafId: source.activeLeafId ? (idMap.get(source.activeLeafId) ?? null) : null,
      tokenHistory: [],
      reportedSessionCostUsd: null,
      quotaWindows: [],
      cacheCreatedAt: null,
      cacheExpiresAt: null,
      resultUnseen: false,
      messages: source.messages.map((message) => ({
        ...structuredClone(message),
        id: idMap.get(message.id)!,
        parentId: message.parentId ? (idMap.get(message.parentId) ?? null) : null
      }))
    }
    this.conversations.unshift(copy)
    this.markDirty(copy.id)
    return copy
  }

  /**
   * Park the active host's transcript and restore the target host's bucket.
   * Each host keeps its own history; there is no cross-host context handoff.
   */
  switchHostTranscript(
    id: string,
    nextHost: CliHostKind | null
  ): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    if (!conversation.hostTranscripts) conversation.hostTranscripts = {}

    const prevKey = hostTranscriptKey(conversation.cliHost)
    const nextKey = hostTranscriptKey(nextHost)
    if (prevKey === nextKey) return conversation

    // Park current live tree under the previous host.
    conversation.hostTranscripts[prevKey] = snapshotHostBucket(conversation)

    const parked = conversation.hostTranscripts[nextKey]
    applyHostBucket(conversation, parked ?? emptyHostBucket())
    if (!parked) {
      conversation.tokenLimit = contextWindowFor(conversation.model)
      conversation.reportedSessionCostUsd = null
      conversation.quotaWindows = []
    }
    // Active bucket is live on the conversation — drop the stale parked copy.
    delete conversation.hostTranscripts[nextKey]

    conversation.cliHost = nextHost
    conversation.agentBinaryName = nextHost
    conversation.acpSession = null
    conversation.updatedAt = Date.now()
    this.markDirty(id)
    return conversation
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
    this.markDirty(id)
    return conversation
  }

  getCliPaneBindings(id: string): Record<string, CliPaneBinding> {
    return { ...(this.get(id)?.cliPaneBindings ?? {}) }
  }

  upsertCliPaneBinding(id: string, binding: CliPaneBinding): void {
    const conversation = this.get(id)
    if (!conversation) return
    if (!conversation.cliPaneBindings) conversation.cliPaneBindings = {}
    conversation.cliPaneBindings[binding.tabId] = binding
    this.markDirty(id)
  }

  deleteCliPaneBinding(id: string, tabId: string): void {
    const conversation = this.get(id)
    if (!conversation?.cliPaneBindings || !(tabId in conversation.cliPaneBindings)) return
    delete conversation.cliPaneBindings[tabId]
    this.markDirty(id)
  }

  clearCliPaneBindings(id: string): void {
    const conversation = this.get(id)
    if (!conversation) return
    if (!conversation.cliPaneBindings || Object.keys(conversation.cliPaneBindings).length === 0) {
      conversation.cliPaneBindings = {}
      return
    }
    conversation.cliPaneBindings = {}
    this.markDirty(id)
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
    this.markDirty(id)
  }

  /**
   * Remove a message and its descendants. Sibling branches stay.
   * Returns null when the id is unknown.
   */
  deleteMessage(id: string, messageId: string): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    const target = conversation.messages.find((message) => message.id === messageId)
    if (!target) return undefined
    const { messages, removed } = pruneSubtree(conversation.messages, messageId)
    if (removed.size === 0) return conversation
    conversation.messages = messages
    conversation.activeLeafId = leafAfterPrune(
      messages,
      removed,
      target.parentId ?? null,
      conversation.activeLeafId ?? null
    )
    if (conversation.compactions?.length) {
      conversation.compactions = conversation.compactions.filter(
        (compaction) =>
          !removed.has(compaction.leafId) && !removed.has(compaction.keepAfterMessageId)
      )
    }
    conversation.updatedAt = Date.now()
    this.markDirty(id)
    return conversation
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
    this.markDirty(id)
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
    this.markDirty(id)
    return conversation.activeLeafId
  }

  setActiveLeaf(id: string, leafId: string | null): void {
    const conversation = this.get(id)
    if (!conversation) return
    conversation.activeLeafId = leafId
    this.markDirty(id)
  }

  /** Upsert a per-leaf compaction (originals stay in messages). */
  setCompaction(id: string, compaction: LeafCompaction): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.compactions = upsertCompaction(conversation.compactions, compaction)
    this.markDirty(id)
    return conversation
  }

  /** Drop compaction for one leaf path. */
  clearCompaction(id: string, leafId: string): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.compactions = removeCompaction(conversation.compactions, leafId)
    this.markDirty(id)
    return conversation
  }

  addTokens(id: string, tokens: number): void {
    const conversation = this.get(id)
    if (!conversation) return
    conversation.tokensUsed += tokens
    this.markDirty(id)
  }

  /**
   * Replace the context-window fill meter (not session cost total).
   * Used after manual compact so the ring shrinks to the estimated next request.
   */
  setContextFill(id: string, tokens: number): void {
    const conversation = this.get(id)
    if (!conversation) return
    conversation.tokensUsed = Math.max(0, Math.round(tokens))
    this.markDirty(id)
  }

  setTokenLimit(id: string, limit: number): void {
    const conversation = this.get(id)
    if (!conversation) return
    const next = Math.max(1, Math.round(limit))
    if (conversation.tokenLimit === next) return
    conversation.tokenLimit = next
    this.markDirty(id)
  }

  /** Backfill empty CLI usage from the host's on-disk session (Grok updates.jsonl). */
  hydrateMissingHostUsage(id: string): boolean {
    const conversation = this.get(id)
    if (!conversation) return false
    if (!applyMissingHostUsage(conversation)) return false
    this.markDirty(id)
    return true
  }

  hydrateMissingHostUsageAll(): number {
    let n = 0
    for (const conversation of this.conversations) {
      if (!applyMissingHostUsage(conversation)) continue
      this.markDirty(conversation.id)
      n++
    }
    return n
  }

  setReportedSessionCostUsd(id: string, costUsd: number | null): void {
    const conversation = this.get(id)
    if (!conversation) return
    const next =
      costUsd == null || !Number.isFinite(costUsd) ? null : Math.max(0, costUsd)
    if (conversation.reportedSessionCostUsd === next) return
    conversation.reportedSessionCostUsd = next
    this.markDirty(id)
  }

  /**
   * Merge live CLI quota windows (by id). Returns true when the stored list changed.
   */
  mergeQuotaWindows(id: string, incoming: QuotaWindow[]): boolean {
    const conversation = this.get(id)
    if (!conversation || incoming.length === 0) return false
    const next = mergeQuotaWindows(conversation.quotaWindows, incoming)
    const prev = conversation.quotaWindows ?? []
    if (
      prev.length === next.length &&
      prev.every(
        (w, i) =>
          w.id === next[i]!.id &&
          w.usedPercent === next[i]!.usedPercent &&
          w.resetsAt === next[i]!.resetsAt
      )
    ) {
      return false
    }
    conversation.quotaWindows = next
    this.markDirty(id)
    return true
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
    this.markDirty(id)
    return conversation
  }

  /**
   * Removes conversations. The sidebar may become empty — the renderer shows
   * an empty state and creates a session on demand.
   */
  remove(ids: string[]): string[] {
    const target = new Set(expandRemovedSwarmIds(this.conversations, ids))
    const removed = this.conversations.filter((c) => target.has(c.id)).map((c) => c.id)
    if (removed.length === 0) return []
    const parents = new Set(
      this.conversations
        .filter((c) => target.has(c.id) && c.swarmParentId)
        .map((c) => c.swarmParentId!)
    )
    this.conversations = this.conversations.filter((c) => !target.has(c.id))
    for (const parentId of parents) {
      if (target.has(parentId)) continue
      const parent = this.get(parentId)
      if (!parent?.swarmLayout && !parent?.swarmLayoutFull) continue
      let layout: TerminalLayoutNode | null = parent.swarmLayout ?? null
      let full: TerminalLayoutNode | null = parent.swarmLayoutFull ?? null
      for (const id of removed) {
        if (layout) layout = removeSwarmLeaf(layout, id)
        if (full) full = removeSwarmLeaf(full, id)
      }
      parent.swarmLayout = layout
      parent.swarmLayoutFull = full
      this.markDirty(parentId)
    }
    this.markDeleted(removed)
    return removed
  }

  /** Toggles the pin, stamping pinTime so the pinned section can order itself. */
  setPinned(id: string, pinned: boolean): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.pinned = pinned
    conversation.pinTime = pinned ? Date.now() : null
    this.markDirty(id)
    return conversation
  }

  /** Archives or restores a conversation. Archiving the last active one is allowed. */
  setArchived(id: string, archived: boolean): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    if (archived) {
      conversation.archived = true
      conversation.archivedAt = Date.now()
      conversation.pinned = false
      conversation.pinTime = null
    } else {
      conversation.archived = false
      conversation.archivedAt = null
    }
    conversation.updatedAt = Date.now()
    this.markDirty(id)
    return conversation
  }

  setApprovalMode(id: string, mode: ApprovalMode): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.approvalMode = mode
    this.markDirty(id)
    return conversation
  }

  setThinkingLevel(id: string, level: ThinkingLevel): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.thinkingLevel = parseThinkingLevel(level)
    this.markDirty(id)
    return conversation
  }

  setFast(id: string, fast: boolean): Conversation | undefined {
    const conversation = this.get(id)
    if (!conversation) return undefined
    conversation.fast = fast === true
    this.markDirty(id)
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

    const next = this.create(source.workingDirectory, source.model, {
      approvalMode: source.approvalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(source.thinkingLevel),
      fast: source.fast === true,
      cliHost: source.cliHost ?? null,
      accountId: source.accountId ?? null
    })
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
    this.markDirty(next.id)
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

  private shardPath(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  private loadFromIndex(): Conversation[] {
    const raw = JSON.parse(readFileSync(this.indexPath, 'utf8')) as ConversationIndex
    const ids = Array.isArray(raw?.ids) ? raw.ids : []
    const loaded: Conversation[] = []
    for (const id of ids) {
      if (typeof id !== 'string' || !id) continue
      const file = this.shardPath(id)
      if (!existsSync(file)) continue
      try {
        const conversation = JSON.parse(readFileSync(file, 'utf8')) as Conversation
        if (conversation?.id) loaded.push(conversation)
      } catch (err) {
        console.error(`[conversations] skip corrupt shard ${id}`, err)
      }
    }
    return loaded
  }

  /**
   * Read legacy monolithic `conversations.json`, write shards + index, then
   * rename the legacy file to `conversations.json.bak` so a botched migrate
   * can still be recovered.
   */
  private migrateFromLegacy(): Conversation[] {
    const raw = JSON.parse(readFileSync(this.legacyFile, 'utf8'))
    const list: Conversation[] = Array.isArray(raw?.conversations)
      ? raw.conversations.filter((c: Conversation) => !!c?.id)
      : []

    mkdirSync(this.dir, { recursive: true })
    for (const conversation of list) {
      this.writeJsonSync(this.shardPath(conversation.id), conversation)
    }
    this.writeJsonSync(this.indexPath, {
      version: INDEX_VERSION,
      ids: list.map((c) => c.id)
    } satisfies ConversationIndex)

    const bak = `${this.legacyFile}.bak`
    try {
      if (existsSync(bak)) unlinkSync(bak)
      renameSync(this.legacyFile, bak)
    } catch (err) {
      console.error('[conversations] migrate rename to .bak failed', err)
    }
    console.info(`[conversations] migrated ${list.length} conversation(s) to shards`)
    return list
  }

  private markDirty(id: string): void {
    this.deleted.delete(id)
    this.dirty.add(id)
    this.dirtyGen.set(id, (this.dirtyGen.get(id) ?? 0) + 1)
    this.scheduleFlush()
  }

  private markDeleted(ids: string[]): void {
    for (const id of ids) {
      this.dirty.delete(id)
      this.dirtyGen.delete(id)
      this.deleted.add(id)
    }
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flushAsync()
    }, 400)
  }

  /**
   * Debounced path: async fs writes for dirty shards + index only.
   * Queues a follow-up pass if mutations land while a write is in flight.
   */
  private async flushAsync(): Promise<void> {
    if (!this.loaded) return
    if (this.flushInFlight) {
      this.flushAgain = true
      await this.flushInFlight
      return
    }
    this.flushInFlight = this.persistDirtyAsync()
    try {
      await this.flushInFlight
    } finally {
      this.flushInFlight = null
    }
    if (this.flushAgain) {
      this.flushAgain = false
      if (this.dirty.size > 0 || this.deleted.size > 0) await this.flushAsync()
    }
  }

  /**
   * Quit / turn-end path: cancel debounce and synchronously persist dirty
   * shards + index so data is on disk before the process exits.
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    // Writing before a read would replace files with this process's blank
    // slate. Quit paths run whether or not startup got far enough to load.
    if (!this.loaded) return
    // Invalidate any in-flight async persist so it cannot overwrite fresher sync writes.
    this.writeEpoch++
    this.persistDirtySync()
  }

  private snapshotDirty(): {
    dirtyIds: string[]
    deletedIds: string[]
    gens: Map<string, number>
    payloads: { id: string; body: string }[]
    indexBody: string
  } | null {
    if (this.dirty.size === 0 && this.deleted.size === 0) return null
    const dirtyIds = [...this.dirty]
    const deletedIds = [...this.deleted]
    const gens = new Map<string, number>()
    for (const id of dirtyIds) gens.set(id, this.dirtyGen.get(id) ?? 0)

    const payloads: { id: string; body: string }[] = []
    for (const id of dirtyIds) {
      const conversation = this.get(id)
      if (!conversation) continue
      payloads.push({ id, body: JSON.stringify(conversation) })
    }
    const indexBody = JSON.stringify({
      version: INDEX_VERSION,
      ids: this.conversations.map((c) => c.id)
    } satisfies ConversationIndex)

    return { dirtyIds, deletedIds, gens, payloads, indexBody }
  }

  private clearPersisted(
    dirtyIds: string[],
    deletedIds: string[],
    gens: Map<string, number>
  ): void {
    for (const id of dirtyIds) {
      if ((this.dirtyGen.get(id) ?? 0) === gens.get(id)) {
        this.dirty.delete(id)
        this.dirtyGen.delete(id)
      }
    }
    for (const id of deletedIds) this.deleted.delete(id)
  }

  private persistDirtySync(): void {
    const snap = this.snapshotDirty()
    if (!snap) return
    try {
      mkdirSync(this.dir, { recursive: true })
      for (const { id, body } of snap.payloads) {
        this.writeJsonRawSync(this.shardPath(id), body)
      }
      for (const id of snap.deletedIds) {
        this.unlinkQuietSync(this.shardPath(id))
      }
      this.writeJsonRawSync(this.indexPath, snap.indexBody)
      this.clearPersisted(snap.dirtyIds, snap.deletedIds, snap.gens)
    } catch (err) {
      console.error('[conversations] flush failed', err)
    }
  }

  private async persistDirtyAsync(): Promise<void> {
    const epoch = this.writeEpoch
    const snap = this.snapshotDirty()
    if (!snap) return
    try {
      await mkdirAsync(this.dir, { recursive: true })
      if (epoch !== this.writeEpoch) return
      for (const { id, body } of snap.payloads) {
        if (epoch !== this.writeEpoch) return
        await this.writeJsonRawAsync(this.shardPath(id), body)
      }
      for (const id of snap.deletedIds) {
        if (epoch !== this.writeEpoch) return
        await this.unlinkQuietAsync(this.shardPath(id))
      }
      if (epoch !== this.writeEpoch) return
      await this.writeJsonRawAsync(this.indexPath, snap.indexBody)
      if (epoch !== this.writeEpoch) return
      this.clearPersisted(snap.dirtyIds, snap.deletedIds, snap.gens)
    } catch (err) {
      console.error('[conversations] async flush failed', err)
    }
  }

  private writeJsonSync(file: string, value: unknown): void {
    this.writeJsonRawSync(file, JSON.stringify(value))
  }

  private writeJsonRawSync(file: string, body: string): void {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, body, 'utf8')
    renameSync(tmp, file)
  }

  private async writeJsonRawAsync(file: string, body: string): Promise<void> {
    const tmp = `${file}.tmp`
    await writeFileAsync(tmp, body, 'utf8')
    await renameAsync(tmp, file)
  }

  private unlinkQuietSync(file: string): void {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      /* ignore missing */
    }
  }

  private async unlinkQuietAsync(file: string): Promise<void> {
    try {
      await unlinkAsync(file)
    } catch {
      /* ignore missing */
    }
  }
}

function emptyHostBucket(): HostTranscriptBucket {
  return {
    messages: [],
    activeLeafId: null,
    tokenHistory: [],
    tokensUsed: 0,
    tokenLimit: 200_000,
    reportedSessionCostUsd: null,
    quotaWindows: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    compactions: [],
    cliResumeCursor: null,
    model: null
  }
}

function snapshotHostBucket(conversation: Conversation): HostTranscriptBucket {
  return {
    messages: conversation.messages.map((m) => structuredClone(m)),
    activeLeafId: conversation.activeLeafId,
    tokenHistory: [...(conversation.tokenHistory ?? [])],
    tokensUsed: conversation.tokensUsed ?? 0,
    tokenLimit: conversation.tokenLimit ?? 200_000,
    reportedSessionCostUsd: conversation.reportedSessionCostUsd ?? null,
    quotaWindows: [...(conversation.quotaWindows ?? [])],
    cacheCreatedAt: conversation.cacheCreatedAt ?? null,
    cacheExpiresAt: conversation.cacheExpiresAt ?? null,
    compactions: structuredClone(conversation.compactions ?? []),
    cliResumeCursor: conversation.cliResumeCursor
      ? structuredClone(conversation.cliResumeCursor)
      : null,
    model: conversation.model ?? null
  }
}

function applyHostBucket(conversation: Conversation, bucket: HostTranscriptBucket): void {
  conversation.messages = bucket.messages.map((m) => structuredClone(m))
  conversation.activeLeafId = bucket.activeLeafId
  conversation.tokenHistory = [...bucket.tokenHistory]
  conversation.tokensUsed = bucket.tokensUsed
  conversation.tokenLimit = bucket.tokenLimit ?? contextWindowFor(bucket.model)
  conversation.reportedSessionCostUsd = bucket.reportedSessionCostUsd ?? null
  conversation.quotaWindows = [...(bucket.quotaWindows ?? [])]
  conversation.cacheCreatedAt = bucket.cacheCreatedAt
  conversation.cacheExpiresAt = bucket.cacheExpiresAt
  conversation.compactions = structuredClone(bucket.compactions)
  conversation.cliResumeCursor = bucket.cliResumeCursor
    ? structuredClone(bucket.cliResumeCursor)
    : null
  if (bucket.model) conversation.model = bucket.model
}
