import type { Bootstrap, NativeMenuItem, VavApi } from '@shared/ipc'
import type {
  RemoteControlsEvent,
  RemoteHostEvent,
  RemoteSession,
  RemoteThreadMessage,
  RemoteTurnEvent
} from '@shared/remoteControl'
import {
  asApprovalMode,
  chatMessagesFromRemoteThread,
  conversationFromRemoteSession,
  conversationFromRemoteThread,
  favoriteIdsFromRemoteSessions,
  turnEventsFromRemoteTurn,
  userTurnEvent
} from '@shared/remoteDesktop'
import { DEFAULT_SETTINGS, type ConversationMeta, type TurnEvent, type TurnStatus } from '@shared/types'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost'
import { showDomMenu } from '../renderer/src/lib/domMenu'
import { composeSendText } from './pageContext'
import type { PhoneLine, PhoneTransport } from './phoneTransport'

type ListHandler = (conversations: ConversationMeta[]) => void
type TurnHandler = (event: TurnEvent) => void

const IDLE_STATUS = (conversationId: string): TurnStatus => ({
  conversationId,
  isRunning: false,
  phase: 'idle',
  toolCount: 0,
  awaitingToolCallId: null,
  messageId: null,
  blocks: []
})

function waitFor<T>(
  take: (resolve: (value: T) => void) => void,
  timeoutMs = 8_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('phone rpc timeout')), timeoutMs)
    take((value) => {
      window.clearTimeout(timer)
      resolve(value)
    })
  })
}

export type PhoneVavHandle = {
  api: VavApi
  transport: PhoneTransport
}

export function installPhoneVav(transport: PhoneTransport): PhoneVavHandle {
  const sessions: RemoteSession[] = []
  const threads: Record<string, RemoteThreadMessage[]> = {}
  const controls: Record<string, RemoteControlsEvent> = {}
  let host: RemoteHostEvent | null = null
  let settings = {
    ...DEFAULT_SETTINGS,
    apiKeyPresent: true
  }
  const listHandlers = new Set<ListHandler>()
  const turnHandlers = new Set<TurnHandler>()
  const threadWaiters = new Map<string, Array<(rows: RemoteThreadMessage[]) => void>>()
  const createdWaiters: Array<(session: RemoteSession) => void> = []
  let bootResolve: (() => void) | null = null
  const booted = new Promise<void>((resolve) => {
    bootResolve = resolve
  })
  let sawSessions = false

  const emitTurns = (events: TurnEvent[]): void => {
    for (const event of events) {
      for (const handler of turnHandlers) handler(event)
    }
  }

  const mappedList = (): ConversationMeta[] =>
    sessions.map((session) => conversationFromRemoteSession(session, controls[session.id], host))

  const emitList = (): void => {
    const list = mappedList()
    for (const handler of listHandlers) handler(list)
  }

  const applyLine = (msg: PhoneLine): void => {
    if (msg.type === 'host') {
      host = msg as unknown as RemoteHostEvent
      return
    }
    if (msg.type === 'sessions') {
      const next = Array.isArray(msg.sessions) ? (msg.sessions as RemoteSession[]) : []
      sessions.splice(0, sessions.length, ...next)
      settings = {
        ...settings,
        favoriteConversationIds: favoriteIdsFromRemoteSessions(sessions)
      }
      sawSessions = true
      emitList()
      bootResolve?.()
      return
    }
    if (msg.type === 'created' && msg.session) {
      const session = msg.session as RemoteSession
      const idx = sessions.findIndex((row) => row.id === session.id)
      if (idx >= 0) sessions[idx] = session
      else sessions.unshift(session)
      emitList()
      const waiter = createdWaiters.shift()
      waiter?.(session)
      return
    }
    if (msg.type === 'thread' && typeof msg.conversationId === 'string') {
      const id = msg.conversationId
      const messages = Array.isArray(msg.messages) ? (msg.messages as RemoteThreadMessage[]) : []
      threads[id] = messages
      const waiters = threadWaiters.get(id) ?? []
      threadWaiters.delete(id)
      for (const waiter of waiters) waiter(messages)
      const path = chatMessagesFromRemoteThread(messages)
      void import('../renderer/src/state/sessionStore').then(({ useSessionStore }) => {
        useSessionStore.setState((state) => ({
          messages: { ...state.messages, [id]: path },
          messagesHydrated: { ...state.messagesHydrated, [id]: true },
          activeLeaf: { ...state.activeLeaf, [id]: path.at(-1)?.id ?? null }
        }))
      })
      return
    }
    if (msg.type === 'controls' && typeof msg.conversationId === 'string') {
      controls[msg.conversationId] = msg as unknown as RemoteControlsEvent
      emitList()
      return
    }
    if (msg.type === 'turn' && typeof msg.conversationId === 'string') {
      const event = msg as unknown as RemoteTurnEvent
      emitTurns(turnEventsFromRemoteTurn(event))
      if (event.phase === 'done' || event.phase === 'error' || event.phase === 'cancelled') {
        transport.send({ type: 'thread', conversationId: event.conversationId })
      }
    }
  }

  transport.onLine(applyLine)

  const send = (msg: Record<string, unknown>): void => transport.send(msg)

  const conversationsOf = (): ConversationMeta[] => mappedList()

  const configure = async (
    id: string,
    patch: Record<string, unknown>
  ): Promise<ConversationMeta[]> => {
    const prev = controls[id]
    if (prev) {
      controls[id] = {
        ...prev,
        ...(typeof patch.model === 'string' ? { model: patch.model } : {}),
        ...(typeof patch.approvalMode === 'string'
          ? { approval: asApprovalMode(patch.approvalMode) }
          : {}),
        ...(typeof patch.thinkingLevel === 'string' ? { thinking: patch.thinkingLevel } : {}),
        ...(typeof patch.fast === 'boolean' ? { fast: patch.fast } : {}),
        ...(typeof patch.agent === 'string' ? { agent: patch.agent } : {}),
        ...(typeof patch.mode === 'string' ? { mode: patch.mode } : {})
      }
    } else if (typeof patch.model === 'string' || typeof patch.approvalMode === 'string') {
      controls[id] = {
        type: 'controls',
        conversationId: id,
        agentLocked: false,
        agent: 'vav',
        agents: [{ id: 'vav', label: 'VAV' }],
        model: typeof patch.model === 'string' ? patch.model : '',
        models: [],
        thinking: typeof patch.thinkingLevel === 'string' ? patch.thinkingLevel : null,
        thinkingLevels: [],
        mode: typeof patch.mode === 'string' ? patch.mode : null,
        modes: [],
        approval: asApprovalMode(patch.approvalMode),
        approvals: [],
        fast: typeof patch.fast === 'boolean' ? patch.fast : null,
        workingDirectory: '',
        dirLabel: '',
        temporary: false
      }
    }
    send({ type: 'configure', conversationId: id, ...patch })
    emitList()
    return conversationsOf()
  }

  const api = {
    platform: 'linux',
    async bootstrap(): Promise<Bootstrap> {
      await Promise.race([booted, new Promise((resolve) => setTimeout(resolve, 4_000))])
      const list = mappedList()
      return {
        settings: {
          ...settings,
          favoriteConversationIds: favoriteIdsFromRemoteSessions(sessions)
        },
        resolvedLocale: navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en',
        systemAccentColor: '#007aff',
        conversations: list,
        activeConversationId: list[0]?.id ?? '',
        apiKeyHint: null,
        platform: 'linux',
        home: host?.home || '',
        tmp: host?.tmp || '',
        about: {
          version: '1.19.0',
          buildNumber: '1.19.0',
          electron: '',
          userDataPath: '',
          conversationsPath: ''
        },
        hosts: [
          {
            id: LOCAL_MACHINE_ID,
            name: host?.name || 'VAV',
            kind: 'local',
            online: true,
            home: host?.home,
            tmp: host?.tmp,
            controlPlane: true,
            platform: host?.platform
          }
        ]
      }
    },
    secrets: {
      status: async () => ({
        unlocked: true,
        needsUnlock: false,
        encryptionAvailable: false,
        hasKeyFile: false,
        onboardingComplete: true
      }),
      unlock: async () => ({ ok: true as const })
    },
    settings: {
      get: async () => settings,
      update: async (patch: Partial<typeof settings>) => {
        const prevFav = new Set(settings.favoriteConversationIds ?? [])
        settings = { ...settings, ...patch }
        const nextFav = new Set(settings.favoriteConversationIds ?? [])
        for (const id of nextFav) {
          if (!prevFav.has(id)) send({ type: 'favorite', conversationId: id, favorite: true })
        }
        for (const id of prevFav) {
          if (!nextFav.has(id)) send({ type: 'favorite', conversationId: id, favorite: false })
        }
        return settings
      },
      reset: async () => settings,
      setApiKey: async () => ({ hint: null }),
      revealApiKey: async () => null,
      apiKeyHint: async () => null,
      setBraveSearchKey: async () => ({ hint: null }),
      braveSearchKeyHint: async () => null,
      setTinyfishSearchKey: async () => ({ hint: null }),
      tinyfishSearchKeyHint: async () => null,
      setCloudflareApiToken: async () => ({ hint: null }),
      cloudflareApiTokenHint: async () => null,
      setSupabaseAccessToken: async () => ({ hint: null }),
      supabaseAccessTokenHint: async () => null,
      validateKey: async () => ({ ok: true }),
      availableFonts: async () => [],
      pickDirectory: async () => null,
      pickColor: async () => null,
      pickSurfacePatternImage: async () => null,
      setHotkey: async () => ({ ok: true, settings }),
      cliStatus: async () => ({}),
      cliSetLocation: async () => ({}),
      cliInstall: async () => ({}),
      cliUninstall: async () => ({}),
      fileAssociations: async () => [],
      fileAssociationForPath: async () => null,
      setFileAssociation: async () => ({}),
      unsetFileAssociation: async () => ({}),
      registerAllFileAssociations: async () => ({ updated: [], failed: [] }),
      analysis: async () => ({}),
      keepAwakeStatus: async () => ({}),
      keepAwakeGrant: async () => ({}),
      keepAwakeRevoke: async () => ({})
    },
    logs: {
      query: async () => [],
      stats: async () => ({ ephemeral: 0, session: 0, durable: 0, total: 0 }),
      clear: async () => ({ removed: 0 }),
      export: async () => ({ ok: false as const, cancelled: true }),
      record: async () => {},
      onChanged: () => () => {}
    },
    accounts: {
      getPage: async () => ({ accounts: [], currentId: null }),
      createVav: async () => ({ accounts: [], currentId: null }),
      createDraft: async () => ({ page: { accounts: [], currentId: null }, id: '' }),
      updateVav: async () => ({ accounts: [], currentId: null }),
      setCurrent: async () => ({ accounts: [], currentId: null }),
      activate: async () => ({ page: { accounts: [], currentId: null }, result: { ok: true } }),
      remove: async () => ({ accounts: [], currentId: null }),
      verify: async () => ({ ok: true }),
      revealKey: async () => null,
      beginOAuth: async () => ({ accounts: [], currentId: null }),
      cancelOAuth: async () => ({ accounts: [], currentId: null }),
      signOut: async () => ({ accounts: [], currentId: null })
    },
    conversations: {
      list: async () => conversationsOf(),
      get: async (id: string) => {
        send({ type: 'thread', conversationId: id })
        send({ type: 'controls', conversationId: id })
        const messages = threads[id] ?? (await waitFor<RemoteThreadMessage[]>((resolve) => {
          const list = threadWaiters.get(id) ?? []
          list.push(resolve)
          threadWaiters.set(id, list)
        }).catch(() => threads[id] ?? []))
        const meta =
          conversationsOf().find((row) => row.id === id) ??
          conversationFromRemoteSession(
            sessions.find((row) => row.id === id) ?? {
              id,
              title: 'Session',
              dirLabel: '',
              status: 'idle',
              surface: 'vav',
              updatedAt: Date.now()
            },
            controls[id],
            host
          )
        return conversationFromRemoteThread(meta, messages)
      },
      create: async () => {
        const created = waitFor<RemoteSession>((resolve) => createdWaiters.push(resolve))
        send({ type: 'create' })
        const session = await created
        return conversationFromRemoteSession(session, controls[session.id], host)
      },
      rename: async (id: string, title: string) => {
        send({ type: 'rename', conversationId: id, title })
        return conversationsOf()
      },
      setModel: (id: string, model: string) => configure(id, { model }),
      setAgentBinaryName: async () => conversationsOf(),
      setSwarmLayout: async () => conversationsOf(),
      setCliHost: async (id: string, next: string | null) => {
        await configure(id, { agent: next || 'vav' })
        return { conversations: conversationsOf(), hostChanged: true, transcript: null }
      },
      setFocusedFile: async () => conversationsOf(),
      setWorkingDirectory: async (id: string, path: string) => {
        send({ type: 'workspace', conversationId: id, path })
        return conversationsOf()
      },
      pickWorkingDirectory: async () => null,
      useTempWorkingDirectory: async (id: string) => {
        send({ type: 'workspace', conversationId: id, temp: true })
        return conversationsOf()
      },
      locateWorkspace: async () => ({ ok: false as const, error: 'unavailable' }),
      remove: async () => ({ removed: [], conversations: conversationsOf() }),
      deleteMessage: async () => null,
      revealInFinder: async () => undefined,
      copyToClipboard: async (text: string) => {
        await navigator.clipboard?.writeText(text)
      },
      readClipboard: async () => navigator.clipboard?.readText() ?? '',
      copyImageToClipboard: async () => ({ ok: false as const, error: 'unavailable' }),
      readClipboardImage: async () => ({ ok: false as const, error: 'unavailable' }),
      selectBranch: async () => null,
      setLeaf: async () => undefined,
      setPinned: async (id: string, pinned: boolean) => {
        send({ type: 'pin', conversationId: id, pinned })
        return conversationsOf()
      },
      setArchived: async (id: string, _archived: boolean) => {
        send({ type: 'archive', conversationId: id })
        return conversationsOf()
      },
      setApprovalMode: (id: string, mode: 'auto' | 'bypass' | 'edit') =>
        configure(id, { approvalMode: mode }),
      accountQuota: async () => null,
      setThinkingLevel: (id: string, level: string) => configure(id, { thinkingLevel: level }),
      setFast: (id: string, fast: boolean) => configure(id, { fast }),
      setAcpMode: (id: string, modeId: string) => configure(id, { mode: modeId }),
      setAcpConfigOption: (id: string, _configId: string, value: string | boolean) =>
        configure(id, { mode: String(value) }),
      setAcpGoal: async () => ({ ok: false as const, error: 'unavailable', conversations: conversationsOf() }),
      continueInNewSession: async () => null,
      duplicate: async () => null,
      exportPack: async () => ({ ok: false as const, cancelled: true }),
      importPack: async () => ({ ok: false as const, cancelled: true }),
      onChanged: (handler: ListHandler) => {
        listHandlers.add(handler)
        return () => listHandlers.delete(handler)
      },
      onActivity: () => () => undefined
    },
    agent: {
      send: async (conversationId: string, text: string) => {
        let id = (conversationId || '').trim()
        if (!id) {
          const created = await api.conversations.create()
          id = created.id
        }
        const model = (document.getElementById('model') as HTMLInputElement | null)?.value.trim()
        const approval = (document.getElementById('approval') as HTMLSelectElement | null)?.value
        if (model || approval === 'auto' || approval === 'bypass' || approval === 'edit') {
          await configure(id, {
            ...(model ? { model } : {}),
            ...(approval === 'auto' || approval === 'bypass' || approval === 'edit'
              ? { approvalMode: approval }
              : {})
          })
        }
        const composed = composeSendText(text, transport.pageState())
        emitTurns([userTurnEvent(id, composed)])
        send({ type: 'send', conversationId: id, text: composed })
      },
      appendNotice: async () => undefined,
      cancel: async (conversationId: string) => {
        send({ type: 'cancel', conversationId })
      },
      answer: async (conversationId: string, toolCallId: string, answer: string) => {
        send({ type: 'reply', conversationId, toolCallId, answer })
        return true
      },
      status: async (conversationId: string) => IDLE_STATUS(conversationId),
      regenerate: async () => undefined,
      editUserMessage: async () => undefined,
      fork: async () => null,
      compact: async () => ({ ok: false as const, error: 'unavailable' }),
      clearCompaction: async () => ({ ok: false as const, error: 'unavailable' }),
      onEvent: (handler: TurnHandler) => {
        turnHandlers.add(handler)
        return () => turnHandlers.delete(handler)
      },
      onCompactionsChanged: () => () => undefined
    },
    agents: {
      getModelCatalog: async () => {
        const models = Object.values(controls)[0]?.models ?? []
        return {
          vav: {
            host: 'vav',
            models: models.map((model) => ({ id: model.id, label: model.label })),
            source: 'live' as const
          }
        }
      },
      preloadModels: async () => api.agents.getModelCatalog(),
      onModelCatalogChanged: () => () => undefined,
      listInstallRuns: async () => [],
      onInstallRunsChanged: () => () => undefined,
      resolveBinary: async () => null
    },
    updates: {
      getState: async () => ({
        phase: 'idle',
        currentVersion: '1.19.0',
        latestVersion: null,
        releaseUrl: null,
        downloadUrl: null,
        progress: 0,
        bytesPerSecond: null,
        message: null
      }),
      check: async () => undefined,
      download: async () => undefined,
      install: async () => undefined,
      onChanged: () => () => undefined
    },
    window: {
      setTheme: async () => undefined,
      getAccentColor: async () => '#007aff',
      onAccentColorChanged: () => () => undefined,
      shellPath: async () => '',
      openSettings: async () => undefined,
      closeSettings: async () => undefined,
      openConnect: async () => {
        window.dispatchEvent(new CustomEvent('vav:phone-open-connect'))
      },
      closeConnect: async () => undefined,
      fitConnect: async () => undefined,
      desiredSettingsView: async () => ({ view: 'api' }),
      openSession: async () => undefined,
      revealInList: async () => undefined,
      closeDetachedSession: async () => undefined,
      newDetachedSession: async () => undefined,
      listDetachedSessions: async () => [],
      popupMenu: (items: NativeMenuItem[], position?: { x: number; y: number }) =>
        showDomMenu(items, position),
      closePopupMenu: async () => undefined,
      openTokenUsage: async () => undefined,
      openFilePreview: async () => undefined
    },
    fileSessions: {
      open: async () => null,
      create: async () => null,
      setActive: async () => null,
      list: async () => null,
      listAll: async () => [],
      resolve: async () => null,
      setReadOnly: async () => undefined,
      onReadOnlyChanged: () => () => undefined,
      rename: async () => null,
      delete: async () => null,
      forceDelete: async () => ({ ok: true, removed: [] })
    },
    files: {
      list: async () => ({ entries: [], path: '' }),
      read: async () => ({ content: '', truncated: false }),
      readTextWindow: async () => ({ text: '', startByte: 0, endByte: 0, size: 0 }),
      readBinary: async () => ({ ok: false as const, error: 'unavailable' }),
      watch: async () => undefined,
      unwatch: async () => undefined,
      onDirty: () => () => undefined,
      quickLook: async () => undefined
    },
    pty: {
      list: async () => ({ sessions: [], layouts: { bash: null, agents: {} } }),
      create: async () => '',
      write: async () => undefined,
      kill: async () => undefined,
      resize: async () => undefined,
      setLayouts: async () => undefined,
      isBusy: async () => false,
      onData: () => () => undefined,
      onChanged: () => () => undefined,
      onStatus: () => () => undefined
    },
    hosts: {
      list: async () => [],
      onChanged: () => () => undefined,
      onIncomingChanged: () => () => undefined,
      incoming: async () => [],
      onPickFolder: () => () => undefined,
      forget: async () => undefined
    },
    onCliOpen: () => () => undefined,
    onFullscreen: () => () => undefined,
    onMenuCommand: () => () => undefined,
    onAccountsUpdated: () => () => undefined,
    onSettingsChanged: () => () => undefined,
    onSettingsAnalysis: () => () => undefined,
    dialog: {
      alert: async () => undefined,
      confirm: async () => true,
      messageBox: async () => 0
    },
    notifications: {
      seen: async () => undefined,
      permission: async () => 'granted'
    },
    changeSets: {
      get: async () => null,
      applyEdit: async () => null,
      accept: async () => null,
      reject: async () => null,
      acceptAll: async () => null,
      rejectAll: async () => null,
      undo: async () => null
    }
  } as unknown as VavApi

  const missingApi = (): object =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'string' && prop.startsWith('on')) return () => () => undefined
          return async () => undefined
        }
      }
    )

  window.vav = new Proxy(api, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => undefined
      return missingApi()
    }
  }) as VavApi
  void sawSessions
  return { api, transport }
}
