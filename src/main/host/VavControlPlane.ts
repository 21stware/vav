/**
 * Headless VAV host: stores + AgentRuntime + RemoteControlHub.
 *
 * Desktop already wires this graph inside Electron. `vavd` uses the same
 * objects so phone / web / extension / desktop-connect are isomorphic
 * control clients — turns run here, not in the shell.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir, hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveVavCredentials } from '../accounts/vavCredentials.ts'
import { AgentRuntime } from '../agent/AgentRuntime.ts'
import { ChangeSetStore } from '../agent/ChangeSetStore.ts'
import { FileService } from '../fs/FileService.ts'
import { currentLocale, t } from '../i18n.ts'
import { RemoteControlHub } from '../remote/RemoteControlHub.ts'
import { fanRemoteTurn } from '../remote/fanTurn.ts'
import { RemoteSendQueue } from '../remote/sendQueue.ts'
import {
  buildRemoteHostEvent,
  remoteCatalogModelRows,
  remoteDefaultApproval,
  remoteHostRecentDirs,
  remoteLiveConversation,
  remoteSendDisposition
} from '../remote/sessionGate.ts'
import { buildRemoteThreadEvent, fallbackRemoteSession, mapRemoteSessions } from '../remote/sessionList.ts'
import { AccountStore } from '../store/AccountStore.ts'
import { ConversationStore } from '../store/ConversationStore.ts'
import { NodeSecretStore } from '../store/NodeSecretStore.ts'
import { SettingsStore } from '../store/SettingsStore.ts'
import { trayDirLabel } from '../tray/trayLabels.ts'
import { LOCAL_MACHINE_ID, conversationOnMachine, parseWorkspaceRefList, recentsForMachine } from '@shared/workspaceHost'
import {
  parseAgentId,
  parseApprovalMode,
  buildRemoteControls
} from '@shared/remoteSessionControls.ts'
import { parseThinkingLevel } from '@shared/thinkingLevel.ts'
import { VAV_DEFAULT_MODEL_ID, type Conversation, type TurnEvent } from '@shared/types'
import { remoteBrowseRoots, remoteIsTemporary, remoteParentPath, remotePathAllowed } from '@shared/remoteWorkspace.ts'
import { listRemoteChildEntries, listRemoteRootEntries } from '../remote/dirBrowse.ts'
import type { DaemonWorkspaceCatalog } from '../daemon/DaemonServer.ts'
import type { WorkspaceHost } from './WorkspaceHost.ts'
import { HostRegistry } from './WorkspaceHost.ts'
import type { RemoteConfigure, RemoteControlsEvent, RemoteDirsEvent, RemoteHostEvent, RemoteSession } from '@shared/remoteControl.ts'

export type VavControlPlaneOpts = {
  stateDir: string
  host: WorkspaceHost
  secret: () => string
  appVersion: string
  home?: string
  tmp?: string
  extraAuth?: (auth: string) => boolean
}

export type VavControlPlane = {
  hub: RemoteControlHub
  agent: AgentRuntime
  conversations: ConversationStore
  settings: SettingsStore
  secrets: NodeSecretStore
  files: FileService
  catalog: DaemonWorkspaceCatalog
  load(): void
  dispose(): void
}

function mintTempWorkdir(tmp: string): string {
  const dir = join(tmp, 'vav', randomUUID().slice(0, 8), 'Workspace')
  try {
    mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return tmp
  }
}

export function createVavControlPlane(opts: VavControlPlaneOpts): VavControlPlane {
  const home = opts.home ?? homedir()
  const tmp = opts.tmp ?? tmpdir()
  const dirLabel = (workingDirectory: string | null | undefined): string =>
    trayDirLabel(workingDirectory, home)

  const settings = new SettingsStore(opts.stateDir)
  const secrets = new NodeSecretStore(opts.stateDir)
  const accounts = new AccountStore(opts.stateDir)
  const conversations = new ConversationStore(opts.stateDir)
  const changeSets = new ChangeSetStore()
  const hosts = new HostRegistry(opts.host)
  const files = new FileService(() => {
    /* watch coalescing is desktop UI; tools still write through FileService */
  }, opts.host.fs)

  const remoteSessionStatus = new Map<string, 'running' | 'done'>()
  const pendingSends = new RemoteSendQueue()
  let hub: RemoteControlHub

  const handleAgentEvent = (event: TurnEvent): void => {
    if (event.type === 'start') remoteSessionStatus.set(event.conversationId, 'running')
    if (event.type === 'end') remoteSessionStatus.set(event.conversationId, 'done')
    fanRemoteTurn(event, hub, currentLocale())
    if (event.type === 'end') flushSends()
  }

  const resolveCreds = (conversation?: Conversation | null) =>
    resolveVavCredentials(
      { conversation, settingsEndpoint: settings.get().apiEndpoint },
      accounts,
      secrets.asSecretStore()
    )

  const agent = new AgentRuntime({
    conversations,
    settings,
    secrets: secrets.asSecretStore(),
    resolveVavCredentials: (conversation) => resolveCreds(conversation),
    files,
    hosts,
    changeSets,
    emit: handleAgentEvent
  })

  function listSessions(): RemoteSession[] {
    const favorites = new Set(settings.get().favoriteConversationIds ?? [])
    return mapRemoteSessions(
      conversations.all().filter((c) => conversationOnMachine(c, LOCAL_MACHINE_ID)),
      {
        fallbackTitle: t('window.sessionFallback'),
        tmpdir: tmp,
        dirLabel,
        statusOf: (id, resultUnseen) => remoteSessionStatus.get(id) ?? (resultUnseen ? 'done' : 'idle'),
        surfaceOf: () => 'vav',
        favoriteOf: (id) => favorites.has(id)
      }
    )
  }

  function createSession(): RemoteSession {
    const snap = settings.get()
    const configured = snap.defaultWorkingDirectory?.trim()
    const workdir = configured || mintTempWorkdir(tmp)
    if (workdir) settings.rememberWorkspaceDirectory(workdir, tmp)
    const conversation = conversations.create(workdir, snap.defaultModel || VAV_DEFAULT_MODEL_ID, {
      approvalMode: snap.defaultApprovalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(snap.defaultThinkingLevel),
      machineId: LOCAL_MACHINE_ID
    })
    files.watchRoot(conversation.id, workdir)
    hub.schedulePushSessions()
    return (
      listSessions().find((session) => session.id === conversation.id) ??
      fallbackRemoteSession(conversation, {
        fallbackTitle: t('window.sessionFallback'),
        dirLabel: dirLabel(conversation.workingDirectory),
        surface: 'vav'
      })
    )
  }

  function listThread(conversationId: string) {
    return buildRemoteThreadEvent(conversationId, conversations.get(conversationId), currentLocale())
  }

  function listControls(conversationId: string): RemoteControlsEvent | null {
    const conversation = conversations.get(conversationId)
    if (!conversation || conversation.archived) return null
    const snap = settings.get()
    const models = remoteCatalogModelRows({
      host: null,
      accountId: conversation.accountId,
      apiEndpoint: snap.apiEndpoint,
      customModels: snap.customModels,
      defaultModel: snap.defaultModel,
      disabledAgentModels: snap.disabledAgentModels,
      snapshot: {}
    })
    return buildRemoteControls({
      conversationId,
      cliHost: null,
      model: conversation.model,
      thinkingLevel: conversation.thinkingLevel,
      approvalMode: conversation.approvalMode,
      acpSession: conversation.acpSession,
      hasMessages: conversation.messages.length > 0,
      agents: [{ id: 'vav', label: 'VAV' }],
      models,
      workingDirectory: conversation.workingDirectory,
      dirLabel: dirLabel(conversation.workingDirectory),
      temporary: remoteIsTemporary(conversation.workingDirectory, tmp),
      fast: conversation.fast === true
    })
  }

  function listHost(): RemoteHostEvent {
    const snap = settings.get()
    const localRecents = recentsForMachine(
      parseWorkspaceRefList(snap.recentWorkspaceDirectories),
      LOCAL_MACHINE_ID
    ).map((ref) => ref.path)
    return buildRemoteHostEvent({
      name: opts.host.info.name || hostname(),
      home,
      tmp,
      platform: process.platform,
      defaultAgent: 'vav',
      defaultModel: snap.defaultModel ?? '',
      thinking: parseThinkingLevel(snap.defaultThinkingLevel),
      approval: remoteDefaultApproval(snap.defaultApprovalMode),
      recentDirs: remoteHostRecentDirs(snap.pinnedWorkspaceDirectories ?? [], localRecents, {
        exists: existsSync,
        label: dirLabel,
        cap: 12
      })
    })
  }

  function configure(message: RemoteConfigure) {
    const conversation = conversations.get(message.conversationId)
    if (!conversation) return 'not-found' as const
    if (conversation.archived) return 'archived' as const
    const id = message.conversationId
    if (message.agent !== undefined) {
      const parsed = parseAgentId(message.agent)
      if (!parsed) return 'not-found' as const
      if (parsed !== 'vav') return 'locked' as const
    }
    if (message.model !== undefined) {
      conversations.updateMeta(id, { model: message.model })
    }
    if (message.thinkingLevel !== undefined) {
      conversations.setThinkingLevel(id, parseThinkingLevel(message.thinkingLevel))
    }
    if (message.approvalMode !== undefined) {
      const mode = parseApprovalMode(message.approvalMode)
      if (mode) conversations.setApprovalMode(id, mode)
    }
    if (message.fast !== undefined) {
      conversations.setFast(id, message.fast === true)
    }
    const controls = listControls(id)
    if (controls) hub.pushControls(controls)
    hub.schedulePushSessions()
    return 'ok' as const
  }

  function busy(conversationId: string): boolean {
    return agent.isRunning(conversationId)
  }

  function startTurn(conversationId: string, text: string, attachments: string[]): void {
    void agent.run(conversationId, text, attachments, null, null, null)
  }

  function flushSends(): void {
    for (const next of pendingSends.takeReady(busy)) {
      startTurn(next.conversationId, next.text, next.attachments)
    }
  }

  function sendMessage(conversationId: string, text: string, attachments: string[] = []) {
    const conversation = conversations.get(conversationId)
    const disposition = remoteSendDisposition(conversation, conversation ? busy(conversationId) : false)
    if (disposition === 'not-found' || disposition === 'archived') return disposition
    if (disposition === 'enqueue') {
      pendingSends.enqueue(conversationId, text, attachments)
      return 'ok' as const
    }
    startTurn(conversationId, text, attachments)
    return 'ok' as const
  }

  function cancel(conversationId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    pendingSends.clear(conversationId)
    agent.cancel(conversationId)
    return 'ok' as const
  }

  function reply(conversationId: string, toolCallId: string, answer: string): boolean {
    return agent.answer(conversationId, toolCallId, answer)
  }

  function rename(conversationId: string, title: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    conversations.updateMeta(conversationId, { title: title.trim() || t('common.untitledSession') })
    hub.schedulePushSessions()
    return 'ok' as const
  }

  function archive(conversationId: string) {
    const conversation = conversations.get(conversationId)
    if (!conversation) return 'not-found' as const
    agent.cancel(conversationId)
    conversations.setArchived(conversationId, true)
    hub.schedulePushSessions()
    return 'ok' as const
  }

  function pin(conversationId: string, pinned: boolean) {
    const conversation = conversations.get(conversationId)
    if (!conversation) return 'not-found' as const
    if (conversation.archived) return 'archived' as const
    conversations.setPinned(conversationId, pinned)
    hub.schedulePushSessions()
    return 'ok' as const
  }

  function favorite(conversationId: string, next: boolean) {
    const conversation = conversations.get(conversationId)
    if (!conversation) return 'not-found' as const
    if (conversation.archived) return 'archived' as const
    const current = settings.get().favoriteConversationIds ?? []
    const has = current.includes(conversationId)
    if (next && !has) {
      settings.update({ favoriteConversationIds: [conversationId, ...current] })
    } else if (!next && has) {
      settings.update({ favoriteConversationIds: current.filter((id) => id !== conversationId) })
    }
    hub.schedulePushSessions()
    return 'ok' as const
  }

  function rootsFor(conversationId: string): string[] | null {
    const conversation = conversations.get(conversationId)
    if (!conversation || conversation.archived) return null
    const snap = settings.get()
    return remoteBrowseRoots({
      home,
      tmp,
      current: conversation.workingDirectory,
      recent: [
        ...(snap.pinnedWorkspaceDirectories ?? []),
        ...recentsForMachine(parseWorkspaceRefList(snap.recentWorkspaceDirectories), LOCAL_MACHINE_ID).map(
          (ref) => ref.path
        )
      ]
    })
  }

  function browse(conversationId: string, path?: string): RemoteDirsEvent | 'not-found' | 'forbidden' {
    const roots = rootsFor(conversationId)
    if (!roots) return 'not-found'
    if (!path) {
      return {
        type: 'dirs',
        conversationId,
        path: '',
        parent: null,
        entries: listRemoteRootEntries(roots, { exists: existsSync, label: dirLabel })
      }
    }
    const entries = listRemoteChildEntries(path, roots, {
      readdir: (dir) => readdirSync(dir, { withFileTypes: true }),
      join
    })
    if (entries === 'forbidden') return 'forbidden'
    return {
      type: 'dirs',
      conversationId,
      path,
      parent: remoteParentPath(path, roots),
      entries
    }
  }

  function setWorkspace(conversationId: string, path: string | null) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    const next = path || mintTempWorkdir(tmp)
    if (path) {
      const roots = rootsFor(conversationId)
      if (!roots || !remotePathAllowed(path, roots) || !existsSync(path)) return 'forbidden'
    }
    conversations.updateMeta(conversationId, { workingDirectory: next })
    agent.setWorkingDirectory(conversationId, next)
    files.watchRoot(conversationId, next)
    if (next) settings.rememberWorkspaceDirectory(next, tmp)
    const controls = listControls(conversationId)
    if (controls) hub.pushControls(controls)
    hub.schedulePushSessions()
    return 'ok' as const
  }

  hub = new RemoteControlHub({
    appVersion: opts.appVersion,
    listSessions,
    listThread,
    listControls,
    listHost,
    configure,
    sendMessage,
    createSession,
    cancel,
    reply,
    rename,
    archive,
    pin,
    favorite,
    browse,
    setWorkspace,
    secret: opts.secret,
    acceptAuth: opts.extraAuth
  })

  const catalog: DaemonWorkspaceCatalog = {
    listSessions: () => conversations.listMeta().filter((row) => !row.archived),
    getSession: (id) => conversations.get(id),
    listRecents: () =>
      recentsForMachine(parseWorkspaceRefList(settings.get().recentWorkspaceDirectories), LOCAL_MACHINE_ID).map(
        (ref) => ref.path
      )
  }

  return {
    hub,
    agent,
    conversations,
    settings,
    secrets,
    files,
    catalog,
    load() {
      mkdirSync(opts.stateDir, { recursive: true })
      settings.load()
      secrets.load()
      accounts.load()
      conversations.load({
        model: settings.get().defaultModel || VAV_DEFAULT_MODEL_ID,
        mintWorkdir: () => mintTempWorkdir(tmp)
      })
      const envKey = process.env.VAV_API_KEY?.trim()
      if (envKey) secrets.set(envKey, 'api')
      const envEndpoint = process.env.VAV_API_ENDPOINT?.trim()
      if (envEndpoint) settings.update({ apiEndpoint: envEndpoint })
    },
    dispose() {
      agent.disposeAll()
      files.disposeAll()
      hub.dispose()
    }
  }
}
