/**
 * Headless VAV host: stores + AgentRuntime + RemoteControlHub.
 *
 * Desktop already wires this graph inside Electron. `vav-server` uses the same
 * objects so phone / web / extension / desktop-connect are isomorphic
 * control clients — turns run here, not in the shell.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir, hostname, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createAccountsCatalog } from '../accounts/daemonCatalog.ts'
import { resolveVavCredentials } from '../accounts/vavCredentials.ts'
import { AgentRuntime } from '../agent/AgentRuntime.ts'
import { SkillService } from '../agent/SkillService.ts'
import { pluginHostKind } from '../../shared/plugins.ts'
import { PluginService } from '../plugins/PluginService.ts'
import { pluginAccessPaths } from '../plugins/pluginPaths.ts'
import { ChangeSetStore } from '../agent/ChangeSetStore.ts'
import { seedChangeReviewTurn } from '../agent/seedChangeReview.ts'
import { FileService } from '../fs/FileService.ts'
import { currentLocale, t } from '../i18n.ts'
import { RemoteControlHub } from '../remote/RemoteControlHub.ts'
import type { RemoteCompaction, RemoteReviewSet } from '../../shared/remoteControl.ts'
import { fanRemoteTurn } from '../remote/fanTurn.ts'
import { RemoteSendQueue } from '../remote/sendQueue.ts'
import {
  buildRemoteHostEvent,
  cursorCatalogueDefaultThinking,
  remoteCatalogModelRows,
  remoteControlAgentRows,
  remoteDefaultApproval,
  remoteHostRecentDirs,
  remoteHostSwitchAction,
  remoteLiveConversation,
  remoteSendDisposition
} from '../remote/sessionGate.ts'
import { buildRemoteThreadEvent, fallbackRemoteSession, mapRemoteSessions } from '../remote/sessionList.ts'
import { AccountStore } from '../store/AccountStore.ts'
import { ConversationStore } from '../store/ConversationStore.ts'
import { NodeSecretStore } from '../store/NodeSecretStore.ts'
import { SettingsStore } from '../store/SettingsStore.ts'
import { LogStore } from '../store/LogStore.ts'
import { createAppLogger, setAppLogger, logUserAnswer, logUserCancel } from '../log/appLogger.ts'
import { logTurnEvent } from '../log/turnLog.ts'
import { LOG_EVENT } from '@shared/appLog'
import { trayDirLabel } from '../tray/trayLabels.ts'
import { LOCAL_MACHINE_ID, conversationOnMachine, parseWorkspaceRefList, recentsForMachine } from '@shared/workspaceHost'
import {
  parseAgentId,
  parseApprovalMode,
  buildRemoteControls
} from '@shared/remoteSessionControls.ts'
import { parseThinkingLevel } from '@shared/thinkingLevel.ts'
import { defaultModelForChatHost, resolveModelForChatHost } from '../../shared/agentModels.ts'
import { vendorIdFromEndpoint } from '../../shared/llmVendors.ts'
import { resolveDefaultChatHost } from '../../shared/cliHost.ts'
import {
  isStructuredCliHost,
  VAV_DEFAULT_MODEL_ID,
  type ChatMessage,
  type CliHostKind,
  type Conversation,
  type TurnEvent
} from '@shared/types'
import { remoteBrowseRoots, remoteIsTemporary, remoteParentPath, remotePathAllowed } from '@shared/remoteWorkspace.ts'
import { listRemoteChildEntries, listRemoteRootEntries } from '../remote/dirBrowse.ts'
import { getModelCatalogSnapshot, listHostModels, seedModelCatalog } from '../agent/listHostModels.ts'
import type {
  DaemonAccountsCatalog,
  DaemonSettingsCatalog,
  DaemonChangeSetCatalog,
  DaemonConnectorCatalog,
  DaemonFileSessionCatalog,
  DaemonLogCatalog,
  DaemonPluginCatalog,
  DaemonTimerCatalog,
  DaemonWorkspaceCatalog
} from '../daemon/DaemonServer.ts'
import {
  createChangeSetCatalog,
  createConnectorCatalog,
  createFileSessionCatalog,
  createTimerCatalog
} from '../daemon/shellCatalogs.ts'
import { FileSessionStore } from '../store/FileSessionStore.ts'
import { conversationToMeta } from '../store/conversationMeta.ts'
import type { WorkspaceHost } from './WorkspaceHost.ts'
import { locateTempWorkspaceToDir } from '../fs/locateTempWorkspace.ts'
import { patchAcpConfigOption, patchAcpSessionMode } from '@shared/acpSession.ts'
import { planSessionGoal } from '../agent/sessionGoal.ts'
import { createConnectorRegistry } from '../connectors/registry.ts'
import { createSettingsCatalog, vavAccountKeyPresent } from '../daemon/settingsCatalog.ts'
import { TimerStore } from '../store/TimerStore.ts'
import { TimerScheduler } from '../timer/TimerScheduler.ts'
import { HostRegistry } from './WorkspaceHost.ts'
import type {
  RemoteConfigure,
  RemoteControlsEvent,
  RemoteDirsEvent,
  RemoteHostEvent,
  RemoteSendImage,
  RemoteSession
} from '@shared/remoteControl.ts'

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
  logs: DaemonLogCatalog
  plugins: DaemonPluginCatalog
  timers: TimerStore
  timerCatalog: DaemonTimerCatalog
  connectorCatalog: DaemonConnectorCatalog
  fileSessionCatalog: DaemonFileSessionCatalog
  changeSetCatalog: DaemonChangeSetCatalog
  accountsCatalog: DaemonAccountsCatalog
  settingsCatalog: DaemonSettingsCatalog
  hasApiKey(): boolean
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
  const fileSessions = new FileSessionStore(opts.stateDir)
  const logStore = new LogStore({
    dir: join(opts.stateDir, 'logs'),
    durableDays: () => settings.get().logRetentionDays
  })
  const logger = createAppLogger(logStore)
  const changeSets = new ChangeSetStore()
  const hosts = new HostRegistry(opts.host)
  const files = new FileService(() => {
    /* watch coalescing is desktop UI; tools still write through FileService */
  }, opts.host.fs)

  const remoteSessionStatus = new Map<string, 'running' | 'done'>()
  const pendingSends = new RemoteSendQueue()
  let hub: RemoteControlHub
  const timerStore = new TimerStore(opts.stateDir)
  let timerScheduler: TimerScheduler | null = null
  const connectorRegistry = createConnectorRegistry({
    creds: () => ({
      cloudflare: {
        token: secrets.get('cloudflare') ?? null,
        accountId: settings.get().cloudflareAccountId || null
      },
      supabase: {
        token: secrets.get('supabase') ?? null,
        projectRef: settings.get().supabaseProjectRef || null
      },
      vercel: { token: secrets.get('vercel') ?? null }
    })
  })

  const handleAgentEvent = (event: TurnEvent): void => {
    if (event.type === 'start') remoteSessionStatus.set(event.conversationId, 'running')
    if (event.type === 'end') remoteSessionStatus.set(event.conversationId, 'done')
    logTurnEvent(event, conversations.get(event.conversationId), logger)
    fanRemoteTurn(event, hub, currentLocale())
    if (event.type === 'cli-session') {
      const next = listControls(event.conversationId)
      if (next) hub.pushControls(next)
    }
    if (event.type === 'end') {
      timerScheduler?.onTurnEnd(event.conversationId, false)
      flushSends()
    }
  }

  const resolveCreds = (conversation?: Conversation | null) =>
    resolveVavCredentials(
      { conversation, settingsEndpoint: settings.get().apiEndpoint },
      accounts,
      secrets.asSecretStore()
    )

  const hasApiKey = (): boolean => Boolean(resolveCreds().apiKey)

  const pluginService = new PluginService(home)
  const skillService = new SkillService()
  pluginService.setBundledSkills(skillService.catalog().skills, skillService.root())
  skillService.extraSkills = () => pluginService.enabledSkillEntries()
  pluginService.onChange(() => skillService.invalidate())
  {
    const bundledRoot = skillService.root()
    if (bundledRoot) files.grantRoot(bundledRoot)
    for (const path of pluginAccessPaths('vav', home)) files.grantRoot(path)
  }

  const agent = new AgentRuntime({
    conversations,
    settings,
    secrets: secrets.asSecretStore(),
    resolveVavCredentials: (conversation) => resolveCreds(conversation),
    files,
    hosts,
    changeSets,
    skills: skillService,
    plugins: pluginService,
    connectors: connectorRegistry,
    fileSessions,
    emit: handleAgentEvent
  })

  type CliRuntime = {
    owns(id: string): boolean
    isRunning(id: string): boolean
    run(
      id: string,
      text: string,
      attachments: string[],
      a: null,
      b: null,
      c: null
    ): Promise<void>
    cancel(id: string): void
    answer(id: string, toolCallId: string, answer: string): boolean
    dispose(id: string): void
    disposeAll(): void
    applyModel(id: string, model: string): void
    applyThinkingLevel(id: string): void
    applyFast(id: string): void
    applySessionMode(id: string, modeId: string): void
    applySessionConfig(id: string, configId: string, value: string | boolean): void
    setWorkingDirectory(id: string, cwd: string, previous?: string | null): void
    regenerate(id: string, messageId: string): Promise<void>
    editUserMessage(id: string, messageId: string, text: string): Promise<void>
    invalidateResume(id: string): void
    applySessionGoal(
      id: string,
      action: 'set' | 'pause' | 'resume' | 'clear',
      objective?: string
    ):
      | { ok: true; via: 'rpc' }
      | { ok: true; via: 'slash'; text: string }
      | { ok: false; error: string }
  }
  let cli: CliRuntime | null = null
  let cliLoad: Promise<CliRuntime | null> | null = null
  const loadCli = (): Promise<CliRuntime | null> => {
    if (cli) return Promise.resolve(cli)
    if (!cliLoad) {
      cliLoad = import('../agent/CliAgentHost.ts')
        .then(({ CliAgentHost }) => {
          cli = new CliAgentHost({
            conversations,
            settings,
            changeSets,
            files,
            hosts,
            emit: handleAgentEvent,
            publish: () => hub.schedulePushSessions()
          })
          return cli
        })
        .catch((err) => {
          console.warn('[vav-server] CliAgentHost unavailable', err)
          return null
        })
    }
    return cliLoad
  }

  timerScheduler = new TimerScheduler({
    store: timerStore,
    conversations,
    tmp,
    defaultModel: () => settings.get().defaultModel || VAV_DEFAULT_MODEL_ID,
    runTurn: (id, text) => {
      void agent.run(id, text, [], null, null, null)
    },
    isRunning: (id) => agent.isRunning(id),
    reload: () => timerStore.load()
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
        surfaceOf: (id) => (isStructuredCliHost(conversations.get(id)?.cliHost) ? 'cli' : 'vav'),
        favoriteOf: (id) => favorites.has(id)
      }
    )
  }

  function createSession(conversationId?: string): RemoteSession {
    const requested = conversationId?.trim()
    if (requested) {
      const existing = conversations.get(requested)
      if (existing && !existing.archived) {
        return (
          listSessions().find((session) => session.id === existing.id) ??
          fallbackRemoteSession(existing, {
            fallbackTitle: t('window.sessionFallback'),
            dirLabel: dirLabel(existing.workingDirectory),
            surface: isStructuredCliHost(existing.cliHost) ? 'cli' : 'vav'
          })
        )
      }
    }
    const snap = settings.get()
    const configured = snap.defaultWorkingDirectory?.trim()
    const workdir = configured || mintTempWorkdir(tmp)
    if (workdir) settings.rememberWorkspaceDirectory(workdir, tmp)
    const defaultHost = resolveDefaultChatHost(snap.defaultAgentId)
    const hostDefault = defaultModelForChatHost(defaultHost, snap)
    const model = resolveModelForChatHost(defaultHost, hostDefault ?? snap.defaultModel, {
      customModels: snap.customModels,
      vavDefaultModel: snap.defaultModel,
      hostDefaultModel: hostDefault,
      vendorId: defaultHost == null ? vendorIdFromEndpoint(snap.apiEndpoint) : null
    })
    const conversation = conversations.create(workdir, model || snap.defaultModel || VAV_DEFAULT_MODEL_ID, {
      approvalMode: snap.defaultApprovalMode ?? 'auto',
      thinkingLevel: parseThinkingLevel(snap.defaultThinkingLevel),
      cliHost: defaultHost,
      machineId: LOCAL_MACHINE_ID,
      ...(requested ? { id: requested } : {})
    })
    files.watchRoot(conversation.id, workdir)
    hub.schedulePushSessions()
    logger.user(LOG_EVENT.userSessionCreate, 'New session', {
      conversationId: conversation.id,
      data: { host: defaultHost ?? 'vav' }
    })
    return (
      listSessions().find((session) => session.id === conversation.id) ??
      fallbackRemoteSession(conversation, {
        fallbackTitle: t('window.sessionFallback'),
        dirLabel: dirLabel(conversation.workingDirectory),
        surface: defaultHost ? 'cli' : 'vav'
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
    const host = (conversation.cliHost ?? null) as CliHostKind | null
    const models = remoteCatalogModelRows({
      host,
      accountId: conversation.accountId,
      apiEndpoint: snap.apiEndpoint,
      customModels: snap.customModels,
      defaultModel: snap.defaultModel,
      disabledAgentModels: snap.disabledAgentModels,
      snapshot: getModelCatalogSnapshot()
    })
    return buildRemoteControls({
      conversationId,
      cliHost: host,
      model: conversation.model,
      thinkingLevel: conversation.thinkingLevel,
      approvalMode: conversation.approvalMode,
      acpSession: conversation.acpSession,
      hasMessages: conversation.messages.length > 0,
      agents: remoteControlAgentRows(snap.cliAgents),
      models,
      catalogueDefaultThinking: cursorCatalogueDefaultThinking(
        getModelCatalogSnapshot(),
        conversation.model,
        host
      ),
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
      hasKey: hasApiKey(),
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
      const nextHost = parsed === 'vav' ? null : parsed
      const prevHost = conversation.cliHost ?? null
      const action = remoteHostSwitchAction(prevHost, nextHost, conversation.messages.length > 0)
      if (action === 'locked') return 'locked' as const
      if (action === 'switch') {
        agent.disposeConversation(id)
        cli?.dispose(id)
        changeSets.clearConversation(id)
        conversations.switchHostTranscript(id, nextHost)
        const snap = settings.get()
        const latest = conversations.get(id)
        const resolved = resolveModelForChatHost(nextHost, latest?.model, {
          customModels: snap.customModels,
          vavDefaultModel: snap.defaultModel,
          hostDefaultModel: defaultModelForChatHost(nextHost, snap),
          vendorId: nextHost == null ? vendorIdFromEndpoint(snap.apiEndpoint) : null
        })
        if (resolved && resolved !== latest?.model) {
          conversations.updateMeta(id, { model: resolved })
        }
      }
    }
    if (message.model !== undefined) {
      conversations.updateMeta(id, { model: message.model })
      if (cli?.owns(id)) cli.applyModel(id, message.model)
    }
    if (message.thinkingLevel !== undefined) {
      conversations.setThinkingLevel(id, parseThinkingLevel(message.thinkingLevel))
      if (cli?.owns(id)) cli.applyThinkingLevel(id)
    }
    if (message.approvalMode !== undefined) {
      const mode = parseApprovalMode(message.approvalMode)
      if (mode) conversations.setApprovalMode(id, mode)
    }
    if (message.fast !== undefined) {
      conversations.setFast(id, message.fast === true)
      if (cli?.owns(id)) cli.applyFast(id)
    }
    if (message.mode !== undefined && message.mode.trim()) {
      const modeId = message.mode.trim()
      const applyMode = (host: CliRuntime | null): void => {
        if (host) {
          const latest = conversations.get(id)
          const config = latest?.acpSession?.configOptions?.find((option) => option.category === 'mode')
          if (config) host.applySessionConfig(id, config.id, modeId)
          else host.applySessionMode(id, modeId)
          return
        }
        const latest = conversations.get(id)
        if (!latest) return
        const config = latest.acpSession?.configOptions?.find((option) => option.category === 'mode')
        const next = config
          ? patchAcpConfigOption(latest.acpSession, config.id, modeId)
          : patchAcpSessionMode(latest.acpSession, modeId)
        if (next) conversations.updateMeta(id, { acpSession: next })
      }
      if (cli) applyMode(cli)
      else {
        applyMode(null)
        void loadCli().then(applyMode)
      }
    }
    const latest = conversations.get(id)
    const host = (latest?.cliHost ?? null) as CliHostKind | null
    void listHostModels(host, settings, { endpoint: resolveCreds(latest).endpoint })
      .then(() => {
        const next = listControls(id)
        if (next) hub.pushControls(next)
      })
      .catch(() => undefined)
    const controls = listControls(id)
    if (controls) hub.pushControls(controls)
    hub.schedulePushSessions()
    return 'ok' as const
  }

  function busy(conversationId: string): boolean {
    if (isStructuredCliHost(conversations.get(conversationId)?.cliHost)) {
      return cli?.isRunning(conversationId) === true
    }
    return agent.isRunning(conversationId)
  }

  function startTurn(conversationId: string, text: string, attachments: string[]): void {
    if (isStructuredCliHost(conversations.get(conversationId)?.cliHost)) {
      void loadCli().then((host) => {
        if (!host) {
          handleAgentEvent({
            type: 'end',
            conversationId,
            message: {
              id: `cli-missing-${conversationId}`,
              parentId: null,
              role: 'assistant',
              content: 'CLI agent host is unavailable in this vav-server.',
              blocks: [{ kind: 'text', text: 'CLI agent host is unavailable in this vav-server.' }],
              createdAt: Date.now(),
              errorText: 'CLI agent host is unavailable in this vav-server.'
            },
            tokensUsed: 0,
            error: 'CLI agent host is unavailable in this vav-server.',
            errorKind: 'generic'
          })
          return
        }
        void host.run(conversationId, text, attachments, null, null, null)
      })
      return
    }
    void agent.run(conversationId, text, attachments, null, null, null)
  }

  function flushSends(): void {
    for (const next of pendingSends.takeReady(busy)) {
      startTurn(next.conversationId, next.text, next.attachments)
    }
  }

  function materializeImages(images: RemoteSendImage[] | undefined): string[] {
    if (!images?.length) return []
    const dir = join(tmp, 'vav-remote-inbox')
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      return []
    }
    const paths: string[] = []
    for (const image of images) {
      let buffer: Buffer
      try {
        buffer = Buffer.from(image.data, 'base64')
      } catch {
        continue
      }
      if (!buffer.length) continue
      const ext = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg'
      const name = (image.name.replace(/[^\w.-]+/g, '_') || 'photo').slice(0, 40)
      const path = join(dir, `${Date.now()}-${paths.length}-${name}.${ext}`)
      try {
        writeFileSync(path, buffer)
        paths.push(path)
      } catch {
        // Skip a bad frame; the text still goes through.
      }
    }
    return paths
  }

  function sendMessage(conversationId: string, text: string, attachments: string[] = []) {
    const conversation = conversations.get(conversationId)
    const disposition = remoteSendDisposition(conversation, conversation ? busy(conversationId) : false)
    if (disposition === 'not-found' || disposition === 'archived') return disposition
    if (disposition === 'enqueue') {
      pendingSends.enqueue(conversationId, text, attachments)
      return 'ok' as const
    }
    logger.user(LOG_EVENT.userSend, 'Send', {
      conversationId,
      data: { chars: text.length, attachments: attachments.length }
    })
    startTurn(conversationId, text, attachments)
    return 'ok' as const
  }

  function cancel(conversationId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok' || !conversation) return gate
    pendingSends.clear(conversationId)
    if (isStructuredCliHost(conversation.cliHost)) cli?.cancel(conversationId)
    else agent.cancel(conversationId)
    logUserCancel(conversationId)
    return 'ok' as const
  }

  function reply(conversationId: string, toolCallId: string, answer: string): boolean {
    logUserAnswer(conversationId, toolCallId, answer.length)
    if (cli?.owns(conversationId) && cli.answer(conversationId, toolCallId, answer)) return true
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

  function browse(
    conversationId: string,
    path?: string,
    files?: boolean
  ): RemoteDirsEvent | 'not-found' | 'forbidden' {
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
      join,
      includeFiles: files === true
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
    if (gate !== 'ok' || !conversation) return gate
    const next = path || mintTempWorkdir(tmp)
    if (path) {
      const roots = rootsFor(conversationId)
      if (!roots || !remotePathAllowed(path, roots) || !existsSync(path)) return 'forbidden'
    }
    const previous = conversation.workingDirectory
    conversations.updateMeta(conversationId, { workingDirectory: next })
    agent.setWorkingDirectory(conversationId, next)
    if (cli?.owns(conversationId)) cli.setWorkingDirectory(conversationId, next, previous)
    files.watchRoot(conversationId, next)
    if (next) settings.rememberWorkspaceDirectory(next, tmp)
    const controls = listControls(conversationId)
    if (controls) hub.pushControls(controls)
    hub.schedulePushSessions()
    return 'ok' as const
  }

  async function compact(
    conversationId: string,
    keepAfterMessageId?: string
  ): Promise<{ ok: true; compaction: RemoteCompaction } | { ok: false; error: string }> {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return { ok: false, error: gate }
    if (cli?.owns(conversationId)) return { ok: false, error: t('compact.error.cliHost') }
    const result = await agent.compact(conversationId, { keepAfterMessageId })
    if (result.ok) hub.schedulePushSessions()
    return result
  }

  function clearCompaction(conversationId: string, leafId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return { ok: false as const, error: gate }
    if (cli?.owns(conversationId)) return { ok: false as const, error: t('compact.error.cliHost') }
    const result = agent.clearCompaction(conversationId, leafId)
    if (result.ok) hub.schedulePushSessions()
    return result
  }

  function regenerate(conversationId: string, messageId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    if (cli?.owns(conversationId)) void cli.regenerate(conversationId, messageId)
    else void agent.regenerate(conversationId, messageId)
    return 'ok' as const
  }

  function edit(conversationId: string, messageId: string, text: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    if (cli?.owns(conversationId)) void cli.editUserMessage(conversationId, messageId, text)
    else void agent.editUserMessage(conversationId, messageId, text)
    return 'ok' as const
  }

  function fork(conversationId: string, messageId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    return agent.fork(conversationId, messageId) ? ('ok' as const) : ('not-found' as const)
  }

  function deleteMessage(conversationId: string, messageId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    const next = conversations.deleteMessage(conversationId, messageId)
    if (!next) return 'not-found' as const
    if (isStructuredCliHost(next.cliHost)) cli?.invalidateResume(conversationId)
    hub.schedulePushSessions()
    return 'ok' as const
  }

  function sessionOf(id: string): RemoteSession | null {
    return (
      listSessions().find((session) => session.id === id) ??
      (conversations.get(id)
        ? fallbackRemoteSession(conversations.get(id)!, {
            fallbackTitle: t('window.sessionFallback'),
            dirLabel: dirLabel(conversations.get(id)!.workingDirectory),
            surface: isStructuredCliHost(conversations.get(id)!.cliHost) ? 'cli' : 'vav'
          })
        : null)
    )
  }

  function duplicate(conversationId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return null
    const next = conversations.duplicate(conversationId)
    if (!next) return null
    hub.schedulePushSessions()
    return sessionOf(next.id)
  }

  function continueInNew(conversationId: string, messageId: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return null
    const next = conversations.branchToNewConversation(conversationId, messageId)
    if (!next) return null
    hub.schedulePushSessions()
    return sessionOf(next.id)
  }

  function applyGoal(
    conversationId: string,
    action: 'set' | 'pause' | 'resume' | 'clear',
    objective?: string
  ) {
    const conversation = conversations.get(conversationId)
    if (!conversation) return { ok: false as const, error: 'no such conversation' }
    if (cli?.applySessionGoal) return cli.applySessionGoal(conversationId, action, objective)
    return planSessionGoal({
      capability: conversation.acpSession?.goalCapability,
      action,
      objective,
      connected: agent.isRunning(conversationId)
    })
  }

  function toPhoneReview(set: ReturnType<ChangeSetStore['get']>): RemoteReviewSet | null {
    if (!set) return null
    return {
      id: set.id,
      status: set.status,
      files: set.files.map((file) => ({
        name: basename(file.filePath),
        status: file.status
      }))
    }
  }

  async function review(
    conversationId: string,
    action: 'active' | 'get' | 'accept-all' | 'reject-all',
    setId?: string
  ): Promise<{ ok: true; set: RemoteReviewSet | null } | { ok: false; error: string }> {
    const conversation = conversations.get(conversationId)
    if (!conversation || conversation.archived) return { ok: false, error: 'not-found' }
    if (action === 'active') return { ok: true, set: toPhoneReview(changeSets.activeFor(conversationId)) }
    if (action === 'get') {
      if (!setId) return { ok: false, error: 'setId required' }
      return { ok: true, set: toPhoneReview(changeSets.get(setId)) }
    }
    if (!setId) return { ok: false, error: 'setId required' }
    const set = action === 'accept-all' ? await changeSets.acceptAll(setId) : await changeSets.rejectAll(setId)
    if (!set) return { ok: false, error: 'not-found' }
    return { ok: true, set: toPhoneReview(set) }
  }

  async function locateWorkspace(conversationId: string, destinationDir: string) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok' || !conversation) return { ok: false as const, error: gate === 'ok' ? 'not-found' : gate }
    if (!conversation.workingDirectory) return { ok: false as const, error: 'no workspace' }
    const dest = destinationDir.trim()
    if (!dest) return { ok: false as const, error: 'destination required' }
    try {
      const located = await locateTempWorkspaceToDir({
        workdir: conversation.workingDirectory,
        destinationDir: dest,
        platform: process.platform,
        fs: opts.host.fs,
        crossDeviceCopy: true
      })
      if (!located.ok) {
        return {
          ok: false as const,
          error: located.error === 'exists' ? 'destination exists' : 'not a temporary workspace'
        }
      }
      const result = setWorkspace(conversationId, located.nextWorkdir)
      if (result !== 'ok') return { ok: false as const, error: result }
      return { ok: true as const, workdir: located.nextWorkdir }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  }

  function setLeaf(conversationId: string, messageId: string, follow?: boolean) {
    const conversation = conversations.get(conversationId)
    const gate = remoteLiveConversation(conversation)
    if (gate !== 'ok') return gate
    if (follow) {
      if (!conversations.selectBranch(conversationId, messageId)) return 'not-found' as const
    } else {
      conversations.setActiveLeaf(conversationId, messageId)
    }
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
    materializeImages,
    createSession,
    cancel,
    reply,
    rename,
    archive,
    pin,
    favorite,
    browse,
    setWorkspace,
    compact,
    clearCompaction,
    regenerate,
    edit,
    fork,
    deleteMessage,
    setLeaf,
    duplicate,
    continueInNew,
    applyGoal,
    locateWorkspace,
    review,
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

  const logs: DaemonLogCatalog = {
    query: (query) => logStore.query(query),
    stats: () => logStore.stats(),
    clear: (scope) => logStore.clear(scope),
    exportText: (query) => logStore.exportText(query),
    append: (input) => logStore.append(input),
    subscribe: (fn) => logStore.subscribe(fn)
  }

  const plugins: DaemonPluginCatalog = {
    snapshot: (host) => pluginService.snapshot(host),
    setEnabled: (host, pluginId, enabled) =>
      pluginService.setEnabled(pluginHostKind(host), pluginId, enabled),
    create: (kind, name) => {
      if (kind !== 'skill' && kind !== 'mcp' && kind !== 'hook' && kind !== 'plugin') {
        return { ok: false, error: 'Unknown plugin kind' }
      }
      return pluginService.create(kind, name)
    },
    writeConfig: (path, content) => pluginService.writeConfig(path, content)
  }

  const timerCatalog = createTimerCatalog({
    store: timerStore,
    scheduler: () => timerScheduler,
    conversations,
    createScheduled: () => {
      const snap = settings.get()
      const workdir = mintTempWorkdir(tmp)
      const conversation = conversations.create(workdir, snap.defaultModel || VAV_DEFAULT_MODEL_ID, {
        sessionKind: 'timer',
        title: t('timer.untitled'),
        approvalMode: snap.defaultApprovalMode ?? 'auto',
        thinkingLevel: parseThinkingLevel(snap.defaultThinkingLevel),
        machineId: LOCAL_MACHINE_ID
      })
      const job = timerStore.createJob({
        title: conversation.title,
        prompt: '',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: false,
        conversationId: conversation.id,
        workdirPolicy: 'source',
        sourceWorkdir: conversation.workingDirectory
      })
      conversations.updateMeta(conversation.id, { timerJobId: job.id, sessionKind: 'timer' })
      hub.schedulePushSessions()
      return { job, conversation: conversationToMeta(conversations.get(conversation.id) ?? conversation) }
    }
  })

  const fileSessionCatalog = createFileSessionCatalog({
    store: fileSessions,
    conversations,
    settings
  })
  const settingsCatalog = createSettingsCatalog(settings, secrets, {
    hasVavKey: () => vavAccountKeyPresent(accounts, secrets)
  })
  const accountsCatalog = createAccountsCatalog({
    accounts,
    secrets: secrets.asSecretStore(),
    settings,
    conversations
  })
  async function seedReviewOnHost(conversationId: string): Promise<{
    set: ReturnType<ChangeSetStore['get']>
    user: ChatMessage | null
    assistant: ChatMessage | null
  } | null> {
    const conversation = conversations.get(conversationId)
    if (!conversation || conversation.archived) return null
    const existing = changeSets.activeFor(conversationId)
    if (existing) {
      const assistant = conversation.messages.find((row) => row.changeSetId === existing.id) ?? null
      const user = assistant
        ? (conversation.messages.find((row) => row.id === assistant.parentId) ?? null)
        : null
      return { set: existing, user, assistant }
    }
    const captured: { user?: ChatMessage; assistant?: ChatMessage } = {}
    const seeded = await seedChangeReviewTurn({
      conversationId,
      workdir: conversation.workingDirectory || tmp,
      model: conversation.model || 'test',
      changeSets,
      appendMessages: (user, assistant) => {
        conversations.appendMessage(conversationId, user)
        conversations.appendMessage(conversationId, assistant)
        conversations.flush()
        captured.user = user
        captured.assistant = assistant
      }
    })
    if (!seeded) return null
    hub.finishTurn(conversationId, 'done')
    return {
      set: changeSets.get(seeded.setId),
      user: captured.user ?? null,
      assistant: captured.assistant ?? null
    }
  }

  const changeSetCatalog = createChangeSetCatalog(changeSets, seedReviewOnHost)

  const connectorCatalog = createConnectorCatalog({
    registry: connectorRegistry,
    creds: () => ({
      cloudflare: {
        token: secrets.get('cloudflare') ?? null,
        accountId: settings.get().cloudflareAccountId || null
      },
      supabase: {
        token: secrets.get('supabase') ?? null,
        projectRef: settings.get().supabaseProjectRef || null
      },
      vercel: { token: secrets.get('vercel') ?? null }
    })
  })

  return {
    hub,
    agent,
    conversations,
    settings,
    secrets,
    files,
    catalog,
    logs,
    plugins,
    timers: timerStore,
    timerCatalog,
    connectorCatalog,
    fileSessionCatalog,
    changeSetCatalog,
    accountsCatalog,
    settingsCatalog,
    hasApiKey,
    load() {
      mkdirSync(opts.stateDir, { recursive: true })
      settings.load()
      secrets.load()
      accounts.load()
      conversations.load({
        model: settings.get().defaultModel || VAV_DEFAULT_MODEL_ID,
        mintWorkdir: () => mintTempWorkdir(tmp)
      })
      fileSessions.bind(conversations)
      timerStore.load()
      timerScheduler?.start()
      logStore.load()
      setAppLogger(logger)
      logger.system(LOG_EVENT.systemBoot, 'vav-server ready', { data: { version: opts.appVersion } })
      const envKey = process.env.VAV_API_KEY?.trim()
      if (envKey) secrets.set(envKey, 'api')
      const envEndpoint = process.env.VAV_API_ENDPOINT?.trim()
      if (envEndpoint) settings.update({ apiEndpoint: envEndpoint })
      seedModelCatalog(settings, { endpoint: resolveCreds().endpoint })
    },
    dispose() {
      logger.system(LOG_EVENT.systemQuit, 'Quit')
      timerScheduler?.stop()
      logStore.dispose()
      setAppLogger(null)
      agent.disposeAll()
      cli?.disposeAll()
      files.disposeAll()
      hub.dispose()
    }
  }
}
