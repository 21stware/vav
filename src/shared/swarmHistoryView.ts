import { isStructuredCliHost, type ProviderResumeCursor } from './cliHost'
import { canApplyResumeArgs, nativeSessionId } from './cliPaneBinding'
import {
  groupSwarmHistoryRows,
  mergeSwarmHistoryRows,
  shouldKeepClosedSwarmHistoryRecord,
  swarmHistoryItemLabel,
  swarmSessionDisplayTitle,
  swarmSessionKey,
  trayPaneToHistoryRow,
  type SwarmHistoryRow,
  type SwarmSessionRecord
} from './cliSessionHistory'
import type { SwarmHistoryViewPayload } from './ipc'
import type { AppLocale, Conversation, ThemeMode } from './types'

export type SwarmHistoryLivePane = {
  conversationId: string
  tabId: string
  agentId: string
  title: string
  createdAt: number
}

export function buildSwarmHistoryView(input: {
  conversationId: string
  conversations: Conversation[]
  history: { all(): SwarmSessionRecord[] }
  live: SwarmHistoryLivePane[]
  agentName: (agentId: string) => string
  dirLabel: (dir: string) => string
  untitled: string
  theme: ThemeMode
  locale: AppLocale
  hasConversation?: (agentId: string, sessionId: string, cwd: string) => boolean
}): SwarmHistoryViewPayload {
  const convById = new Map(input.conversations.map((row) => [row.id, row]))
  const opener = convById.get(input.conversationId)
  const records = input.history
    .all()
    .filter((row) => row.conversationId === input.conversationId)
  const recordByKey = new Map(records.map((row) => [row.key, row]))

  const liveRows: SwarmHistoryRow[] = []
  const liveTabIds = new Set<string>()
  for (const pane of input.live) {
    if (pane.conversationId !== input.conversationId || !pane.agentId) continue
    liveTabIds.add(pane.tabId)
    const conversation = convById.get(pane.conversationId)
    const binding = conversation?.cliPaneBindings?.[pane.tabId]
    const sessionId = nativeSessionId(binding?.cursor)
    const record = sessionId ? recordByKey.get(swarmSessionKey(pane.agentId, sessionId)) : undefined
    const title = swarmSessionDisplayTitle({
      name: record?.name,
      title:
        binding?.title ||
        (conversation?.title && conversation.title.trim()) ||
        pane.title ||
        null,
      fallback: input.untitled
    })
    liveRows.push(
      trayPaneToHistoryRow(
        {
          conversationId: pane.conversationId,
          tabId: pane.tabId,
          kind: 'agent',
          sessionTitle: title,
          paneTitle: input.agentName(pane.agentId),
          dirKey: conversation?.workingDirectory || '~',
          dirLabel: input.dirLabel(conversation?.workingDirectory || '~'),
          createdAt: pane.createdAt,
          agentId: pane.agentId
        },
        {
          title,
          resumable: canApplyResumeArgs(pane.agentId) && !!sessionId,
          cursor: binding?.cursor ?? record?.cursor ?? null,
          sessionId,
          updatedAt: binding?.updatedAt ?? record?.updatedAt ?? pane.createdAt
        }
      )
    )
  }

  const extras: SwarmHistoryRow[] = []
  for (const record of records) {
    if (!keepClosed(record, input.hasConversation)) continue
    extras.push(recordToRow(record, input.agentName, input.dirLabel, input.untitled))
  }

  for (const [tabId, binding] of Object.entries(opener?.cliPaneBindings ?? {})) {
    if (liveTabIds.has(tabId) || !isStructuredCliHost(binding.agentId)) continue
    const sessionId = nativeSessionId(binding.cursor)
    if (!sessionId) continue
    const key = swarmSessionKey(binding.agentId, sessionId)
    if (recordByKey.has(key)) continue
    if (
      !keepClosed(
        {
          name: null,
          title: binding.title ?? null,
          agentId: binding.agentId,
          cursor: binding.cursor,
          workingDirectory: opener?.workingDirectory || '~'
        },
        input.hasConversation
      )
    ) {
      continue
    }
    extras.push(
      recordToRow(
        {
          key,
          agentId: binding.agentId,
          cursor: binding.cursor,
          name: null,
          title: binding.title ?? null,
          conversationId: input.conversationId,
          workingDirectory: opener?.workingDirectory || '~',
          createdAt: binding.updatedAt,
          updatedAt: binding.updatedAt
        },
        input.agentName,
        input.dirLabel,
        input.untitled
      )
    )
  }

  const rows = mergeSwarmHistoryRows(liveRows, extras)
  const groups = groupSwarmHistoryRows(rows).map((group) => ({
    dirKey: group.dirKey,
    dirLabel: group.dirLabel,
    items: group.items.map((item) => ({
      id: item.id,
      conversationId: item.conversationId,
      tabId: item.tabId,
      agentId: item.agentId,
      agentName: item.agentName,
      title: item.title,
      label: swarmHistoryItemLabel(item),
      dirKey: item.dirKey,
      dirLabel: item.dirLabel,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      live: item.live,
      resumable: item.resumable,
      cursor: item.cursor
    }))
  }))

  return {
    conversationId: input.conversationId,
    theme: input.theme,
    locale: input.locale,
    groups
  }
}

function keepClosed(
  record: {
    name?: string | null
    title?: string | null
    agentId: string
    cursor: ProviderResumeCursor
    workingDirectory?: string
  },
  hasConversation?: (agentId: string, sessionId: string, cwd: string) => boolean
): boolean {
  const sessionId = nativeSessionId(record.cursor)
  return shouldKeepClosedSwarmHistoryRecord({
    name: record.name,
    title: record.title,
    hasConversation:
      !!hasConversation &&
      !!sessionId &&
      hasConversation(record.agentId, sessionId, record.workingDirectory || '~')
  })
}

function recordToRow(
  record: {
    key: string
    agentId: string
    cursor: ProviderResumeCursor
    name: string | null
    title: string | null
    conversationId: string
    workingDirectory: string
    createdAt: number
    updatedAt: number
  },
  agentName: (id: string) => string,
  dirLabel: (dir: string) => string,
  untitled: string
): SwarmHistoryRow {
  return {
    id: record.key,
    conversationId: record.conversationId,
    tabId: null,
    agentId: record.agentId,
    agentName: agentName(record.agentId),
    title: swarmSessionDisplayTitle({
      name: record.name,
      title: record.title,
      fallback: untitled
    }),
    dirKey: record.workingDirectory || '~',
    dirLabel: dirLabel(record.workingDirectory || '~'),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    live: false,
    resumable: canApplyResumeArgs(record.agentId) && !!nativeSessionId(record.cursor),
    cursor: record.cursor
  }
}
