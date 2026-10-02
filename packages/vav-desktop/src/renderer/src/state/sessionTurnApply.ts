import type { ChangeSet } from '@shared/changeSet.ts'
import type { ChatMessage, ConversationMeta, TokenSnapshot, TurnErrorKind, TurnEvent } from '@shared/types.ts'
import { newestLeafId } from '@shared/thread.ts'
import { getProjection } from './StreamProjection.ts'
import { clearPriorChangeReviews, upsert } from './sessionThread.ts'
import { omitLiveUsage } from './sessionUsage.ts'
import { AGENT_TAB_ID, useWorkspaceStore } from './workspaceStore.ts'
import type { LiveUsage, TurnRuntime } from './sessionTypes.ts'

/**
 * Idle frame from the control plane / phone bridge. Its id is made up and its
 * parent is null: it only says "the turn is over". Upserting it used to add a
 * second root (an error or cancel bubble alone on screen, a branch pager above
 * the first prompt, the real thread hidden behind it).
 */
export function isSyntheticEndMessage(message: { id: string }): boolean {
  return message.id.startsWith('remote-end-') || message.id.startsWith('live-end-')
}

function isEmptyAssistant(message: ChatMessage): boolean {
  return (
    message.blocks.length === 0 &&
    !message.content &&
    !message.changeSetId &&
    !message.errorText
  )
}

/** Optimistic phone/web user bubble (`local-user-*`) — the bridge does not know the leaf. */
function isOptimisticUser(message: ChatMessage): boolean {
  return message.role === 'user' && message.id.startsWith('local-user-')
}

function leafOf(state: TurnApplyState, id: string): string | null {
  const list = state.messages[id]
  if (!list?.length) return null
  const leaf = state.activeLeaf[id]
  if (leaf && list.some((m) => m.id === leaf)) return leaf
  return newestLeafId(list)
}

function parentMissing(state: TurnApplyState, id: string, message: ChatMessage): boolean {
  const parentId = message.parentId
  if (!parentId) return false
  return !(state.messages[id] ?? []).some((m) => m.id === parentId)
}

/** The visible leaf already shows this error inline — no banner on top. */
function leafCarriesError(state: TurnApplyState, id: string): boolean {
  const leaf = leafOf(state, id)
  const row = leaf ? state.messages[id]?.find((m) => m.id === leaf) : undefined
  return Boolean(row && row.role === 'assistant' && row.errorText)
}

export const IDLE_TURN: TurnRuntime = {
  isRunning: false,
  phase: 'idle',
  toolCount: 0,
  awaitingToolCallId: null,
  startedModel: undefined,
  startedCliHost: undefined,
  startedAccountId: undefined,
  recovery: null
}

export type TurnApplyState = {
  conversations: ConversationMeta[]
  turns: Record<string, TurnRuntime>
  liveUsage: Record<string, LiveUsage>
  messages: Record<string, ChatMessage[]>
  activeLeaf: Record<string, string | null>
  tokenHistories: Record<string, TokenSnapshot[]>
  cacheCreatedAt: Record<string, number | null>
  cacheExpiresAt: Record<string, number | null>
  pendingReviewByConversation: Record<string, { changeSetId: string; count: number }>
  changeSetsById: Record<string, ChangeSet>
  changeSet: ChangeSet | null
  changeReviewId: string | null
  errorBanner: string | null
  errorBannerKind: TurnErrorKind | null
  errorBannerDetail: string | null
}

type SetFn = (
  partial:
    | Partial<TurnApplyState>
    | ((state: TurnApplyState) => Partial<TurnApplyState>)
) => void

const seenTools = new Map<string, Set<string>>()

export function patchTurn(
  set: SetFn,
  id: string,
  patch: Partial<TurnRuntime>
): void {
  set((state) => ({
    turns: { ...state.turns, [id]: { ...(state.turns[id] ?? IDLE_TURN), ...patch } }
  }))
}

function countTools(get: () => TurnApplyState, conversationId: string, toolId: string): number {
  let set = seenTools.get(conversationId)
  if (!set) {
    set = new Set()
    seenTools.set(conversationId, set)
  }
  if (!get().turns[conversationId]?.isRunning) set.clear()
  set.add(toolId)
  return set.size
}

/** Fold a main-process turn event into the session store. */
export function applySessionTurnEvent(
  event: TurnEvent,
  ctx: {
    get: () => TurnApplyState
    set: SetFn
    refreshConversations: () => void
    drainQueue: (id: string) => void
    openChangeReview: (changeSetId: string) => void
    /**
     * Re-read this conversation from main and merge it in. Used when the
     * renderer's tree has a gap (a reply whose parent never arrived — e.g. a
     * scheduled run that started before this window knew the session).
     */
    resyncMessages?: (id: string) => void
  }
): void {
  const { get, set } = ctx
  const id = event.conversationId
  const projection = getProjection(id)

  switch (event.type) {
    case 'start': {
      projection.start()
      const started = get().conversations.find((c) => c.id === id)
      patchTurn(set, id, {
        isRunning: true,
        phase: 'thinking',
        toolCount: 0,
        awaitingToolCallId: null,
        startedModel: started?.model,
        startedCliHost: started?.cliHost ?? null,
        startedAccountId: started?.accountId ?? null,
        recovery: null
      })
      set((state) => ({
        ...clearPriorChangeReviews(state, id),
        errorBanner: null,
        errorBannerKind: null,
        errorBannerDetail: null
      }))
      break
    }

    case 'user': {
      // A finished-but-unsealed reply must not linger under the next prompt.
      if (projection.isSettled()) projection.end()
      let missing = false
      set((state) => {
        let message = event.message
        // Hang the optimistic bubble off the thread instead of minting a root.
        if (isOptimisticUser(message) && !message.parentId) {
          const leaf = leafOf(state, id)
          if (leaf) message = { ...message, parentId: leaf }
        }
        missing = parentMissing(state, id, message)
        const cleared = clearPriorChangeReviews(state, id)
        const baseMessages = cleared.messages ?? state.messages
        // The real prompt replaces the optimistic one once it arrives.
        const base = isOptimisticUser(message)
          ? baseMessages[id]
          : baseMessages[id]?.filter(
              (row) => !(isOptimisticUser(row) && row.content === message.content)
            )
        return {
          ...cleared,
          messages: {
            ...baseMessages,
            [id]: upsert(base, message)
          },
          activeLeaf: { ...state.activeLeaf, [id]: message.id }
        }
      })
      if (missing) ctx.resyncMessages?.(id)
      break
    }

    case 'notice':
      set((state) => ({
        messages: {
          ...state.messages,
          [id]: upsert(state.messages[id], event.message)
        },
        activeLeaf: { ...state.activeLeaf, [id]: event.message.id }
      }))
      break

    case 'phase':
      projection.ensureLive(event.phase)
      projection.setPhase(event.phase, event.recovery ?? null)
      patchTurn(set, id, { phase: event.phase, recovery: event.recovery ?? null })
      break

    case 'delta':
      if (event.kind === 'text' && event.replace) projection.replaceText(event.index, event.text)
      else if (event.kind === 'text') projection.appendText(event.index, event.text)
      else projection.appendReasoning(event.index, event.text)
      break

    case 'tool':
      projection.upsertTool(event.index, event.block)
      patchTurn(set, id, {
        toolCount: countTools(get, id, event.block.id),
        awaitingToolCallId:
          event.block.status === 'pending' &&
          (event.block.tool === 'request' ||
            event.block.tool === 'ask_user_question' ||
            event.block.tool === 'request_for_secret')
            ? event.block.id
            : get().turns[id]?.awaitingToolCallId === event.block.id
              ? null
              : (get().turns[id]?.awaitingToolCallId ?? null)
      })
      break

    case 'awaiting':
      projection.setPhase('awaiting-user')
      projection.upsertTool(event.index, event.block)
      patchTurn(set, id, { awaitingToolCallId: event.toolCallId, phase: 'awaiting-user' })
      break

    case 'mirror': {
      const workspace = useWorkspaceStore.getState()
      workspace.mirrorAgentTranscript(id, event.text)
      const slice = workspace.workspaces[id]
      if (slice?.tabs.some((tab) => tab.isAgent) && slice.activeTabId !== AGENT_TAB_ID) {
        workspace.selectTab(id, AGENT_TAB_ID)
      }
      break
    }

    case 'fs-changed':
      useWorkspaceStore.getState().agentDidWriteFile(id, event.parentPath, event.filePath)
      break

    case 'file-draft':
      break

    case 'knowledge-draft': {
      const noteId = event.noteConversationId
      const title = event.title?.trim()
      if (!noteId || !title) break
      set((state) => {
        const row = state.conversations.find((item) => item.id === noteId)
        if (!row || row.title === title) return state
        return {
          conversations: state.conversations.map((item) =>
            item.id === noteId ? { ...item, title } : item
          )
        }
      })
      break
    }

    case 'cli-session':
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, acpSession: event.state } : c
        )
      }))
      break

    case 'usage':
      set((state) => {
        const prev = state.liveUsage[id]
        const tokenLimit =
          typeof event.tokenLimit === 'number' ? event.tokenLimit : prev?.tokenLimit
        const usageSame =
          prev?.tokensUsed === event.tokensUsed && prev?.tokenLimit === tokenLimit
        return {
          tokenHistories: { ...state.tokenHistories, [id]: event.history },
          cacheCreatedAt: { ...state.cacheCreatedAt, [id]: event.cacheCreatedAt },
          cacheExpiresAt: { ...state.cacheExpiresAt, [id]: event.cacheExpiresAt },
          liveUsage: usageSame
            ? state.liveUsage
            : {
                ...state.liveUsage,
                [id]: {
                  tokensUsed: event.tokensUsed,
                  ...(tokenLimit != null ? { tokenLimit } : {})
                }
              }
        }
      })
      break

    case 'end': {
      // Nothing sealed to take over from the live view: a synthetic idle frame
      // (`remote-end-*` / `live-end-*`), or Stop / a failure before anything was
      // persisted. Keep what streamed on screen instead of blanking it, never
      // insert the placeholder into the tree, and re-read main — the sealed
      // copy is usually already there.
      const synthetic = isSyntheticEndMessage(event.message)
      if (synthetic || (isEmptyAssistant(event.message) && (event.cancelled || event.error))) {
        projection.settle()
        patchTurn(set, id, IDLE_TURN)
        set((state) => ({ liveUsage: omitLiveUsage(state.liveUsage, id) }))
        if (synthetic) ctx.resyncMessages?.(id)
        ctx.refreshConversations()
        if (
          event.error &&
          !event.cancelled &&
          event.errorKind !== 'cancelled' &&
          !leafCarriesError(get(), id)
        ) {
          set({
            errorBanner: event.error,
            errorBannerKind: event.errorKind ?? 'generic',
            errorBannerDetail: event.errorDetail || event.error
          })
        }
        ctx.drainQueue(id)
        break
      }
      const orphan = parentMissing(get(), id, event.message)
      projection.end()
      patchTurn(set, id, IDLE_TURN)
      set((state) => {
        const liveUsage = omitLiveUsage(state.liveUsage, id)
        const conversations = state.conversations.map((c) =>
          c.id === id ? { ...c, tokensUsed: event.tokensUsed } : c
        )
        if (
          event.message.blocks.length === 0 &&
          !event.message.content &&
          !event.message.changeSetId &&
          !event.message.errorText
        ) {
          return { conversations, liveUsage }
        }
        return {
          messages: { ...state.messages, [id]: upsert(state.messages[id], event.message) },
          activeLeaf: { ...state.activeLeaf, [id]: event.message.id },
          conversations,
          liveUsage
        }
      })
      ctx.refreshConversations()
      if (orphan) ctx.resyncMessages?.(id)
      if (
        event.error &&
        !event.cancelled &&
        event.errorKind !== 'cancelled' &&
        !event.message.errorText
      ) {
        set({
          errorBanner: event.error,
          errorBannerKind: event.errorKind ?? 'generic',
          errorBannerDetail: event.errorDetail || event.error
        })
      }
      ctx.drainQueue(id)
      break
    }

    case 'change-review': {
      set((state) => {
        const list = state.messages[id] ?? []
        const msgId = event.messageId
        let messages = state.messages
        if (msgId && list.some((m) => m.id === msgId)) {
          messages = {
            ...state.messages,
            [id]: list.map((m) =>
              m.id === msgId ? { ...m, changeSetId: event.changeSetId } : m
            )
          }
        } else if (msgId && !list.some((m) => m.id === msgId)) {
          // end may still be in flight relative to another window
        } else if (!msgId) {
          const path = list.filter((m) => m.role === 'assistant')
          const last = path[path.length - 1]
          if (last) {
            messages = {
              ...state.messages,
              [id]: list.map((m) =>
                m.id === last.id ? { ...m, changeSetId: event.changeSetId } : m
              )
            }
          }
        }
        const pendingNext = { ...state.pendingReviewByConversation }
        if (event.pendingCount > 0) {
          pendingNext[id] = { changeSetId: event.changeSetId, count: event.pendingCount }
        } else {
          delete pendingNext[id]
        }
        const seeded = event.changeSet
        const changeSetsById = seeded
          ? { ...state.changeSetsById, [seeded.id]: seeded }
          : state.changeSetsById
        return {
          messages,
          pendingReviewByConversation: pendingNext,
          changeSetsById,
          ...(seeded ? { changeSet: seeded } : {})
        }
      })
      if (!event.changeSet) void ctx.openChangeReview(event.changeSetId)
      break
    }
  }
}
