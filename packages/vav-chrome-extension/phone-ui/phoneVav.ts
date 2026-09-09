import type {
  Bootstrap,
  FileInspectResult,
  NativeMenuItem,
  SettingsView,
  SettingsViewPayload,
  VavApi
} from '@shared/ipc'
import { mimeForPreviewKind, previewKind } from '@shared/previewKind'
import type {
  RemoteControlStatus,
  RemoteControlsEvent,
  RemoteDirEntry,
  RemoteDirsEvent,
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
import { emptyGitSnapshot } from '@shared/git'
import { emptyPluginSnapshot, pluginHostKind, unwrapPluginMutation } from '@shared/plugins'
import {
  mergeHostSettings,
  omitHostSettings,
  pickHostSettings,
  pickSecretPresent
} from '@shared/hostSettings'
import type { AccountsPagePayload, AccountView, HostDiscoveryPeer } from '@shared/ipc'
import { vendorDisplayName, vendorIdFromEndpoint } from '@shared/llmVendors'
import { isStructuredCliHost } from '@shared/cliHost'
import {
  DEFAULT_CLI_AGENTS,
  DEFAULT_SETTINGS,
  DIRECTORY_ENTRY_CAP,
  type AppSettings,
  enabledCliAgents,
  isIgnoredName,
  type ConversationMeta,
  type ConversationPtyLayouts,
  type FileEntry,
  type LeafCompaction,
  type FileSortKey,
  type TurnEvent,
  type TurnStatus
} from '@shared/types'
import { LOCAL_MACHINE_ID, type WorkspaceHostInfo } from '@shared/workspaceHost'
import { parseMachinePairing, type IncomingController } from '@shared/daemonProtocol'
import {
  isLocalPairingHost,
  isLoopbackAddress,
  isPrivateLanAddress,
  VAV_SERVER_WEB_DEFAULT_PORT,
  VAV_DISCOVER_APP,
  type VavDiscoverInfo
} from '@shared/vavDiscover'
import { codeFonts, type Platform } from '@shared/platform'
import { showDomMenu } from '@/lib/domMenu'
import { composeSendText } from './pageContext'
import { clipDest, clipDisplayName, clipHash16, clipRootOf } from '@shared/clipLayout'
import { cssTileSize, SURFACE_PATTERN_MAX_EDGE } from '@shared/surfacePattern'
import { normalizeAccentHex } from '@shared/colorTints'
import { decodeBase64Utf8 } from './phoneDaemon'
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

export function fileEntriesFromRemoteDirs(
  entries: RemoteDirEntry[],
  sort: FileSortKey,
  ascending: boolean
): FileEntry[] {
  const mapped: FileEntry[] = entries.map((entry) => {
    const isDirectory = entry.isDirectory !== false
    return {
      path: entry.path,
      name: entry.name,
      isDirectory,
      size: 0,
      modifiedAt: 0,
      createdAt: 0,
      children: isDirectory ? null : undefined
    }
  })
  const direction = ascending ? 1 : -1
  return [...mapped].sort((a, b) => {
    if (sort !== 'none' && a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * direction
  })
}

export function pairingSecretFromPaste(text: string): string | null {
  const parsed = parseMachinePairing(text)
  if (parsed?.secret && parsed.secret.length >= 16) return parsed.secret
  const trimmed = text.trim()
  if (trimmed.length >= 16 && !/\s/.test(trimmed) && !/[:/?#]/.test(trimmed)) return trimmed
  return null
}

export function pairingPasteIsLoopback(text: string): boolean {
  const parsed = parseMachinePairing(text)
  if (!parsed) {
    const trimmed = text.trim()
    return trimmed.length >= 16 && !/\s/.test(trimmed) && !/[:/?#]/.test(trimmed)
  }
  if (parsed.token) return false
  return !parsed.host || isLoopbackAddress(parsed.host)
}

/** Loopback or RFC1918 / link-local. Tailcat tokens and public IPs stay on desktop. */
export function pairingPasteIsLocalHost(text: string): boolean {
  const parsed = parseMachinePairing(text)
  if (!parsed) {
    const trimmed = text.trim()
    return trimmed.length >= 16 && !/\s/.test(trimmed) && !/[:/?#]/.test(trimmed)
  }
  if (parsed.token) return false
  return !parsed.host || isLocalPairingHost(parsed.host)
}

const CHROME_WAN_PAIR_ERROR =
  'Chrome can pair this machine or a private LAN host. Use the desktop app for WAN / Tailcat.'

async function ensureLocalPairingAccess(host?: string | null): Promise<boolean> {
  if (!host || isLoopbackAddress(host)) return true
  if (!isPrivateLanAddress(host)) return false
  const chromeApi = (
    globalThis as {
      chrome?: { permissions?: { request?: (opts: { origins: string[] }) => Promise<boolean> } }
    }
  ).chrome
  if (!chromeApi?.permissions?.request) return true
  const authority = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  try {
    return await chromeApi.permissions.request({
      origins: [
        `http://${authority}/*`,
        `https://${authority}/*`,
        `ws://${authority}/*`,
        `wss://${authority}/*`
      ]
    })
  } catch {
    return false
  }
}

/** Same coalescing window as desktop `FileService.watchRoot`. */
export const FILE_WATCH_DEBOUNCE_MS = 300

export function hostPathBasename(path: string): string {
  const trimmed = String(path || '').replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return slash < 0 ? trimmed : trimmed.slice(slash + 1)
}

export function hostPathDirname(path: string): string {
  const trimmed = String(path || '').replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash <= 0) return trimmed || path
  return trimmed.slice(0, slash)
}

export function hostPathJoin(root: string, rel: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  const cleanRoot = String(root || '').replace(/[\\/]+$/, '')
  const cleanRel = String(rel || '').replace(/^[\\/]+/, '')
  if (!cleanRel) return cleanRoot
  return `${cleanRoot}${sep}${cleanRel}`
}

export function guessClientPlatform(): Platform {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/Win/i.test(ua)) return 'win32'
  if (/Linux/i.test(ua)) return 'linux'
  return 'darwin'
}

export function resolvedHostPlatform(hostPlatform?: string | null): Platform {
  if (hostPlatform === 'darwin' || hostPlatform === 'win32' || hostPlatform === 'linux') {
    return hostPlatform
  }
  return guessClientPlatform()
}

export function discoverPeerFromInfo(info: VavDiscoverInfo): HostDiscoveryPeer {
  return {
    machineId: LOCAL_MACHINE_ID,
    name: info.name || 'vav-server',
    port: info.port || VAV_SERVER_WEB_DEFAULT_PORT,
    address: '127.0.0.1',
    platform: undefined
  }
}

export async function fetchDiscoverAt(
  origin: string,
  fetchImpl: typeof fetch = fetch
): Promise<VavDiscoverInfo | null> {
  try {
    const res = await fetchImpl(`${String(origin || '').replace(/\/$/, '')}/discover`)
    if (!res.ok) return null
    const info = (await res.json()) as VavDiscoverInfo
    return info?.app === VAV_DISCOVER_APP ? info : null
  } catch {
    return null
  }
}

export async function fetchLoopbackDiscover(
  fetchImpl: typeof fetch = fetch
): Promise<VavDiscoverInfo | null> {
  const urls = ['/discover', `http://127.0.0.1:${VAV_SERVER_WEB_DEFAULT_PORT}/discover`]
  for (const url of urls) {
    try {
      const res = await fetchImpl(url)
      if (!res.ok) continue
      const info = (await res.json()) as VavDiscoverInfo
      if (info?.app === VAV_DISCOVER_APP) return info
    } catch {
      /* next */
    }
  }
  return null
}

export function hasUsableAlphaChannel(data: ArrayLike<number>): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 255) return true
  }
  return false
}

export function assessSurfaceRgba(
  data: ArrayLike<number>,
  width: number,
  height: number
): { ok: true; size: string } | { ok: false; reason: 'no-alpha' | 'invalid' } {
  if (width < 1 || height < 1 || data.length < width * height * 4) {
    return { ok: false, reason: 'invalid' }
  }
  if (!hasUsableAlphaChannel(data)) return { ok: false, reason: 'no-alpha' }
  return { ok: true, size: cssTileSize(width, height) }
}

function flattenRgbToBlack(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0
    data[i + 1] = 0
    data[i + 2] = 0
  }
}

function pickBrowserColor(defaultHex?: string): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'color'
    input.value = normalizeAccentHex(defaultHex) ?? '#000000'
    input.style.position = 'fixed'
    input.style.left = '-2000px'
    let settled = false
    const done = (value: string | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(value)
    }
    input.addEventListener('input', () => done(input.value))
    input.addEventListener('change', () => done(input.value))
    document.body.appendChild(input)
    input.click()
    window.setTimeout(() => done(null), 120_000)
  })
}

function pickBrowserFile(accept: string): Promise<File | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    let settled = false
    const done = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => done(null))
    document.body.appendChild(input)
    input.click()
    window.setTimeout(() => done(null), 120_000)
  })
}

async function importBrowserSurfacePattern(
  file: File
): Promise<
  | { ok: true; url: string; size: string }
  | { ok: false; reason: 'no-alpha' | 'invalid' }
> {
  if (!/^image\/(png|webp|gif)$/i.test(file.type) && !/\.png$/i.test(file.name)) {
    return { ok: false, reason: file.type.includes('jpeg') || /\.jpe?g$/i.test(file.name) ? 'no-alpha' : 'invalid' }
  }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { ok: false, reason: 'invalid' }
  }
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, SURFACE_PATTERN_MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, reason: 'invalid' }
    ctx.drawImage(bitmap, 0, 0, width, height)
    const image = ctx.getImageData(0, 0, width, height)
    const assessed = assessSurfaceRgba(image.data, width, height)
    if (!assessed.ok) return assessed
    flattenRgbToBlack(image.data)
    ctx.putImageData(image, 0, 0)
    return { ok: true, url: canvas.toDataURL('image/png'), size: assessed.size }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

function browserCodeFonts(platform?: string | null): string[] {
  return codeFonts(resolvedHostPlatform(platform))
}

export function hostInfoFromRemote(host: RemoteHostEvent | null): WorkspaceHostInfo[] {
  return [
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

export type PhoneVavHandle = {
  api: VavApi
  transport: PhoneTransport
}

type PhoneVavPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: infer A) => unknown
    ? (...args: A) => unknown
    : T[K] extends object
      ? PhoneVavPartial<T[K]>
      : T[K]
}

function definePhoneVavApi<T extends PhoneVavPartial<VavApi>>(api: T): T {
  return api
}

export function installPhoneVav(transport: PhoneTransport): PhoneVavHandle {
  const sessions: RemoteSession[] = []
  const threads: Record<string, RemoteThreadMessage[]> = {}
  const controls: Record<string, RemoteControlsEvent> = {}
  let host: RemoteHostEvent | null = null
  const currentHost = (): RemoteHostEvent | null => host
  let settings = {
    ...DEFAULT_SETTINGS,
    remoteControlEnabled: true,
    apiKeyPresent: false,
    cliAgents: DEFAULT_CLI_AGENTS.map((agent) => ({ ...agent }))
  }
  const listHandlers = new Set<ListHandler>()
  const turnHandlers = new Set<TurnHandler>()
  const settingsHandlers = new Set<(next: typeof settings) => void>()
  const accountHandlers = new Set<(page: AccountsPagePayload) => void>()
  const catalogHandlers = new Set<(catalog: Record<string, { host: string; models: { id: string; label: string }[]; source: 'live' }>) => void>()
  const threadWaiters = new Map<string, Array<(rows: RemoteThreadMessage[]) => void>>()
  type DirResult = { ok: true; event: RemoteDirsEvent } | { ok: false; error: string }
  const dirWaiters = new Map<string, Array<(result: DirResult) => void>>()
  const hostHandlers = new Set<(hosts: WorkspaceHostInfo[]) => void>()
  const remoteStatusHandlers = new Set<(status: RemoteControlStatus) => void>()
  const incomingHandlers = new Set<(rows: IncomingController[]) => void>()
  const createdWaiters: Array<(session: RemoteSession) => void> = []
  const compactWaiters = new Map<
    string,
    Array<(row: { ok: boolean; error?: string; compaction?: LeafCompaction }) => void>
  >()
  const goalWaiters = new Map<
    string,
    Array<
      (
        row:
          | { ok: true; via: 'rpc' }
          | { ok: true; via: 'slash'; text: string }
          | { ok: false; error: string }
      ) => void
    >
  >()
  const locateWaiters = new Map<
    string,
    Array<(row: { ok: true; workdir?: string } | { ok: false; error: string }) => void>
  >()
  const settingsViewHandlers = new Set<(payload: SettingsViewPayload) => void>()
  let desiredSettings: SettingsViewPayload = { view: 'appearance' }
  let bootResolve: (() => void) | null = null
  const booted = new Promise<void>((resolve) => {
    bootResolve = resolve
  })
  let sawSessions = false
  let syncPlatform = (): void => {}

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

  const catalogOf = (): Record<
    string,
    { host: string; models: { id: string; label: string }[]; source: 'live' }
  > => {
    const byAgent = new Map<string, { id: string; label: string }[]>()
    for (const row of Object.values(controls)) {
      const agent = typeof row.agent === 'string' && row.agent ? row.agent : 'vav'
      const models = (row.models ?? []).map((model) => ({ id: model.id, label: model.label }))
      if (models.length) byAgent.set(agent, models)
    }
    const vavModels = byAgent.get('vav') ?? []
    const vendorId = vendorIdFromEndpoint(settings.apiEndpoint)
    const catalog: Record<
      string,
      { host: string; models: { id: string; label: string }[]; source: 'live' }
    > = {
      vav: { host: 'vav', models: vavModels, source: 'live' }
    }
    if (vendorId && vendorId !== 'custom') {
      catalog[`vav:${vendorId}`] = { host: `vav:${vendorId}`, models: vavModels, source: 'live' }
    }
    for (const agent of enabledCliAgents(settings.cliAgents)) {
      if (!isStructuredCliHost(agent.id)) continue
      catalog[agent.id] = {
        host: agent.id,
        models: byAgent.get(agent.id) ?? [],
        source: 'live'
      }
    }
    return catalog
  }

  const emitCatalog = (): void => {
    const catalog = catalogOf()
    for (const handler of catalogHandlers) handler(catalog)
  }

  const emitSettings = (): void => {
    for (const handler of settingsHandlers) handler(settings)
  }

  const phoneAccountPage = (): AccountsPagePayload => {
    if (!settings.apiKeyPresent) {
      return { workspaceKey: '', workspaceLabel: '', groups: [], accounts: [], usage: [] }
    }
    const vendorId = vendorIdFromEndpoint(settings.apiEndpoint)
    const name = vendorDisplayName(settings.apiEndpoint, 'VAV')
    const account: AccountView = {
      id: 'vav-phone',
      agentId: vendorId && vendorId !== 'custom' ? vendorId : 'vav',
      provider: 'vav',
      kind: 'vav_key',
      name,
      identityName: name,
      alias: null,
      endpoint: settings.apiEndpoint,
      endpointHost: null,
      current: true,
      keyPresent: true,
      keyHint: null,
      keyStatus: 'ok',
      oauthHost: null,
      oauthSignedIn: false,
      oauthExpired: false,
      hasCredentialSnapshot: false,
      credentialExpiresAtMs: null,
      lastModel: settings.defaultModel ?? null,
      lastUsedAt: null,
      monthTokens: 0,
      monthCostUsd: 0,
      monthPercent: 0,
      monthResetsAt: 0,
      quotaWindows: [],
      quotaPercent: null,
      quotaStatus: 'none',
      quotaUpdatedAt: null,
      quotaError: null,
      balance: null
    }
    return {
      workspaceKey: '',
      workspaceLabel: '',
      groups: [
        {
          agentId: account.agentId,
          name,
          createKind: 'key',
          createKinds: ['key'],
          oauthDomain: '',
          accounts: [account]
        }
      ],
      accounts: [account],
      usage: []
    }
  }

  let lastAccountPage: AccountsPagePayload | null = null

  const currentAccountPage = (): AccountsPagePayload => lastAccountPage ?? phoneAccountPage()

  const pageFromDaemon = async (workspaceKey?: string | null): Promise<AccountsPagePayload | null> => {
    const plane = await daemonReady()
    if (!plane) return null
    try {
      const page = (await plane.request('accounts.getPage', { workspaceKey })) as AccountsPagePayload
      if (page && Array.isArray(page.accounts)) {
        lastAccountPage = page
        return page
      }
    } catch {
      /* fall back to the host-hasKey row */
    }
    return null
  }

  const emitAccounts = (): void => {
    const page = currentAccountPage()
    for (const handler of accountHandlers) handler(page)
  }

  const applyLine = (msg: PhoneLine): void => {
    if (msg.type === 'host') {
      host = msg as unknown as RemoteHostEvent
      settings = {
        ...settings,
        apiKeyPresent: host.hasKey === true,
        ...(host.defaults?.model ? { defaultModel: host.defaults.model } : {})
      }
      syncPlatform()
      emitSettings()
      emitAccounts()
      emitCatalog()
      const hosts = hostInfoFromRemote(host)
      for (const handler of hostHandlers) handler(hosts)
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
      void import('@/state/sessionStore').then(({ useSessionStore }) => {
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
      emitCatalog()
      return
    }
    if (msg.type === 'dirs' && typeof msg.conversationId === 'string') {
      const event = msg as unknown as RemoteDirsEvent
      const waiters = dirWaiters.get(event.conversationId) ?? []
      dirWaiters.delete(event.conversationId)
      for (const waiter of waiters) waiter({ ok: true, event })
      return
    }
    if (msg.type === 'compacted' && typeof msg.conversationId === 'string') {
      const waiters = compactWaiters.get(msg.conversationId) ?? []
      compactWaiters.delete(msg.conversationId)
      const compaction = msg.compaction as LeafCompaction | undefined
      const row = {
        ok: msg.ok === true,
        ...(typeof msg.error === 'string' ? { error: msg.error } : {}),
        ...(compaction ? { compaction } : {})
      }
      for (const waiter of waiters) waiter(row)
      return
    }
    if (msg.type === 'goaled' && typeof msg.conversationId === 'string') {
      const waiters = goalWaiters.get(msg.conversationId) ?? []
      goalWaiters.delete(msg.conversationId)
      const row =
        msg.ok === true && msg.via === 'slash' && typeof msg.text === 'string'
          ? { ok: true as const, via: 'slash' as const, text: msg.text }
          : msg.ok === true
            ? { ok: true as const, via: 'rpc' as const }
            : { ok: false as const, error: typeof msg.error === 'string' ? msg.error : 'unavailable' }
      for (const waiter of waiters) waiter(row)
      return
    }
    if (msg.type === 'located' && typeof msg.conversationId === 'string') {
      const waiters = locateWaiters.get(msg.conversationId) ?? []
      locateWaiters.delete(msg.conversationId)
      const row =
        msg.ok === true
          ? { ok: true as const, workdir: typeof msg.workdir === 'string' ? msg.workdir : undefined }
          : { ok: false as const, error: typeof msg.error === 'string' ? msg.error : 'unavailable' }
      for (const waiter of waiters) waiter(row)
      return
    }
    if (msg.type === 'error' && typeof msg.conversationId === 'string') {
      const waiters = dirWaiters.get(msg.conversationId) ?? []
      if (waiters.length) {
        dirWaiters.delete(msg.conversationId)
        const error = typeof msg.message === 'string' && msg.message ? msg.message : String(msg.code || 'error')
        for (const waiter of waiters) waiter({ ok: false, error })
      }
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

  const daemonReady = async () => {
    const plane = transport.daemon
    if (!plane) return null
    try {
      return (await plane.ready()) ? plane : null
    } catch {
      return null
    }
  }

  const hostPairingUri = async (): Promise<string | null> => {
    const plane = await daemonReady()
    if (!plane) return null
    try {
      const row = (await plane.request('host.pairing')) as { pairing?: string | null }
      const pairing = typeof row.pairing === 'string' ? row.pairing.trim() : ''
      return pairing || null
    } catch {
      return null
    }
  }

  const remoteStatusOf = async (): Promise<RemoteControlStatus> => {
    const pairing = await hostPairingUri()
    return {
      state: pairing ? 'ready' : 'disabled',
      pairing,
      clients: [],
      devices: [],
      error: null
    }
  }

  const emitHosts = (): void => {
    const list = hostInfoFromRemote(host)
    for (const handler of hostHandlers) handler(list)
  }

  const emitRemoteStatus = (): void => {
    void remoteStatusOf().then((status) => {
      for (const handler of remoteStatusHandlers) handler(status)
    })
  }

  const rotateHostOffer = async (): Promise<void> => {
    const plane = await daemonReady()
    if (!plane) return
    try {
      await plane.request('host.rotateOffer')
    } catch {
      return
    }
    emitHosts()
    emitRemoteStatus()
  }

  const pullHostSettings = async (): Promise<void> => {
    const plane = await daemonReady()
    if (!plane) return
    try {
      const row = (await plane.request('settings.get')) as Partial<AppSettings>
      settings = {
        ...mergeHostSettings(settings, pickHostSettings(row)),
        ...pickSecretPresent(row)
      }
      emitSettings()
    } catch {
      /* keep client appearance */
    }
  }

  type LivePtyTab = {
    id: string
    stream: string
    conversationId: string
    title: string
    createdAt: number
    status: 'running' | 'idle' | 'exited'
  }
  const ptyTabs = new Map<string, LivePtyTab>()
  const ptyLayouts: Record<string, ConversationPtyLayouts> = {}
  const ptyData = new Set<(event: { tabId: string; data: string }) => void>()
  const ptyChanged = new Set<(event: { conversationId: string }) => void>()
  const ptyStatus = new Set<
    (event: { tabId: string; conversationId: string; status: 'running' | 'idle' | 'exited' }) => void
  >()
  type LiveFileWatch = { conversationId: string; root: string; stream: string }
  const fileWatches = new Map<string, LiveFileWatch>()
  const fileWatchByStream = new Map<string, LiveFileWatch>()
  const pendingDirtyDirs = new Map<string, Set<string>>()
  const dirtyTimers = new Map<string, number>()
  const dirtyHandlers = new Set<(event: { conversationId: string; dirs: string[] }) => void>()

  const emitFileDirty = (conversationId: string, dirs: string[]): void => {
    for (const handler of dirtyHandlers) handler({ conversationId, dirs })
  }

  const markFileDirty = (conversationId: string, dir: string): void => {
    let set = pendingDirtyDirs.get(conversationId)
    if (!set) {
      set = new Set()
      pendingDirtyDirs.set(conversationId, set)
    }
    set.add(dir)
    const existing = dirtyTimers.get(conversationId)
    if (existing) window.clearTimeout(existing)
    dirtyTimers.set(
      conversationId,
      window.setTimeout(() => {
        dirtyTimers.delete(conversationId)
        const next = [...(pendingDirtyDirs.get(conversationId) ?? [])]
        pendingDirtyDirs.delete(conversationId)
        if (next.length) emitFileDirty(conversationId, next)
      }, FILE_WATCH_DEBOUNCE_MS)
    )
  }

  const stopFileWatch = async (conversationId: string): Promise<void> => {
    const live = fileWatches.get(conversationId)
    const timer = dirtyTimers.get(conversationId)
    if (timer) window.clearTimeout(timer)
    dirtyTimers.delete(conversationId)
    pendingDirtyDirs.delete(conversationId)
    if (!live) return
    fileWatches.delete(conversationId)
    fileWatchByStream.delete(live.stream)
    const plane = await daemonReady()
    if (plane) await plane.request('fs.unwatch', { stream: live.stream }).catch(() => undefined)
  }

  const startFileWatch = async (conversationId: string, root: string | null): Promise<void> => {
    await stopFileWatch(conversationId)
    if (!root) return
    const plane = await daemonReady()
    if (!plane) return
    try {
      const started = (await plane.request('fs.watch', { path: root, recursive: true })) as {
        stream?: string
      }
      if (!started.stream) return
      const live = { conversationId, root, stream: started.stream }
      fileWatches.set(conversationId, live)
      fileWatchByStream.set(started.stream, live)
    } catch {
      /* unreadable roots stay unwatched, same as desktop FileService */
    }
  }

  const noteWatchEvent = (stream: string, data: unknown): void => {
    const live = fileWatchByStream.get(stream)
    if (!live) return
    const filename =
      data && typeof data === 'object' && 'filename' in data
        ? String((data as { filename?: unknown }).filename || '')
        : ''
    if (!filename) return
    if (isIgnoredName(hostPathBasename(filename))) return
    const full = hostPathJoin(live.root, filename)
    if (full.split(/[\\/]/).some((part) => isIgnoredName(part))) return
    markFileDirty(live.conversationId, hostPathDirname(full))
  }
  const incomingControllersOf = async (): Promise<IncomingController[]> => {
    const plane = await daemonReady()
    if (!plane) return []
    try {
      const row = (await plane.request('host.incoming')) as { controllers?: IncomingController[] }
      return Array.isArray(row.controllers) ? row.controllers : []
    } catch {
      return []
    }
  }

  const emitIncoming = (rows: IncomingController[]): void => {
    for (const handler of incomingHandlers) handler(rows)
  }

  transport.daemon?.onStream((event) => {
    if (event.stream === 'incoming' && event.event === 'changed') {
      const data = event.data && typeof event.data === 'object' ? (event.data as { controllers?: unknown }) : null
      if (Array.isArray(data?.controllers)) {
        emitIncoming(data.controllers as IncomingController[])
      }
      return
    }
    if (event.event === 'watch') {
      noteWatchEvent(event.stream, event.data)
      return
    }
    const tab = [...ptyTabs.values()].find((row) => row.stream === event.stream)
    if (!tab) return
    if (event.event === 'pty-data') {
      const text =
        event.data && typeof event.data === 'object' && 'text' in event.data && typeof event.data.text === 'string'
          ? event.data.text
          : ''
      for (const handler of ptyData) handler({ tabId: tab.id, data: text })
    }
    if (event.event === 'pty-exit') {
      tab.status = 'exited'
      for (const handler of ptyStatus) {
        handler({ tabId: tab.id, conversationId: tab.conversationId, status: 'exited' })
      }
      for (const handler of ptyChanged) handler({ conversationId: tab.conversationId })
    }
  })

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

  const api = definePhoneVavApi({
    platform: resolvedHostPlatform(currentHost()?.platform),
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
        platform: resolvedHostPlatform(host?.platform),
        home: host?.home || '',
        tmp: host?.tmp || '',
        about: {
          version: '1.19.0',
          vavServerVersion: '1.19.0',
          buildNumber: '1.19.0',
          electron: '',
          userDataPath: '',
          conversationsPath: ''
        },
        hosts: hostInfoFromRemote(host)
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
      get: async () => {
        await pullHostSettings()
        return settings
      },
      update: async (patch: Partial<typeof settings>) => {
        const prevFav = new Set(settings.favoriteConversationIds ?? [])
        const hostPatch = pickHostSettings(patch)
        const localPatch = omitHostSettings(patch)
        settings = { ...settings, ...localPatch, ...hostPatch }
        emitSettings()
        const nextFav = new Set(settings.favoriteConversationIds ?? [])
        for (const id of nextFav) {
          if (!prevFav.has(id)) send({ type: 'favorite', conversationId: id, favorite: true })
        }
        for (const id of prevFav) {
          if (!nextFav.has(id)) send({ type: 'favorite', conversationId: id, favorite: false })
        }
        if (Object.keys(hostPatch).length) {
          const plane = await daemonReady()
          if (plane) {
            try {
              const next = (await plane.request('settings.update', hostPatch)) as Partial<AppSettings>
              settings = mergeHostSettings(settings, pickHostSettings(next))
              emitSettings()
            } catch {
              /* keep optimistic client merge */
            }
          }
        }
        return settings
      },
      reset: async () => settings,
      setApiKey: async (key) => {
        const plane = await daemonReady()
        if (!plane) return { hint: null }
        const row = (await plane.request('settings.setSecret', { slot: 'api', value: key })) as {
          hint?: string | null
          apiKeyPresent?: boolean
        }
        settings = { ...settings, apiKeyPresent: row.apiKeyPresent ?? Boolean(String(key ?? '').trim()) }
        emitSettings()
        return { hint: row.hint ?? null }
      },
      revealApiKey: async () => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('settings.revealSecret', { slot: 'api' })) as { key?: string | null }
        return row.key ?? null
      },
      apiKeyHint: async () => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('settings.secretHint', { slot: 'api' })) as { hint?: string | null }
        return row.hint ?? null
      },
      setBraveSearchKey: async (key) => {
        const plane = await daemonReady()
        if (!plane) return { hint: null }
        const row = (await plane.request('settings.setSecret', {
          slot: 'braveSearch',
          value: key
        })) as { hint?: string | null }
        return { hint: row.hint ?? null }
      },
      braveSearchKeyHint: async () => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('settings.secretHint', { slot: 'braveSearch' })) as {
          hint?: string | null
        }
        return row.hint ?? null
      },
      setTinyfishSearchKey: async (key) => {
        const plane = await daemonReady()
        if (!plane) return { hint: null }
        const row = (await plane.request('settings.setSecret', { slot: 'tinyfish', value: key })) as {
          hint?: string | null
        }
        return { hint: row.hint ?? null }
      },
      tinyfishSearchKeyHint: async () => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('settings.secretHint', { slot: 'tinyfish' })) as {
          hint?: string | null
        }
        return row.hint ?? null
      },
      setCloudflareApiToken: async (token) => {
        const plane = await daemonReady()
        if (!plane) return { hint: null }
        const row = (await plane.request('settings.setSecret', {
          slot: 'cloudflare',
          value: token
        })) as { hint?: string | null }
        settings = { ...settings, cloudflareApiTokenPresent: Boolean(String(token ?? '').trim()) }
        emitSettings()
        return { hint: row.hint ?? null }
      },
      cloudflareApiTokenHint: async () => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('settings.secretHint', { slot: 'cloudflare' })) as {
          hint?: string | null
        }
        return row.hint ?? null
      },
      setSupabaseAccessToken: async (token) => {
        const plane = await daemonReady()
        if (!plane) return { hint: null }
        const row = (await plane.request('settings.setSecret', {
          slot: 'supabase',
          value: token
        })) as { hint?: string | null }
        settings = { ...settings, supabaseAccessTokenPresent: Boolean(String(token ?? '').trim()) }
        emitSettings()
        return { hint: row.hint ?? null }
      },
      supabaseAccessTokenHint: async () => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('settings.secretHint', { slot: 'supabase' })) as {
          hint?: string | null
        }
        return row.hint ?? null
      },
      setVercelApiToken: async (token) => {
        const plane = await daemonReady()
        if (!plane) return { hint: null }
        const row = (await plane.request('settings.setSecret', { slot: 'vercel', value: token })) as {
          hint?: string | null
        }
        settings = { ...settings, vercelApiTokenPresent: Boolean(String(token ?? '').trim()) }
        emitSettings()
        return { hint: row.hint ?? null }
      },
      vercelApiTokenHint: async () => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('settings.secretHint', { slot: 'vercel' })) as {
          hint?: string | null
        }
        return row.hint ?? null
      },
      validateKey: async () => ({ ok: true }),
      availableFonts: async () => browserCodeFonts(host?.platform),
      pickDirectory: async () =>
        new Promise<string | null>((resolve) => {
          const done = (event: Event): void => {
            window.removeEventListener('vav:phone-folder-picked', done)
            const path = (event as CustomEvent<{ path?: string | null }>).detail?.path
            resolve(typeof path === 'string' && path ? path : null)
          }
          window.addEventListener('vav:phone-folder-picked', done)
          window.dispatchEvent(new CustomEvent('vav:phone-pick-folder', { detail: { purpose: 'directory' } }))
          window.setTimeout(() => {
            window.removeEventListener('vav:phone-folder-picked', done)
            resolve(null)
          }, 120_000)
        }),
      pickColor: async (defaultHex) => pickBrowserColor(defaultHex),
      pickSurfacePatternImage: async () => {
        const file = await pickBrowserFile('image/png,image/webp,.png')
        if (!file) return null
        const imported = await importBrowserSurfacePattern(file)
        if (!imported.ok) return imported
        settings = {
          ...settings,
          surfacePattern: 'custom',
          customSurfacePatternUrl: imported.url,
          customSurfacePatternSize: imported.size
        }
        emitSettings()
        return imported
      },
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
      query: async (query) => {
        const plane = await daemonReady()
        if (!plane) return []
        try {
          const body = (await plane.request('logs.query', query ?? {})) as { records?: unknown[] }
          return Array.isArray(body.records) ? (body.records as Awaited<ReturnType<VavApi['logs']['query']>>) : []
        } catch {
          return []
        }
      },
      stats: async () => {
        const plane = await daemonReady()
        if (!plane) return { ephemeral: 0, session: 0, durable: 0, total: 0 }
        try {
          return (await plane.request('logs.stats')) as Awaited<ReturnType<VavApi['logs']['stats']>>
        } catch {
          return { ephemeral: 0, session: 0, durable: 0, total: 0 }
        }
      },
      clear: async (scope) => {
        const plane = await daemonReady()
        if (!plane) return { removed: 0 }
        try {
          return (await plane.request('logs.clear', { scope })) as { removed: number }
        } catch {
          return { removed: 0 }
        }
      },
      export: async (query) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          const body = (await plane.request('logs.export', query ?? {})) as { text?: string }
          const text = body.text ?? ''
          const blob = new Blob([text], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          const path = `vav-logs-${Date.now()}.txt`
          anchor.href = url
          anchor.download = path
          anchor.click()
          URL.revokeObjectURL(url)
          return { ok: true as const, path }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : 'export failed' }
        }
      },
      record: async (input) => {
        const plane = await daemonReady()
        if (!plane) return
        try {
          await plane.request('logs.record', input)
        } catch {
          /* optional */
        }
      },
      onChanged: (handler) => {
        let off = (): void => undefined
        void daemonReady().then((plane) => {
          if (!plane) return
          off = plane.onStream((event) => {
            if (event.event === 'append' && event.data) {
              handler(event.data as Parameters<Parameters<VavApi['logs']['onChanged']>[0]>[0])
            }
          })
          void plane.request('logs.subscribe').catch(() => undefined)
        })
        return () => off()
      }
    },
    accounts: {
      getPage: async (workspaceKey) => {
        const page = await pageFromDaemon(workspaceKey)
        if (page) {
          emitAccounts()
          return page
        }
        return currentAccountPage()
      },
      createVav: async (input) => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        const page = (await plane.request('accounts.createVav', input)) as AccountsPagePayload
        lastAccountPage = page
        emitAccounts()
        return page
      },
      createDraft: async (input) => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        const row = (await plane.request('accounts.createDraft', input)) as {
          page: AccountsPagePayload
          id: string
        }
        lastAccountPage = row.page
        emitAccounts()
        return row
      },
      updateVav: async (id, patch) => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        const page = (await plane.request('accounts.updateVav', { id, ...patch })) as AccountsPagePayload
        lastAccountPage = page
        emitAccounts()
        return page
      },
      setCurrent: async (id) => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        const page = (await plane.request('accounts.setCurrent', { id })) as AccountsPagePayload
        lastAccountPage = page
        emitAccounts()
        return page
      },
      activate: async (id) => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        const row = (await plane.request('accounts.activate', { id })) as {
          page: AccountsPagePayload
          result: { ok?: boolean }
        }
        lastAccountPage = row.page
        emitAccounts()
        return row as Awaited<ReturnType<VavApi['accounts']['activate']>>
      },
      remove: async (id) => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        const page = (await plane.request('accounts.remove', { id })) as AccountsPagePayload
        lastAccountPage = page
        emitAccounts()
        return page
      },
      verify: async (id, apiKey) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false, message: 'unavailable' }
        return (await plane.request('accounts.verify', { id, apiKey })) as {
          ok: boolean
          message: string
          authFailed?: boolean
        }
      },
      revealKey: async (id) => {
        const plane = await daemonReady()
        if (!plane) return null
        const row = (await plane.request('accounts.revealKey', { id })) as { key?: string | null }
        return row.key ?? null
      },
      beginOAuth: async (agentId, accountId) => {
        const plane = await daemonReady()
        if (!plane) return currentAccountPage()
        lastAccountPage = (await plane.request('accounts.beginOAuth', {
          agentId,
          accountId
        })) as AccountsPagePayload
        emitAccounts()
        return lastAccountPage
      },
      cancelOAuth: async (agentId) => {
        const plane = await daemonReady()
        if (!plane) return currentAccountPage()
        lastAccountPage = (await plane.request('accounts.cancelOAuth', { agentId })) as AccountsPagePayload
        emitAccounts()
        return lastAccountPage
      },
      signOut: async (agentId) => {
        const plane = await daemonReady()
        if (!plane) return currentAccountPage()
        lastAccountPage = (await plane.request('accounts.signOut', { agentId })) as AccountsPagePayload
        emitAccounts()
        return lastAccountPage
      }
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
        const conversation = conversationFromRemoteThread(meta, messages)
        const plane = await daemonReady()
        if (!plane) return conversation
        try {
          const row = (await plane.request('sessions.get', { id })) as {
            conversation?: { fileId?: string | null; fileReadOnly?: boolean; title?: string }
          }
          const fileId = row.conversation?.fileId
          if (!fileId) return conversation
          return {
            ...conversation,
            fileId,
            sessionKind: 'file' as const,
            fileReadOnly: row.conversation?.fileReadOnly === true,
            title: row.conversation?.title || conversation.title
          }
        } catch {
          return conversation
        }
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
      pickWorkingDirectory: async (id: string) => {
        window.dispatchEvent(
          new CustomEvent('vav:phone-pick-folder', { detail: { conversationId: id, purpose: 'workdir' } })
        )
        return null
      },
      useTempWorkingDirectory: async (id: string) => {
        send({ type: 'workspace', conversationId: id, temp: true })
        return conversationsOf()
      },
      locateWorkspace: async (id: string, destinationDir: string) => {
        const pending = waitFor<{ ok: true; workdir?: string } | { ok: false; error: string }>(
          (resolve) => {
            const list = locateWaiters.get(id) ?? []
            list.push(resolve)
            locateWaiters.set(id, list)
          }
        )
        send({ type: 'locate', conversationId: id, destinationDir })
        const row = await pending.catch(() => ({ ok: false as const, error: 'timeout' }))
        return row.ok
          ? { ok: true as const, conversations: conversationsOf() }
          : { ok: false as const, error: row.error, conversations: conversationsOf() }
      },
      remove: async (ids: string[]) => {
        const list = Array.isArray(ids) ? ids : []
        for (const id of list) send({ type: 'archive', conversationId: id })
        return { removed: list, conversations: conversationsOf() }
      },
      deleteMessage: async (id: string, messageId: string) => {
        const pending = waitFor<RemoteThreadMessage[]>((resolve) => {
          const list = threadWaiters.get(id) ?? []
          list.push(resolve)
          threadWaiters.set(id, list)
        })
        send({ type: 'delete-message', conversationId: id, messageId })
        const rows = await pending.catch(() => null)
        if (!rows) return null
        const messages = chatMessagesFromRemoteThread(rows)
        return {
          conversations: conversationsOf(),
          messages,
          activeLeafId: messages.at(-1)?.id ?? null
        }
      },
      revealInFinder: async (path: string) => {
        const plane = await daemonReady()
        if (!plane || !path) return
        await plane.request('fs.reveal', { path }).catch(() => undefined)
      },
      copyToClipboard: async (text: string) => {
        await navigator.clipboard?.writeText(text)
      },
      readClipboard: async () => navigator.clipboard?.readText() ?? '',
      copyImageToClipboard: async (base64Png: string) => {
        try {
          const raw = typeof base64Png === 'string' ? base64Png.trim() : ''
          if (!raw) return { ok: false as const, error: 'empty image' }
          const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
          const binary = atob(b64)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          const blob = new Blob([bytes], { type: 'image/png' })
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          return { ok: true as const }
        } catch (err) {
          return {
            ok: false as const,
            error: err instanceof Error ? err.message : String(err)
          }
        }
      },
      readClipboardImage: async () => {
        try {
          const items = await navigator.clipboard.read()
          for (const item of items) {
            const type = item.types.find((row) => row.startsWith('image/'))
            if (!type) continue
            const blob = await item.getType(type)
            const buf = new Uint8Array(await blob.arrayBuffer())
            const plane = await daemonReady()
            const root = (host?.tmp || '').replace(/\/$/, '')
            if (!plane || !root) return { ok: false as const, error: 'unavailable' }
            const hash = await clipHash16(buf)
            const { dir, dest } = clipDest(clipRootOf(root), hash, clipDisplayName('paste.png'))
            await plane.request('fs.mkdir', { path: dir, recursive: true })
            let binary = ''
            const chunk = 0x8000
            for (let i = 0; i < buf.length; i += chunk) {
              binary += String.fromCharCode(...buf.subarray(i, i + chunk))
            }
            await plane.request('fs.writeFile', { path: dest, base64: btoa(binary) })
            return { ok: true as const, path: dest, bytes: buf.length }
          }
          return { ok: false as const, error: 'empty' }
        } catch (err) {
          return {
            ok: false as const,
            error: err instanceof Error ? err.message : String(err)
          }
        }
      },
      selectBranch: async (id: string, messageId: string) => {
        const pending = waitFor<RemoteThreadMessage[]>((resolve) => {
          const list = threadWaiters.get(id) ?? []
          list.push(resolve)
          threadWaiters.set(id, list)
        })
        send({ type: 'leaf', conversationId: id, messageId, follow: true })
        const rows = await pending.catch(() => null)
        if (!rows) return null
        return chatMessagesFromRemoteThread(rows).at(-1)?.id ?? null
      },
      setLeaf: async (id: string, leafId: string) => {
        send({ type: 'leaf', conversationId: id, messageId: leafId })
      },
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
      setAcpGoal: async (
        id: string,
        action: 'set' | 'pause' | 'resume' | 'clear',
        objective?: string
      ) => {
        const pending = waitFor<
          | { ok: true; via: 'rpc' }
          | { ok: true; via: 'slash'; text: string }
          | { ok: false; error: string }
        >((resolve) => {
          const list = goalWaiters.get(id) ?? []
          list.push(resolve)
          goalWaiters.set(id, list)
        })
        send({
          type: 'goal',
          conversationId: id,
          action,
          ...(objective ? { objective } : {})
        })
        const row = await pending.catch(() => ({ ok: false as const, error: 'timeout' }))
        if (!row.ok) return { ok: false as const, error: row.error, conversations: conversationsOf() }
        return row.via === 'slash'
          ? { ok: true as const, via: 'slash' as const, text: row.text, conversations: conversationsOf() }
          : { ok: true as const, via: 'rpc' as const, conversations: conversationsOf() }
      },
      continueInNewSession: async (id: string, messageId: string) => {
        const created = waitFor<RemoteSession>((resolve) => createdWaiters.push(resolve))
        send({ type: 'continue', conversationId: id, messageId })
        const session = await created.catch(() => null)
        if (!session) return null
        return conversationFromRemoteSession(session, controls[session.id], host)
      },
      duplicate: async (id: string) => {
        const created = waitFor<RemoteSession>((resolve) => createdWaiters.push(resolve))
        send({ type: 'duplicate', conversationId: id })
        const session = await created.catch(() => null)
        if (!session) return null
        return conversationFromRemoteSession(session, controls[session.id], host)
      },
      exportPack: async (ids: string[]) => {
        const picked = ids.length ? ids : sessions.map((session) => session.id)
        const payload = {
          version: 1,
          exportedAt: Date.now(),
          conversations: picked.map((id) => ({
            session: sessions.find((session) => session.id === id) ?? { id },
            thread: threads[id] ?? []
          }))
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        const path = `vav-sessions-${Date.now()}.json`
        anchor.href = url
        anchor.download = path
        anchor.click()
        URL.revokeObjectURL(url)
        return { ok: true as const, path, blobCount: 0, conversationCount: picked.length }
      },
      importPack: async () => {
        const file = await new Promise<File | null>((resolve) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.json,.vavpack,.zip'
          input.onchange = () => resolve(input.files?.[0] ?? null)
          input.click()
        })
        if (!file) return { ok: false as const, cancelled: true }
        try {
          const payload = JSON.parse(await file.text()) as {
            conversations?: Array<{ session?: { title?: string } }>
          }
          const importedIds: string[] = []
          for (const row of payload.conversations ?? []) {
            const created = waitFor<RemoteSession>((resolve) => createdWaiters.push(resolve))
            send({ type: 'create' })
            const session = await created.catch(() => null)
            if (!session) continue
            const title = row.session?.title?.trim()
            if (title) send({ type: 'rename', conversationId: session.id, title })
            importedIds.push(session.id)
          }
          return { ok: true as const, importedIds, path: file.name, blobCount: 0 }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : 'invalid pack' }
        }
      },
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
      regenerate: async (conversationId: string, messageId: string) => {
        send({ type: 'regenerate', conversationId, messageId })
      },
      editUserMessage: async (id: string, messageId: string, text: string) => {
        send({ type: 'edit', conversationId: id, messageId, text })
      },
      fork: async (id: string, messageId: string) => {
        const pending = waitFor<RemoteThreadMessage[]>((resolve) => {
          const list = threadWaiters.get(id) ?? []
          list.push(resolve)
          threadWaiters.set(id, list)
        })
        send({ type: 'fork', conversationId: id, messageId })
        const rows = await pending.catch(() => null)
        if (!rows) return null
        return chatMessagesFromRemoteThread(rows).at(-1)?.id ?? '@root'
      },
      compact: async (conversationId: string, options?: { keepAfterMessageId?: string | null }) => {
        const result = waitFor<{ ok: boolean; error?: string; compaction?: LeafCompaction }>((resolve) => {
          const list = compactWaiters.get(conversationId) ?? []
          list.push(resolve)
          compactWaiters.set(conversationId, list)
        })
        send({
          type: 'compact',
          conversationId,
          ...(options?.keepAfterMessageId ? { keepAfterMessageId: options.keepAfterMessageId } : {})
        })
        const row = await result.catch(() => ({ ok: false as const, error: 'timeout' }))
        if (!row.ok || !row.compaction) {
          return { ok: false as const, error: row.error || 'unavailable' }
        }
        return { ok: true as const, compaction: row.compaction }
      },
      clearCompaction: async (conversationId: string, leafId: string) => {
        const result = waitFor<{ ok: boolean; error?: string }>((resolve) => {
          const list = compactWaiters.get(conversationId) ?? []
          list.push(resolve)
          compactWaiters.set(conversationId, list)
        })
        send({ type: 'clear-compaction', conversationId, leafId })
        const row = await result.catch(() => ({ ok: false as const, error: 'timeout' }))
        return row.ok ? { ok: true as const } : { ok: false as const, error: row.error || 'unavailable' }
      },
      onEvent: (handler: TurnHandler) => {
        turnHandlers.add(handler)
        return () => turnHandlers.delete(handler)
      },
      onCompactionsChanged: () => () => undefined
    },
    agents: {
      getModelCatalog: async () => catalogOf(),
      preloadModels: async () => catalogOf(),
      onModelCatalogChanged: (handler) => {
        catalogHandlers.add(handler)
        handler(catalogOf())
        return () => catalogHandlers.delete(handler)
      },
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
      openSettings: async (view?: SettingsView, agentId?: string, machineId?: string) => {
        desiredSettings = {
          view: view ?? 'appearance',
          ...(agentId ? { agentId } : {}),
          ...(machineId ? { machineId } : {})
        }
        for (const handler of settingsViewHandlers) handler(desiredSettings)
        window.dispatchEvent(new CustomEvent('vav:phone-open-settings', { detail: desiredSettings }))
      },
      closeSettings: async () => {
        window.dispatchEvent(new CustomEvent('vav:phone-close-settings'))
      },
      desiredSettingsView: async () => desiredSettings,
      openSession: async () => undefined,
      revealInList: async () => undefined,
      closeDetachedSession: async () => undefined,
      newDetachedSession: async () => undefined,
      listDetachedSessions: async () => [],
      popupMenu: (items: NativeMenuItem[], position?: { x: number; y: number }) =>
        showDomMenu(items, position),
      closePopupMenu: async () => undefined,
      openTokenUsage: async () => undefined,
      openFilePreview: async (path: string) => {
        const resolved = String(path || '').trim()
        if (!resolved) return
        window.dispatchEvent(new CustomEvent('vav:phone-open-file-preview', { detail: { path: resolved } }))
      },
      setPreviewCloseGuard: async () => undefined,
      forcePreviewClose: async () => undefined,
      onPreviewCloseAttempt: () => () => undefined
    },
    connectors: {
      catalog: async () => {
        const plane = await daemonReady()
        if (!plane) return []
        try {
          return (await plane.request('connectors.catalog')) as Awaited<
            ReturnType<VavApi['connectors']['catalog']>
          >
        } catch {
          return []
        }
      },
      probe: async (cwd) => {
        const plane = await daemonReady()
        if (!plane) return []
        try {
          return (await plane.request('connectors.probe', { cwd })) as Awaited<
            ReturnType<VavApi['connectors']['probe']>
          >
        } catch {
          return []
        }
      },
      act: async (request) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('connectors.act', { request })) as Awaited<
            ReturnType<VavApi['connectors']['act']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      authStatus: async () => {
        const plane = await daemonReady()
        if (!plane) return { rows: [], login: { connector: null, status: 'idle' as const } }
        try {
          return (await plane.request('connectors.authStatus')) as Awaited<
            ReturnType<VavApi['connectors']['authStatus']>
          >
        } catch {
          return { rows: [], login: { connector: null, status: 'idle' as const } }
        }
      },
      beginLogin: async (id) => {
        const plane = await daemonReady()
        if (!plane) {
          return {
            rows: [],
            login: { connector: null, status: 'error' as const, message: 'unavailable' }
          }
        }
        try {
          return (await plane.request('connectors.beginLogin', { id })) as Awaited<
            ReturnType<VavApi['connectors']['beginLogin']>
          >
        } catch (err) {
          return {
            rows: [],
            login: { connector: null, status: 'error' as const, message: (err as Error).message }
          }
        }
      },
      cancelLogin: async (id) => {
        const plane = await daemonReady()
        if (!plane) return { rows: [], login: { connector: null, status: 'idle' as const } }
        try {
          return (await plane.request('connectors.cancelLogin', { id })) as Awaited<
            ReturnType<VavApi['connectors']['cancelLogin']>
          >
        } catch {
          return { rows: [], login: { connector: null, status: 'idle' as const } }
        }
      }
    },
    plugins: {
      list: async (host) => {
        const plane = await daemonReady()
        if (!plane) return emptyPluginSnapshot(pluginHostKind(host))
        try {
          return (await plane.request('plugins.list', { host })) as Awaited<
            ReturnType<VavApi['plugins']['list']>
          >
        } catch {
          return emptyPluginSnapshot(pluginHostKind(host))
        }
      },
      setEnabled: async (host, pluginId, enabled) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return unwrapPluginMutation(
            await plane.request('plugins.setEnabled', {
              host,
              pluginId,
              enabled
            })
          )
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      create: async (kind, name) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return unwrapPluginMutation(await plane.request('plugins.create', { kind, name }))
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      write: async (path, content) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return unwrapPluginMutation(await plane.request('plugins.write', { path, content }))
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      }
    },
    git: {
      status: async (cwd: string, conversationId?: string) => {
        const plane = await daemonReady()
        if (!plane) return emptyGitSnapshot(cwd)
        try {
          return (await plane.request('git.status', { cwd, conversationId })) as Awaited<
            ReturnType<VavApi['git']['status']>
          >
        } catch (err) {
          return { ...emptyGitSnapshot(cwd), error: (err as Error).message }
        }
      },
      diff: async (cwd, path, opts) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.diff', {
            cwd,
            path,
            staged: opts?.staged,
            conversationId: opts?.conversationId
          })) as Awaited<ReturnType<VavApi['git']['diff']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      showBase64: async (cwd, path, ref, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.showBase64', {
            cwd,
            path,
            ref,
            conversationId
          })) as Awaited<ReturnType<VavApi['git']['showBase64']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      init: async (cwd, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.init', { cwd, conversationId })) as Awaited<
            ReturnType<VavApi['git']['init']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      log: async (cwd, opts) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.log', {
            cwd,
            limit: opts?.limit,
            conversationId: opts?.conversationId
          })) as Awaited<ReturnType<VavApi['git']['log']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      branches: async (cwd, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.branches', { cwd, conversationId })) as Awaited<
            ReturnType<VavApi['git']['branches']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      stashes: async (cwd, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.stashes', { cwd, conversationId })) as Awaited<
            ReturnType<VavApi['git']['stashes']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      patch: async (cwd, spec, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.patch', { cwd, spec, conversationId })) as Awaited<
            ReturnType<VavApi['git']['patch']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      createBranch: async (cwd, name, opts) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.createBranch', {
            cwd,
            name,
            checkout: opts?.checkout,
            startPoint: opts?.startPoint,
            conversationId: opts?.conversationId
          })) as Awaited<ReturnType<VavApi['git']['createBranch']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      checkoutBranch: async (cwd, name, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.checkoutBranch', {
            cwd,
            name,
            conversationId
          })) as Awaited<ReturnType<VavApi['git']['checkoutBranch']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      deleteBranch: async (cwd, name, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.deleteBranch', {
            cwd,
            name,
            conversationId
          })) as Awaited<ReturnType<VavApi['git']['deleteBranch']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      createWorktree: async (cwd, options, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.createWorktree', {
            cwd,
            ...options,
            conversationId
          })) as Awaited<ReturnType<VavApi['git']['createWorktree']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      stashPush: async (cwd, opts) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.stashPush', {
            cwd,
            message: opts?.message,
            conversationId: opts?.conversationId
          })) as Awaited<ReturnType<VavApi['git']['stashPush']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      stashApply: async (cwd, index, opts) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.stashApply', {
            cwd,
            index,
            pop: opts?.pop,
            conversationId: opts?.conversationId
          })) as Awaited<ReturnType<VavApi['git']['stashApply']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      stashDrop: async (cwd, index, conversationId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('git.stashDrop', {
            cwd,
            index,
            conversationId
          })) as Awaited<ReturnType<VavApi['git']['stashDrop']>>
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      }
    },
    github: {
      listPulls: async (cwd, state) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('github.listPulls', { cwd, state })) as Awaited<
            ReturnType<VavApi['github']['listPulls']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      getPull: async (cwd, number) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('github.getPull', { cwd, number })) as Awaited<
            ReturnType<VavApi['github']['getPull']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      listActions: async (cwd, scope) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('github.listActions', { cwd, scope })) as Awaited<
            ReturnType<VavApi['github']['listActions']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      getActionRun: async (cwd, runId) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('github.getActionRun', { cwd, runId })) as Awaited<
            ReturnType<VavApi['github']['getActionRun']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      getSite: async (cwd) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('github.getSite', { cwd })) as Awaited<
            ReturnType<VavApi['github']['getSite']>
          >
        } catch (err) {
          return { ok: false as const, error: 'unavailable' }
        }
      },
      listReleases: async (cwd) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('github.listReleases', { cwd })) as Awaited<
            ReturnType<VavApi['github']['listReleases']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      }
    },
    supabase: {
      status: async (cwd, query) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('supabase.status', { cwd, query })) as Awaited<
            ReturnType<VavApi['supabase']['status']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      }
    },
    cloudflare: {
      status: async (cwd, query) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          return (await plane.request('cloudflare.status', { cwd, query })) as Awaited<
            ReturnType<VavApi['cloudflare']['status']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      }
    },
    vercel: {
      status: async (cwd, query) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable', code: 'network' as const }
        try {
          return (await plane.request('vercel.status', { cwd, query })) as Awaited<
            ReturnType<VavApi['vercel']['status']>
          >
        } catch (err) {
          return { ok: false as const, error: (err as Error).message, code: 'network' as const }
        }
      }
    },
    timers: {
      listJobs: async () => {
        const plane = await daemonReady()
        if (!plane) return []
        try {
          return (await plane.request('timers.listJobs')) as Awaited<
            ReturnType<VavApi['timers']['listJobs']>
          >
        } catch {
          return []
        }
      },
      createScheduled: async () => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        return (await plane.request('timers.createScheduled')) as Awaited<
          ReturnType<VavApi['timers']['createScheduled']>
        >
      },
      getJobForConversation: async (conversationId) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('timers.getJobForConversation', { conversationId })) as Awaited<
            ReturnType<VavApi['timers']['getJobForConversation']>
          >
        } catch {
          return null
        }
      },
      createJob: async (input) => {
        const plane = await daemonReady()
        if (!plane) throw new Error('unavailable')
        return (await plane.request('timers.createJob', { input })) as Awaited<
          ReturnType<VavApi['timers']['createJob']>
        >
      },
      updateJob: async (id, patch) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('timers.updateJob', { id, patch })) as Awaited<
            ReturnType<VavApi['timers']['updateJob']>
          >
        } catch {
          return null
        }
      },
      removeJob: async (id) => {
        const plane = await daemonReady()
        if (!plane) return false
        try {
          return (await plane.request('timers.removeJob', { id })) as Awaited<
            ReturnType<VavApi['timers']['removeJob']>
          >
        } catch {
          return false
        }
      },
      runNow: async (id) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('timers.runNow', { id })) as Awaited<
            ReturnType<VavApi['timers']['runNow']>
          >
        } catch {
          return null
        }
      },
      listRuns: async (jobId) => {
        const plane = await daemonReady()
        if (!plane) return []
        try {
          return (await plane.request('timers.listRuns', { jobId })) as Awaited<
            ReturnType<VavApi['timers']['listRuns']>
          >
        } catch {
          return []
        }
      },
      listSessions: async () => {
        const plane = await daemonReady()
        if (!plane) return []
        try {
          return (await plane.request('timers.listSessions')) as Awaited<
            ReturnType<VavApi['timers']['listSessions']>
          >
        } catch {
          return []
        }
      },
      onChanged: () => () => undefined
    },
    fileSessions: {
      open: async (path: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('fileSessions.open', { path })) as Awaited<
            ReturnType<VavApi['fileSessions']['open']>
          >
        } catch {
          return null
        }
      },
      create: async (path: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('fileSessions.create', { path })) as Awaited<
            ReturnType<VavApi['fileSessions']['create']>
          >
        } catch {
          return null
        }
      },
      setActive: async (fileId: string, sessionId: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('fileSessions.setActive', { fileId, sessionId })) as Awaited<
            ReturnType<VavApi['fileSessions']['setActive']>
          >
        } catch {
          return null
        }
      },
      list: async (fileId: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('fileSessions.list', { fileId })) as Awaited<
            ReturnType<VavApi['fileSessions']['list']>
          >
        } catch {
          return null
        }
      },
      listAll: async () => {
        const plane = await daemonReady()
        if (!plane) return []
        try {
          return (await plane.request('fileSessions.listAll')) as Awaited<
            ReturnType<VavApi['fileSessions']['listAll']>
          >
        } catch {
          return []
        }
      },
      resolve: async (fileId: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('fileSessions.resolve', { fileId })) as Awaited<
            ReturnType<VavApi['fileSessions']['resolve']>
          >
        } catch {
          return null
        }
      },
      setReadOnly: async (sessionId: string, readOnly: boolean) => {
        const plane = await daemonReady()
        if (!plane) return
        try {
          await plane.request('fileSessions.setReadOnly', { sessionId, readOnly })
        } catch {
          /* optional */
        }
      },
      onReadOnlyChanged: () => () => undefined,
      rename: async (fileId: string, sessionId: string, title: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('fileSessions.rename', { fileId, sessionId, title })) as Awaited<
            ReturnType<VavApi['fileSessions']['rename']>
          >
        } catch {
          return null
        }
      },
      delete: async (fileId: string, sessionIds: string[]) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('fileSessions.delete', { fileId, sessionIds })) as Awaited<
            ReturnType<VavApi['fileSessions']['delete']>
          >
        } catch {
          return null
        }
      },
      forceDelete: async (fileId: string, sessionIds: string[]) => {
        const plane = await daemonReady()
        if (!plane) return { ok: true, removed: [] }
        try {
          return (await plane.request('fileSessions.forceDelete', { fileId, sessionIds })) as Awaited<
            ReturnType<VavApi['fileSessions']['forceDelete']>
          >
        } catch {
          return { ok: true, removed: [] }
        }
      }
    },
    files: {
      list: async (path: string, sort: FileSortKey, ascending: boolean, conversationId?: string) => {
        const plane = await daemonReady()
        if (plane && path) {
          try {
            const listed = (await plane.request('fs.readdir', { path })) as {
              entries?: Array<{ name?: string; isDirectory?: boolean }>
            }
            const visible = (listed.entries ?? []).filter(
              (entry) => typeof entry.name === 'string' && !isIgnoredName(entry.name)
            )
            const slice = visible.slice(0, DIRECTORY_ENTRY_CAP)
            return {
              path,
              entries: fileEntriesFromRemoteDirs(
                slice.map((entry) => ({
                  name: entry.name as string,
                  path: path.endsWith('/') ? `${path}${entry.name}` : `${path}/${entry.name}`,
                  isDirectory: entry.isDirectory === true
                })),
                sort,
                ascending
              ),
              truncated: Math.max(0, visible.length - slice.length)
            }
          } catch (err) {
            return { path, entries: [], truncated: 0, error: (err as Error).message }
          }
        }
        const id = conversationId || sessions[0]?.id
        if (!id) return { path, entries: [], truncated: 0, error: 'no session' }
        const result = await waitFor<DirResult>((resolve) => {
          const list = dirWaiters.get(id) ?? []
          list.push(resolve)
          dirWaiters.set(id, list)
          send({
            type: 'browse',
            conversationId: id,
            ...(path ? { path } : {}),
            files: true
          })
        }).catch(() => null)
        if (!result) return { path, entries: [], truncated: 0, error: 'timeout' }
        if (!result.ok) return { path, entries: [], truncated: 0, error: result.error }
        return {
          path: result.event.path || path,
          entries: fileEntriesFromRemoteDirs(result.event.entries ?? [], sort, ascending),
          truncated: 0
        }
      },
      read: async (path: string) => {
        const plane = await daemonReady()
        if (!plane) return { content: '', truncated: false, error: 'unavailable' }
        try {
          const body = (await plane.request('fs.readFile', { path })) as { base64?: string }
          return { content: decodeBase64Utf8(body.base64 || ''), truncated: false }
        } catch (err) {
          return { content: '', truncated: false, error: (err as Error).message }
        }
      },
      inspect: async (path: string) => {
        const name = path.split(/[/\\]/).filter(Boolean).pop() || path
        const plane = await daemonReady()
        if (!plane || !path) {
          return { path, name, size: 0, kind: 'binary' as const, mime: '', error: 'unavailable' }
        }
        try {
          const stat = (await plane.request('fs.stat', { path })) as {
            size?: number
            mtimeMs?: number
            isDirectory?: boolean
          }
          if (stat.isDirectory) {
            return {
              path,
              name,
              size: 0,
              mtimeMs: Number(stat.mtimeMs) || 0,
              kind: 'directory' as const,
              mime: 'inode/directory'
            }
          }
          const kind = previewKind(name)
          const mime = mimeForPreviewKind(name, kind)
          const size = Number(stat.size) || 0
          const mtimeMs = Number(stat.mtimeMs) || 0
          const base: FileInspectResult = { path, name, size, mtimeMs, kind, mime }
          if (kind === 'text' || kind === 'csv' || kind === 'html' || kind === 'html-clip') {
            const body = (await plane.request('fs.readFile', { path })) as { base64?: string }
            const text = decodeBase64Utf8(body.base64 || '')
            return {
              ...base,
              text,
              lineCount: text ? text.split(/\r\n|\n|\r/).length : 0
            }
          }
          return base
        } catch (err) {
          return {
            path,
            name,
            size: 0,
            kind: 'binary' as const,
            mime: '',
            error: (err as Error).message
          }
        }
      },
      inspectStructured: async () => ({ ok: false as const, error: 'unavailable' }),
      readTextWindow: async (path: string) => {
        const plane = await daemonReady()
        if (!plane) return { text: '', startByte: 0, endByte: 0, size: 0, error: 'unavailable' }
        try {
          const body = (await plane.request('fs.readFile', { path })) as { base64?: string }
          const text = decodeBase64Utf8(body.base64 || '')
          return { text, startByte: 0, endByte: text.length, size: text.length }
        } catch (err) {
          return { text: '', startByte: 0, endByte: 0, size: 0, error: (err as Error).message }
        }
      },
      readBinary: async (path: string) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          const body = (await plane.request('fs.readFile', { path })) as { base64?: string }
          const base64 = body.base64 || ''
          const ext = path.split('.').pop()?.toLowerCase() ?? ''
          const mime =
            ext === 'png'
              ? 'image/png'
              : ext === 'jpg' || ext === 'jpeg'
                ? 'image/jpeg'
                : ext === 'gif'
                  ? 'image/gif'
                  : ext === 'webp'
                    ? 'image/webp'
                    : ext === 'pdf'
                      ? 'application/pdf'
                      : 'application/octet-stream'
          return {
            ok: true as const,
            base64,
            size: Math.floor((base64.length * 3) / 4),
            mime
          }
        } catch (err) {
          return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
        }
      },
      write: async (path: string, content: string) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          await plane.request('fs.writeFile', { path, text: content, encoding: 'utf8' })
          return { ok: true as const }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      writeBinary: async (path: string, base64: string) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          await plane.request('fs.writeFile', { path, base64 })
          return { ok: true as const }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      writeClip: async (input: { filename: string; base64?: string; text?: string }) => {
        const plane = await daemonReady()
        const root = (host?.tmp || '').replace(/\/$/, '')
        if (!plane || !root) return { ok: false as const, error: 'unavailable' }
        const displayName = clipDisplayName(input.filename)
        try {
          const bytes = input.base64
            ? Uint8Array.from(atob(input.base64), (char) => char.charCodeAt(0))
            : new TextEncoder().encode(input.text || '')
          if (bytes.length === 0) return { ok: false as const, error: 'Empty clip' }
          const { dir, dest } = clipDest(clipRootOf(root), await clipHash16(bytes), displayName)
          await plane.request('fs.mkdir', { path: dir, recursive: true })
          if (input.base64) await plane.request('fs.writeFile', { path: dest, base64: input.base64 })
          else await plane.request('fs.writeFile', { path: dest, text: input.text || '', encoding: 'utf8' })
          return { ok: true as const, path: dest, displayName }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      saveAs: async (defaultName: string, content: string) => {
        const plane = await daemonReady()
        const root = (host?.tmp || '').replace(/\/$/, '')
        if (!plane || !root) return { ok: false as const, cancelled: true }
        const filename = String(defaultName || 'untitled.md').replace(/[/\\]/g, '_')
        const dir = `${root}/vav-saves`
        const path = `${dir}/${filename}`
        try {
          await plane.request('fs.mkdir', { path: dir, recursive: true })
          await plane.request('fs.writeFile', { path, text: content, encoding: 'utf8' })
          return { ok: true as const, path }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      rename: async (path: string, newName: string) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        const trimmed = String(path || '').replace(/[\\/]+$/, '')
        const sep = trimmed.includes('\\') ? '\\' : '/'
        const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
        const dir = slash <= 0 ? trimmed : trimmed.slice(0, slash)
        const target = `${dir}${sep}${String(newName || '').replace(/[/\\]/g, '_')}`
        try {
          await plane.request('fs.rename', { from: path, to: target })
          return { ok: true as const, path: target }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      trash: async (paths: string[]) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          for (const path of paths) {
            await plane.request('fs.unlink', { path })
          }
          return { ok: true as const }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      watch: async (conversationId: string, root: string | null) => {
        await startFileWatch(conversationId, root)
      },
      unwatch: async (conversationId: string) => {
        await stopFileWatch(conversationId)
      },
      onDirty: (handler) => {
        dirtyHandlers.add(handler)
        return () => dirtyHandlers.delete(handler)
      },
      quickLook: async (path: string) => {
        const plane = await daemonReady()
        if (!plane || !path) return
        await plane.request('fs.preview', { path }).catch(() => undefined)
      },
      openWithDefault: async (path: string) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          await plane.request('fs.openPath', { path })
          return { ok: true as const }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      startDrag: () => undefined,
      prefetchDragIcon: async () => undefined,
      copyAsFile: async (paths: string[]) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          await plane.request('fs.copyAsFile', { paths: Array.isArray(paths) ? paths : [] })
          return { ok: true as const }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      },
      getInfo: async (path: string) => {
        const plane = await daemonReady()
        if (!plane) return { ok: false as const, error: 'unavailable' }
        try {
          await plane.request('fs.getInfo', { path })
          return { ok: true as const }
        } catch (err) {
          return { ok: false as const, error: (err as Error).message }
        }
      }
    },
    pty: {
      list: async (conversationId: string) => ({
        sessions: [...ptyTabs.values()]
          .filter((tab) => tab.conversationId === conversationId)
          .map((tab) => ({
            id: tab.id,
            conversationId: tab.conversationId,
            agentId: null,
            title: tab.title,
            createdAt: tab.createdAt,
            status: tab.status
          })),
        layouts: ptyLayouts[conversationId] ?? { bash: null, agents: {} }
      }),
      create: async (conversationId: string, cwd: string, cols: number, rows: number, options) => {
        const plane = await daemonReady()
        if (!plane) return ''
        const command =
          typeof options === 'object' && options?.command
            ? options.command
            : host?.platform === 'win32'
              ? 'cmd.exe'
              : host?.platform === 'darwin'
                ? '/bin/zsh'
                : '/bin/bash'
        const args = typeof options === 'object' && options?.args ? options.args : []
        const spawned = (await plane.request('pty.spawn', {
          file: command,
          args,
          opts: { cwd, cols, rows }
        })) as { stream?: string }
        if (!spawned.stream) return ''
        const id = spawned.stream
        ptyTabs.set(id, {
          id,
          stream: spawned.stream,
          conversationId,
          title: command,
          createdAt: Date.now(),
          status: 'running'
        })
        for (const handler of ptyChanged) handler({ conversationId })
        return id
      },
      write: (tabId: string, data: string) => {
        void daemonReady().then((plane) => {
          if (plane) void plane.request('pty.write', { stream: tabId, data })
        })
      },
      kill: async (tabId: string) => {
        const plane = await daemonReady()
        const tab = ptyTabs.get(tabId)
        if (plane) await plane.request('pty.kill', { stream: tabId }).catch(() => undefined)
        ptyTabs.delete(tabId)
        if (tab) for (const handler of ptyChanged) handler({ conversationId: tab.conversationId })
      },
      resize: (tabId: string, cols: number, rows: number) => {
        void daemonReady().then((plane) => {
          if (plane) void plane.request('pty.resize', { stream: tabId, cols, rows })
        })
      },
      setLayouts: async (conversationId: string, layouts) => {
        ptyLayouts[conversationId] = layouts
      },
      isBusy: async () => false,
      onData: (handler) => {
        ptyData.add(handler)
        return () => ptyData.delete(handler)
      },
      onChanged: (handler) => {
        ptyChanged.add(handler)
        return () => ptyChanged.delete(handler)
      },
      onStatus: (handler) => {
        ptyStatus.add(handler)
        return () => ptyStatus.delete(handler)
      }
    },
    remoteControl: {
      status: async () => remoteStatusOf(),
      regenerateSecret: async () => {
        await rotateHostOffer()
      },
      resetIdentity: async () => undefined,
      onChanged: (handler) => {
        remoteStatusHandlers.add(handler)
        void remoteStatusOf().then(handler)
        return () => remoteStatusHandlers.delete(handler)
      }
    },
    hosts: {
      list: async () => hostInfoFromRemote(host),
      pairing: async () => hostPairingUri(),
      pair: async (payload) => {
        const text = String(payload || '').trim()
        if (!text) return { ok: false as const, error: 'Paste a vavrtp:// pairing line' }
        if (!pairingPasteIsLocalHost(text)) {
          return { ok: false as const, error: CHROME_WAN_PAIR_ERROR }
        }
        const secret = pairingSecretFromPaste(text)
        if (!secret) return { ok: false as const, error: 'That pairing line is not valid.' }
        const parsed = parseMachinePairing(text)
        if (!(await ensureLocalPairingAccess(parsed?.host))) {
          return { ok: false as const, error: 'Chrome needs permission to reach that LAN host.' }
        }
        const targetLan = Boolean(parsed?.host && isPrivateLanAddress(parsed.host))
        transport.connect(transport.variant === 'extension' || targetLan ? text : secret)
        const row = hostInfoFromRemote(host)[0]
        return row
          ? { ok: true as const, host: row }
          : { ok: false as const, error: 'No VAV on this machine' }
      },
      pairLan: async (peer) => {
        if (!isLocalPairingHost(peer?.address)) {
          return { ok: false as const, error: CHROME_WAN_PAIR_ERROR }
        }
        if (!(await ensureLocalPairingAccess(peer.address))) {
          return { ok: false as const, error: 'Chrome needs permission to reach that LAN host.' }
        }
        if (isPrivateLanAddress(peer.address)) {
          const authority =
            peer.address.includes(':') && !peer.address.startsWith('[')
              ? `[${peer.address}]`
              : peer.address
          const info = await fetchDiscoverAt(`http://${authority}:${VAV_SERVER_WEB_DEFAULT_PORT}`)
          const stored =
            typeof localStorage !== 'undefined' ? localStorage.getItem('vav-server-secret') || '' : ''
          const secret = info?.secret || pairingSecretFromPaste(stored)
          if (!secret) {
            return {
              ok: false as const,
              error: 'Paste that computer’s vavrtp:// pairing line. LAN /discover does not include the secret.'
            }
          }
          transport.connect(`vavrtp://${secret}@${peer.address}:${peer.port || VAV_SERVER_WEB_DEFAULT_PORT}`)
        } else {
          const info = await fetchLoopbackDiscover()
          if (info?.secret) {
            transport.connect(info.secret)
          } else {
            transport.rediscover()
          }
        }
        const row = hostInfoFromRemote(host)[0]
        return row
          ? { ok: true as const, host: row }
          : { ok: false as const, error: 'No VAV on this machine' }
      },
      cancelPair: async () => undefined,
      forget: async () => undefined,
      incoming: async () => incomingControllersOf(),
      disconnectIncoming: async (grantId) => {
        const plane = await daemonReady()
        if (!plane) return
        try {
          await plane.request('host.disconnectIncoming', { grantId })
        } catch {
          /* optional */
        }
      },
      unpairIncoming: async (grantId) => {
        const plane = await daemonReady()
        if (!plane) return
        try {
          await plane.request('host.unpairIncoming', { grantId })
        } catch {
          /* optional */
        }
      },
      rotateOffer: async () => {
        await rotateHostOffer()
      },
      discovered: async () => {
        const info = await fetchLoopbackDiscover()
        return info ? [discoverPeerFromInfo(info)] : []
      },
      listDir: async (_machineId: string, path: string) => {
        const plane = await daemonReady()
        if (!plane || !path) return { path, entries: [], truncated: 0, error: 'unavailable' }
        try {
          const listed = (await plane.request('fs.readdir', { path })) as {
            entries?: Array<{ name?: string; isDirectory?: boolean }>
          }
          const visible = (listed.entries ?? []).filter(
            (entry) => typeof entry.name === 'string' && !isIgnoredName(entry.name)
          )
          const slice = visible.slice(0, DIRECTORY_ENTRY_CAP)
          return {
            path,
            entries: fileEntriesFromRemoteDirs(
              slice.map((entry) => ({
                name: entry.name as string,
                path: path.endsWith('/') ? `${path}${entry.name}` : `${path}/${entry.name}`,
                isDirectory: entry.isDirectory === true
              })),
              'name',
              true
            ),
            truncated: Math.max(0, visible.length - slice.length)
          }
        } catch (err) {
          return { path, entries: [], truncated: 0, error: (err as Error).message }
        }
      },
      home: async () => host?.home || '',
      show: async () => undefined,
      active: async () => 'local',
      openFolder: async () => undefined,
      probeProviders: async () => [],
      onChanged: (handler) => {
        hostHandlers.add(handler)
        handler(hostInfoFromRemote(host))
        return () => hostHandlers.delete(handler)
      },
      onDiscovered: () => () => undefined,
      onIncomingChanged: (handler) => {
        incomingHandlers.add(handler)
        void incomingControllersOf().then(handler)
        return () => incomingHandlers.delete(handler)
      },
      onPickFolder: () => () => undefined,
      onActivate: () => () => undefined
    },
    onCliOpen: () => () => undefined,
    onFullscreen: () => () => undefined,
    onMenuCommand: () => () => undefined,
    onAccountsUpdated: (handler) => {
      accountHandlers.add(handler)
      handler(currentAccountPage())
      void pageFromDaemon().then((page) => {
        if (page) handler(page)
      })
      return () => accountHandlers.delete(handler)
    },
    onSettingsChanged: (handler) => {
      settingsHandlers.add(handler)
      handler(settings)
      return () => settingsHandlers.delete(handler)
    },
    onSettingsView: (handler) => {
      settingsViewHandlers.add(handler)
      return () => settingsViewHandlers.delete(handler)
    },
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
      get: async (id: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.get', { id })) as Awaited<
            ReturnType<VavApi['changeSets']['get']>
          >
        } catch {
          return null
        }
      },
      active: async (conversationId: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.active', { conversationId })) as Awaited<
            ReturnType<VavApi['changeSets']['active']>
          >
        } catch {
          return null
        }
      },
      applyEdit: async (setId: string, filePath: string, content: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.applyEdit', { setId, filePath, content })) as Awaited<
            ReturnType<VavApi['changeSets']['applyEdit']>
          >
        } catch {
          return null
        }
      },
      accept: async (setId: string, filePaths: string[]) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.accept', { setId, filePaths })) as Awaited<
            ReturnType<VavApi['changeSets']['accept']>
          >
        } catch {
          return null
        }
      },
      reject: async (setId: string, filePaths: string[]) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.reject', { setId, filePaths })) as Awaited<
            ReturnType<VavApi['changeSets']['reject']>
          >
        } catch {
          return null
        }
      },
      acceptAll: async (setId: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.acceptAll', { setId })) as Awaited<
            ReturnType<VavApi['changeSets']['acceptAll']>
          >
        } catch {
          return null
        }
      },
      rejectAll: async (setId: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.rejectAll', { setId })) as Awaited<
            ReturnType<VavApi['changeSets']['rejectAll']>
          >
        } catch {
          return null
        }
      },
      undo: async (setId: string, filePath: string) => {
        const plane = await daemonReady()
        if (!plane) return null
        try {
          return (await plane.request('changeSets.undo', { setId, filePath })) as Awaited<
            ReturnType<VavApi['changeSets']['undo']>
          >
        } catch {
          return null
        }
      }
    }
  }) as unknown as VavApi
  syncPlatform = () => {
    api.platform = resolvedHostPlatform(host?.platform)
  }

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
