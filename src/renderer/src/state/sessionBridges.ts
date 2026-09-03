import { resolveLocale } from '@shared/i18n'
import { compactionForLeaf } from '@shared/compaction'
import { conversationOnMachine, normalizeMachineId } from '@shared/workspaceHost'
import { mergeConversationList } from './sessionListMerge'
import { omitLiveUsage } from './sessionUsage'
import { useSessionStore } from './sessionStore'
import { useWorkspaceStore } from './workspaceStore'

const noopOff = (): (() => void) => () => undefined

/** Wires main-process turn events into the store. Called once at startup. */
export function installTurnEventBridge(): () => void {
  const onEvent = window.vav?.agent?.onEvent
  if (!onEvent) return noopOff()
  return onEvent((event) => useSessionStore.getState().applyTurnEvent(event))
}

export function installHostsBridge(): () => void {
  const onChanged = window.vav?.hosts?.onChanged
  if (!onChanged) return noopOff()
  const offChanged = onChanged((hosts) => {
    const prev = useSessionStore.getState().hosts
    const machineId = useSessionStore.getState().windowMachineId
    const host = hosts.find((h) => h.id === machineId)
    const wasOnline = prev.find((h) => h.id === machineId)?.online === true
    const nowOnline = host?.online === true
    const next: Partial<ReturnType<typeof useSessionStore.getState>> = { hosts }
    if (host?.home) next.home = host.home
    if (host?.tmp) next.tmp = host.tmp
    useSessionStore.setState(next)
    if (nowOnline && !wasOnline) {
      const activeId = useSessionStore.getState().activeId
      const workspace = useWorkspaceStore.getState()
      const convos = useSessionStore
        .getState()
        .conversations.filter((c) => conversationOnMachine(c, machineId) && c.workingDirectory)
      for (const conversation of convos) {
        const root = conversation.workingDirectory
        if (!root) continue
        if (workspace.workspaces[conversation.id]) {
          void workspace.loadDirectory(conversation.id, root, { quiet: true })
        } else if (conversation.id === activeId) {
          void workspace.bindConversation(conversation.id, root)
        }
      }
    }
  })
  const offIncoming = window.vav.hosts.onIncomingChanged
    ? window.vav.hosts.onIncomingChanged((incomingControllers) => {
        useSessionStore.setState({ incomingControllers })
      })
    : noopOff()
  void window.vav.hosts.incoming?.().then((incomingControllers) => {
    useSessionStore.setState({ incomingControllers })
  }).catch(() => {})
  const offPick = window.vav.hosts.onPickFolder
    ? window.vav.hosts.onPickFolder((machineId) => {
        const state = useSessionStore.getState()
        if (normalizeMachineId(state.windowMachineId) !== normalizeMachineId(machineId)) return
        const active = state.conversations.find((c) => c.id === state.activeId)
        const conversationId =
          active && conversationOnMachine(active, machineId) ? active.id : ''
        state.openRemoteFolderPicker(conversationId, machineId)
      })
    : noopOff()
  return () => {
    offChanged()
    offIncoming()
    offPick()
  }
}

/** Mirrors the phone-companion tunnel status (connected devices) into the store. */
export function installRemoteControlBridge(): () => void {
  const api = window.vav?.remoteControl
  if (!api) return noopOff()
  void api
    .status()
    .then((status) => useSessionStore.setState({ remoteControlStatus: status }))
    .catch(() => {})
  return api.onChanged((status) => useSessionStore.setState({ remoteControlStatus: status }))
}

/** Keeps every window's copy of the settings in step. Called once per window. */
export function installSettingsBridge(): () => void {
  const onChanged = window.vav?.onSettingsChanged
  if (!onChanged) return noopOff()
  return onChanged((settings) =>
    useSessionStore.setState({
      settings,
      resolvedLocale: resolveLocale(settings.locale, navigator.language)
    })
  )
}

/** Compact from the token-usage popup (or another window) lands here. */
export function installCompactionsBridge(): () => void {
  const onChanged = window.vav?.agent?.onCompactionsChanged
  if (!onChanged) return noopOff()
  return onChanged(({ conversationId, compactions }) => {
    const active = compactionForLeaf(
      compactions,
      useSessionStore.getState().messages[conversationId] ?? [],
      useSessionStore.getState().activeLeaf[conversationId] ?? null
    )
    useSessionStore.setState((state) => ({
      compactions: { ...state.compactions, [conversationId]: compactions },
      liveUsage: omitLiveUsage(state.liveUsage, conversationId),
      conversations: state.conversations.map((c) => {
        if (c.id !== conversationId) return c
        if (active?.estimatedContextTokens) {
          return { ...c, tokensUsed: active.estimatedContextTokens }
        }
        const latest = state.tokenHistories[conversationId]?.at(-1)?.totalInputTokens
        if (latest && latest > 0) return { ...c, tokensUsed: latest }
        return c
      })
    }))
  })
}

/**
 * Keeps every window's conversation list in step.
 *
 * The same conversation can be renamed, pinned or created from another window,
 * so no window may treat its own copy of the list as authoritative.
 */
export function installWindowBridge(): () => void {
  const onChanged = window.vav?.conversations?.onChanged
  if (!onChanged) return noopOff()
  return onChanged((list) => {
    useSessionStore.setState((state) => ({
      conversations: mergeConversationList(state.conversations, list)
    }))
  })
}

export function installActivityBridge(): () => void {
  const onActivity = window.vav?.conversations?.onActivity
  if (!onActivity) return noopOff()
  return onActivity((rows) => {
    const activityById: Record<string, 'running' | 'done'> = {}
    for (const row of rows) activityById[row.conversationId] = row.status
    useSessionStore.setState({ activityById })
  })
}

/**
 * Tracks which conversations have a companion window so the main shell can
 * release its live agent terminal (one PTY → one geometry).
 */
export function installDetachedBridge(): () => void {
  const api = window.vav?.window
  if (!api) return noopOff()
  const apply = (ids: string[]): void => {
    const previous = useSessionStore.getState().detachedConversationIds
    useSessionStore.setState({ detachedConversationIds: ids })
    const next = new Set(ids)
    for (const id of previous) {
      if (next.has(id)) continue
      if (!useWorkspaceStore.getState().workspaces[id]) continue
      void useWorkspaceStore.getState().hydratePtyState(id, { acceptRemoteSurface: true })
    }
  }
  if (typeof api.listDetachedSessions === 'function') {
    void api.listDetachedSessions().then(apply).catch(() => apply([]))
  }
  if (typeof api.onDetachedChanged !== 'function') {
    return noopOff()
  }
  return api.onDetachedChanged(apply)
}

/** Keeps the composer agent/model picker in sync with background CLI probes. */
export function installAgentModelCatalogBridge(): () => void {
  const onChanged = window.vav?.agents?.onModelCatalogChanged
  if (!onChanged) return noopOff()
  return onChanged((catalog) => {
    useSessionStore.getState().setAgentModelCatalog(catalog)
  })
}

/** Keeps toolbar / About update UI in step with the main-process checker. */
export function installUpdateBridge(): () => void {
  const onChanged = window.vav?.updates?.onChanged
  if (!onChanged) return noopOff()
  return onChanged((updateState) => {
    useSessionStore.setState({ updateState })
  })
}
