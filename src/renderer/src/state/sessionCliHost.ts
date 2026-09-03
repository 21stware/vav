import type {
  ChatMessage,
  CliHostKind,
  ConversationMeta,
  LeafCompaction,
  ProviderResumeCursor,
  QuotaWindow,
  TokenSnapshot
} from '../../../shared/types.ts'
import { mergeConversationList } from './sessionListMerge.ts'
import { omitLiveUsage } from './sessionUsage.ts'

export type CliHostTranscript = {
  messages: ChatMessage[]
  activeLeafId: string | null
  compactions: LeafCompaction[]
  tokenHistory: TokenSnapshot[]
  tokensUsed: number
  cacheCreatedAt: number | null
  cacheExpiresAt: number | null
  cliResumeCursor: ProviderResumeCursor | null
  cliHost: CliHostKind | null
  model: string
  quotaWindows: QuotaWindow[]
}

export type CliHostSetResult = {
  conversations: ConversationMeta[]
  hostChanged: boolean
  transcript: CliHostTranscript | null
}

/**
 * Hydrate a parked CLI-host transcript (or just merge listMeta) after
 * `conversations.setCliHost`. Host switches also drop review/turn overlays
 * and the active error banner.
 */
export function applyCliHostSetResult<
  Review,
  Turn,
  Usage,
  Banner,
  Kind,
  Detail
>(
  state: {
    conversations: ConversationMeta[]
    messages: Record<string, ChatMessage[]>
    messagesHydrated: Record<string, boolean>
    activeLeaf: Record<string, string | null>
    compactions: Record<string, LeafCompaction[]>
    tokenHistories: Record<string, TokenSnapshot[]>
    cacheCreatedAt: Record<string, number | null>
    cacheExpiresAt: Record<string, number | null>
    pendingReviewByConversation: Record<string, Review>
    turns: Record<string, Turn>
    liveUsage: Record<string, Usage>
    activeId: string | null
    errorBanner: Banner
    errorBannerKind: Kind
    errorBannerDetail: Detail
  },
  id: string,
  result: CliHostSetResult
): {
  conversations: ConversationMeta[]
  messages: Record<string, ChatMessage[]>
  messagesHydrated: Record<string, boolean>
  activeLeaf: Record<string, string | null>
  compactions: Record<string, LeafCompaction[]>
  tokenHistories: Record<string, TokenSnapshot[]>
  cacheCreatedAt: Record<string, number | null>
  cacheExpiresAt: Record<string, number | null>
  pendingReviewByConversation: Record<string, Review>
  turns: Record<string, Turn>
  liveUsage: Record<string, Usage>
  errorBanner: Banner | null
  errorBannerKind: Kind | null
  errorBannerDetail: Detail | null
} {
  const pendingReviewByConversation = { ...state.pendingReviewByConversation }
  const turns = { ...state.turns }
  if (result.hostChanged) {
    delete pendingReviewByConversation[id]
    delete turns[id]
  }
  let conversations = mergeConversationList(state.conversations, result.conversations)
  const transcript = result.transcript
  if (transcript) {
    conversations = conversations.map((c) =>
      c.id === id
        ? {
            ...c,
            tokensUsed: transcript.tokensUsed,
            cliResumeCursor: transcript.cliResumeCursor,
            cliHost: transcript.cliHost,
            model: transcript.model || c.model,
            quotaWindows: transcript.quotaWindows ?? []
          }
        : c
    )
  }
  const clearBanner = result.hostChanged && state.activeId === id
  return {
    conversations,
    messages: transcript ? { ...state.messages, [id]: transcript.messages } : state.messages,
    messagesHydrated: transcript
      ? { ...state.messagesHydrated, [id]: true }
      : state.messagesHydrated,
    activeLeaf: transcript
      ? { ...state.activeLeaf, [id]: transcript.activeLeafId }
      : state.activeLeaf,
    compactions: transcript
      ? { ...state.compactions, [id]: transcript.compactions }
      : state.compactions,
    tokenHistories: transcript
      ? { ...state.tokenHistories, [id]: transcript.tokenHistory }
      : state.tokenHistories,
    cacheCreatedAt: transcript
      ? { ...state.cacheCreatedAt, [id]: transcript.cacheCreatedAt }
      : state.cacheCreatedAt,
    cacheExpiresAt: transcript
      ? { ...state.cacheExpiresAt, [id]: transcript.cacheExpiresAt }
      : state.cacheExpiresAt,
    pendingReviewByConversation,
    turns,
    liveUsage: omitLiveUsage(state.liveUsage, id),
    errorBanner: clearBanner ? null : state.errorBanner,
    errorBannerKind: clearBanner ? null : state.errorBannerKind,
    errorBannerDetail: clearBanner ? null : state.errorBannerDetail
  }
}
