import type { ChangeSet } from '../../../shared/changeSet.ts'
import type { ChatMessage, ConversationMeta, TokenSnapshot, TurnEvent } from '../../../shared/types.ts'
import { getProjection } from './StreamProjection.ts'
import { clearPriorChangeReviews, upsert } from './sessionThread.ts'
import { omitLiveUsage } from './sessionUsage.ts'
import { AGENT_TAB_ID, useWorkspaceStore } from './workspaceStore.ts'
import type { LiveUsage, TurnRuntime } from './sessionTypes.ts'

export const IDLE_TURN: TurnRuntime = {
  isRunning: false,
  phase: 'idle',
  toolCount: 0,
  awaitingToolCallId: null,
  startedModel: undefined,
  startedCliHost: undefined,
  startedAccountId: undefined
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
  errorBannerKind: 'quota' | 'session-stale' | 'auth' | 'network' | 'cancelled' | 'generic' | null
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
        startedAccountId: started?.accountId ?? null
      })
      set((state) => ({
        ...clearPriorChangeReviews(state, id),
        errorBanner: null,
        errorBannerKind: null,
        errorBannerDetail: null
      }))
      break
    }

    case 'user':
      set((state) => {
        const cleared = clearPriorChangeReviews(state, id)
        const baseMessages = cleared.messages ?? state.messages
        return {
          ...cleared,
          messages: {
            ...baseMessages,
            [id]: upsert(baseMessages[id], event.message)
          },
          activeLeaf: { ...state.activeLeaf, [id]: event.message.id }
        }
      })
      break

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
      projection.setPhase(event.phase)
      patchTurn(set, id, { phase: event.phase })
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
          (event.block.tool === 'request' || event.block.tool === 'ask_user_question')
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
      projection.end()
      patchTurn(set, id, IDLE_TURN)
      set((state) => {
        const liveUsage = omitLiveUsage(state.liveUsage, id)
        const conversations = state.conversations.map((c) =>
          c.id === id ? { ...c, tokensUsed: event.tokensUsed } : c
        )
        if (
          event.message.blocks.length === 0 &&
          !event.message.changeSetId &&
          !event.message.errorText &&
          !event.message.cancelled
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
