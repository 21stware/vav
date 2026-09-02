import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  BUILTIN_AGENT_IDS,
  COLOR_TINTS,
  DEFAULT_CLI_AGENTS,
  DEFAULT_SETTINGS,
  DISPLAY_CURRENCIES,
  VAV_DEFAULT_MODEL_ID,
  SURFACE_PATTERNS,
  mergeBuiltinDefaultArgs,
  type AgentConfig,
  type AppSettings,
  type ColorTint,
  type DisplayCurrency,
  type SurfacePattern
} from '@shared/types'
import { coerceShell, platformDefaults, type Platform } from '@shared/platform'
import { normalizeAccentHex } from '@shared/colorTints'
import { sanitizeKeyBindings } from '@shared/keyBindings'
import { RECENT_AGENT_MODELS_MAX, VAV_LEGACY_DEFAULT_MODELS } from '@shared/agentModels'
import { isLlmVendorId } from '@shared/llmVendors'
import { parseThinkingLevel } from '@shared/thinkingLevel'
import { isCssTileSize } from '@shared/surfacePattern'
import { surfacePatternFilePath, writeSurfacePatternPng } from '../importSurfacePattern'
import { resolveFirstOnLoginPath } from '../terminal/loginPath'
import {
  LOCAL_MACHINE_ID,
  isLocalMachine,
  parseWorkspaceRefList,
  sameWorkspaceRef,
  serializeWorkspaceRefList,
  workspaceRef
} from '@shared/workspaceHost'
import { clampKeepAwakeBatteryFloor } from '@shared/sleepBlocker'

const PLATFORM = process.platform as Platform

/**
 * Cheap filesystem PATH walk only (no `zsh -ilc`). Safe for a single boot-time
 * reconcile — never call this from settings.get() / clamp hot paths.
 */
function agentBinaryInstalled(agent: Pick<AgentConfig, 'binaryPath' | 'binaryCandidates'>): boolean {
  const candidates = [
    agent.binaryPath,
    ...(Array.isArray(agent.binaryCandidates) ? agent.binaryCandidates : [])
  ]
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter(Boolean)
  return resolveFirstOnLoginPath(candidates) != null
}

/** Defaults with the shell, code font and hotkey this platform can honour. */
const DEFAULTS: AppSettings = { ...DEFAULT_SETTINGS, ...platformDefaults(PLATFORM) }

/**
 * Non-secret preferences, under the OS's per-app data directory:
 * ~/Library/Application Support/vav on macOS, %APPDATA%\vav on Windows.
 * The local Electron build uses `vav-dev` so it can sit beside the release app.
 *
 * Every non-key field auto-saves on change so the LLM client always reads the
 * latest endpoint/model without an explicit save step.
 */
export class SettingsStore {
  private readonly file = join(app.getPath('userData'), 'settings.json')
  private settings: AppSettings = { ...DEFAULTS }

  load(): AppSettings {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        this.settings = { ...DEFAULTS, ...raw }
      }
    } catch {
      this.settings = { ...DEFAULTS }
    }
    this.migrateLegacy()
    this.coerceToPlatform()
    // Prune deleted workspace paths on boot (switcher list stays honest).
    const beforeRecent = serializeWorkspaceRefList(
      parseWorkspaceRefList(this.settings.recentWorkspaceDirectories)
    )
    const beforePinned = this.settings.pinnedWorkspaceDirectories.join('\0')
    this.clampToAllowedRanges()
    if (
      serializeWorkspaceRefList(this.settings.recentWorkspaceDirectories) !== beforeRecent ||
      this.settings.pinnedWorkspaceDirectories.join('\0') !== beforePinned
    ) {
      this.persist()
    }
    return this.settings
  }

  /**
   * A settings file copied from another machine can name a shell that does not
   * exist here, or a hotkey with a modifier this keyboard has no key for.
   * Either would fail silently, so both fall back to the platform default.
   */
  private coerceToPlatform(): void {
    const shell = coerceShell(PLATFORM, this.settings.shell)
    const hotkey = this.settings.globalHotkey
    const portableHotkey =
      PLATFORM === 'darwin' || !hotkey.includes('Command') ? hotkey : DEFAULTS.globalHotkey
    if (shell === this.settings.shell && portableHotkey === hotkey) return
    this.settings.shell = shell
    this.settings.globalHotkey = portableHotkey
    this.persist()
  }

  /** One-time renames for preset ids that changed between releases. */
  private migrateLegacy(): void {
    let dirty = false
    if (
      VAV_LEGACY_DEFAULT_MODELS.includes(
        this.settings.defaultModel as (typeof VAV_LEGACY_DEFAULT_MODELS)[number]
      )
    ) {
      this.settings.defaultModel = VAV_DEFAULT_MODEL_ID
      dirty = true
    }
    if (this.settings.customModels.includes('deepseek-chat')) {
      this.settings.customModels = this.settings.customModels.map((id) =>
        id === 'deepseek-chat' ? VAV_DEFAULT_MODEL_ID : id
      )
      dirty = true
    }
    // One-time PATH reconcile (install detect). Must NOT run on every get() —
    // probing used to spawn login shells and freeze the main process.
    const beforeAgents = JSON.stringify(this.settings.cliAgents ?? [])
    this.settings.cliAgents = mergeBuiltinAgents(
      Array.isArray(this.settings.cliAgents) ? this.settings.cliAgents : [],
      {
        discoverInstalled: true,
        removedIds: Array.isArray(this.settings.removedCliAgentIds)
          ? this.settings.removedCliAgentIds
          : []
      }
    )
    if (JSON.stringify(this.settings.cliAgents) !== beforeAgents) dirty = true
    if (this.settings.defaultAgentId === undefined) {
      // null = plain vav shell (product default); CLI agents are opt-in per session.
      this.settings.defaultAgentId = null
      dirty = true
    }
    if (
      this.settings.defaultApprovalMode !== 'auto' &&
      this.settings.defaultApprovalMode !== 'bypass' &&
      this.settings.defaultApprovalMode !== 'edit'
    ) {
      this.settings.defaultApprovalMode = 'auto'
      dirty = true
    }
    if (!COLOR_TINTS.includes(this.settings.colorTint as ColorTint)) {
      this.settings.colorTint = DEFAULT_SETTINGS.colorTint
      dirty = true
    }
    const customHex = normalizeAccentHex(this.settings.customAccentColor)
    if ((this.settings.customAccentColor ?? '') !== (customHex ?? '')) {
      this.settings.customAccentColor = customHex ?? ''
      dirty = true
    }
    if (this.settings.colorTint === 'custom' && !this.settings.customAccentColor) {
      this.settings.colorTint = DEFAULT_SETTINGS.colorTint
      dirty = true
    }
    const leftover = this.settings as AppSettings & {
      backgroundTint?: unknown
      customBackgroundColor?: unknown
    }
    if (leftover.backgroundTint !== undefined || leftover.customBackgroundColor !== undefined) {
      delete leftover.backgroundTint
      delete leftover.customBackgroundColor
      dirty = true
    }
    if (this.migrateCustomSurfacePatternFile()) dirty = true
    if (
      !DISPLAY_CURRENCIES.includes(this.settings.displayCurrency as DisplayCurrency)
    ) {
      this.settings.displayCurrency = DEFAULT_SETTINGS.displayCurrency
      dirty = true
    }
    if (dirty) this.persist()
  }

  get(): AppSettings {
    // Structural normalize only — never touch the filesystem / login shell here.
    this.settings.cliAgents = mergeBuiltinAgents(
      Array.isArray(this.settings.cliAgents) ? this.settings.cliAgents : [],
      {
        removedIds: Array.isArray(this.settings.removedCliAgentIds)
          ? this.settings.removedCliAgentIds
          : []
      }
    )
    return this.settings
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...patch }
    this.clampToAllowedRanges()
    this.persist()
    return this.settings
  }

  reset(): AppSettings {
    this.settings = { ...DEFAULTS }
    this.persist()
    return this.settings
  }

  private clampToAllowedRanges(): void {
    const s = this.settings
    s.commandTimeout = Math.min(600, Math.max(10, Math.round(s.commandTimeout / 10) * 10))
    s.webTimeoutMs = Math.min(
      60_000,
      Math.max(5_000, Math.round((Number(s.webTimeoutMs) || 15_000) / 1000) * 1000)
    )
    // Web search / fetch always available (no product toggles).
    s.webToolsEnabled = true
    s.webSearchEnabled = true
    s.webFetchEnabled = true
    if (typeof s.webFetchAllowRender !== 'boolean') s.webFetchAllowRender = false
    if (typeof s.webSearxngBaseUrl !== 'string') s.webSearxngBaseUrl = ''
    s.webSearxngBaseUrl = s.webSearxngBaseUrl.trim()
    if (typeof s.cloudflareAccountId !== 'string') s.cloudflareAccountId = ''
    s.cloudflareAccountId = s.cloudflareAccountId.trim()
    if (typeof s.supabaseProjectRef !== 'string') s.supabaseProjectRef = ''
    s.supabaseProjectRef = s.supabaseProjectRef.trim()
    const providers = new Set(['auto', 'duckduckgo', 'searxng', 'brave', 'tinyfish'])
    if (!providers.has(s.webSearchProvider)) s.webSearchProvider = 'auto'
    s.fontSize = Math.min(24, Math.max(10, s.fontSize))
    if (s.bashBackground !== 'dark' && s.bashBackground !== 'theme') s.bashBackground = 'theme'
    if (!SURFACE_PATTERNS.includes(s.surfacePattern as SurfacePattern)) {
      s.surfacePattern = DEFAULT_SETTINGS.surfacePattern
    }
    if (typeof s.customSurfacePatternUrl !== 'string') s.customSurfacePatternUrl = ''
    // Runtime-only (vav-local / leftover data URLs) — never keep a payload here.
    if (s.customSurfacePatternUrl.startsWith('data:') || s.customSurfacePatternUrl.length > 2_000) {
      s.customSurfacePatternUrl = ''
    }
    if (typeof s.customSurfacePatternSize !== 'string' || !isCssTileSize(s.customSurfacePatternSize)) {
      s.customSurfacePatternSize = ''
    }
    const patternFile = surfacePatternFilePath(app.getPath('userData'))
    if (s.surfacePattern === 'custom' && !existsSync(patternFile)) {
      s.surfacePattern = DEFAULT_SETTINGS.surfacePattern
    }
    if (typeof s.customAccentColor !== 'string') s.customAccentColor = ''
    else s.customAccentColor = normalizeAccentHex(s.customAccentColor) ?? ''
    if (s.colorTint === 'custom' && !s.customAccentColor) s.colorTint = 'system'
    if (s.sendKey !== 'enter' && s.sendKey !== 'mod-enter') s.sendKey = 'enter'
    s.keyBindings = sanitizeKeyBindings(s.keyBindings)
    s.temperature = Math.min(2, Math.max(0, s.temperature))
    s.maxTokens = Math.min(200_000, Math.max(256, Math.round(s.maxTokens)))
    s.defaultThinkingLevel = parseThinkingLevel(s.defaultThinkingLevel)
    if (!Array.isArray(s.removedCliAgentIds)) s.removedCliAgentIds = []
    else {
      s.removedCliAgentIds = [
        ...new Set(
          s.removedCliAgentIds.filter(
            (id): id is string => typeof id === 'string' && id.length > 0
          )
        )
      ]
    }
    s.cliAgents = mergeBuiltinAgents(Array.isArray(s.cliAgents) ? s.cliAgents : [], {
      removedIds: s.removedCliAgentIds
    })
    if (!Array.isArray(s.providerListOrder)) s.providerListOrder = []
    else {
      const seen = new Set<string>()
      s.providerListOrder = s.providerListOrder.filter((id): id is string => {
        if (typeof id !== 'string' || !id.trim() || seen.has(id)) return false
        seen.add(id)
        return true
      })
    }
    if (typeof s.keepAwakeWhileAgentRunning !== 'boolean') {
      s.keepAwakeWhileAgentRunning = false
    }
    s.keepAwakeBatteryFloorPercent = clampKeepAwakeBatteryFloor(s.keepAwakeBatteryFloorPercent)
    if (typeof s.skipCliAgentPickerWhenSingle !== 'boolean') {
      s.skipCliAgentPickerWhenSingle = false
    }
    if (typeof s.githubTrayEnabled !== 'boolean') s.githubTrayEnabled = true
    if (typeof s.cloudflareTrayEnabled !== 'boolean') s.cloudflareTrayEnabled = false
    if (typeof s.supabaseTrayEnabled !== 'boolean') s.supabaseTrayEnabled = false
    if (!s.disabledAgentModels || typeof s.disabledAgentModels !== 'object') {
      s.disabledAgentModels = {}
    } else {
      const cleaned: Record<string, string[]> = {}
      for (const [host, ids] of Object.entries(s.disabledAgentModels)) {
        if (!Array.isArray(ids)) continue
        cleaned[host] = ids.filter((id): id is string => typeof id === 'string')
      }
      s.disabledAgentModels = cleaned
    }
    if (!s.defaultAgentModels || typeof s.defaultAgentModels !== 'object') {
      s.defaultAgentModels = {}
    } else {
      const cleaned: Record<string, string> = {}
      for (const [host, id] of Object.entries(s.defaultAgentModels)) {
        if (typeof host !== 'string' || !host.trim()) continue
        if (typeof id !== 'string') continue
        cleaned[host] = id
      }
      s.defaultAgentModels = cleaned
    }
    if (s.detachedWindowSize) {
      if (
        typeof s.detachedWindowSize.width !== 'number' ||
        typeof s.detachedWindowSize.height !== 'number'
      ) {
        s.detachedWindowSize = undefined
      } else {
        s.detachedWindowSize.width = Math.min(
          10_000,
          Math.max(400, Math.round(s.detachedWindowSize.width))
        )
        s.detachedWindowSize.height = Math.min(
          10_000,
          Math.max(400, Math.round(s.detachedWindowSize.height))
        )
      }
    }
    // null / "vav" = no explicit default. Otherwise a CLI agent id or LLM vendor id.
    if (s.defaultAgentId === undefined) s.defaultAgentId = null
    if (s.defaultAgentId === 'vav') s.defaultAgentId = null
    if (s.defaultAgentId !== null && !isLlmVendorId(s.defaultAgentId)) {
      const ids = new Set(s.cliAgents.map((a) => a.id))
      if (!ids.has(s.defaultAgentId)) s.defaultAgentId = null
    }
    // Drop local paths that no longer exist. Remote refs stay — this disk
    // cannot see the daemon's folders.
    s.recentWorkspaceDirectories = parseWorkspaceRefList(s.recentWorkspaceDirectories)
      .filter((ref) => !isLocalMachine(ref.machineId) || existsSync(ref.path))
      .slice(0, 10)
    if (!Array.isArray(s.recentAgentModels)) s.recentAgentModels = []
    else {
      const seen = new Set<string>()
      const cleaned: { hostId: string; model: string }[] = []
      for (const entry of s.recentAgentModels) {
        if (!entry || typeof entry !== 'object') continue
        const hostId = typeof entry.hostId === 'string' ? entry.hostId.trim() : ''
        if (!hostId) continue
        const model = typeof entry.model === 'string' ? entry.model : ''
        const key = `${hostId}\0${model}`
        if (seen.has(key)) continue
        seen.add(key)
        cleaned.push({ hostId, model })
        if (cleaned.length >= RECENT_AGENT_MODELS_MAX) break
      }
      s.recentAgentModels = cleaned
    }
    if (!Array.isArray(s.pinnedWorkspaceDirectories)) s.pinnedWorkspaceDirectories = []
    s.pinnedWorkspaceDirectories = [
      ...new Set(
        s.pinnedWorkspaceDirectories.filter(
          (path): path is string =>
            typeof path === 'string' && path.length > 0 && existsSync(path)
        )
      )
    ]
    if (
      s.sidebarGroupingMode !== 'none' &&
      s.sidebarGroupingMode !== 'workspace' &&
      s.sidebarGroupingMode !== 'provider'
    ) {
      // Drop legacy `source` grouping (sidebar-conversation-list.rpml).
      s.sidebarGroupingMode = 'none'
    }
    const legacyActive = (s as { activeMachineId?: unknown }).activeMachineId
    if (typeof s.defaultMachineId !== 'string' || !s.defaultMachineId.trim()) {
      s.defaultMachineId =
        typeof legacyActive === 'string' && legacyActive.trim()
          ? legacyActive.trim()
          : LOCAL_MACHINE_ID
    } else {
      s.defaultMachineId = s.defaultMachineId.trim()
    }
    if (typeof s.sidebarSessionFilter !== 'string') s.sidebarSessionFilter = 'none'
    else if (
      s.sidebarSessionFilter !== 'none' &&
      s.sidebarSessionFilter !== 'active' &&
      s.sidebarSessionFilter !== 'favorite' &&
      !(s.sidebarSessionFilter.startsWith('ws:') && s.sidebarSessionFilter.length > 3)
    ) {
      s.sidebarSessionFilter = 'none'
    } else if (s.sidebarSessionFilter.startsWith('ws:')) {
      const path = s.sidebarSessionFilter.slice(3)
      if (!path || !existsSync(path)) s.sidebarSessionFilter = 'none'
    }
    if (!Array.isArray(s.favoriteConversationIds)) s.favoriteConversationIds = []
    s.favoriteConversationIds = [
      ...new Set(
        s.favoriteConversationIds.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0
        )
      )
    ]
    if (s.fileViewMode !== 'tree' && s.fileViewMode !== 'column') {
      s.fileViewMode = 'tree'
    }
    if (s.fileSortKey === 'date') s.fileSortKey = 'dateModified'
    const sortKeys = new Set([
      'none',
      'name',
      'kind',
      'application',
      'dateAdded',
      'dateModified',
      'dateCreated',
      'size',
      'tags'
    ])
    if (!sortKeys.has(s.fileSortKey)) s.fileSortKey = 'name'
    if (typeof s.fileSortAscending !== 'boolean') s.fileSortAscending = true
    if (!DISPLAY_CURRENCIES.includes(s.displayCurrency as DisplayCurrency)) {
      s.displayCurrency = DEFAULT_SETTINGS.displayCurrency
    }
  }

  /**
   * Records a non-Temporary workdir at the front of the recent list.
   * Temporary paths are never remembered (workspace switcher popover).
   * Remote folders skip local existsSync — that path lives on another machine.
   */
  rememberWorkspaceDirectory(
    path: string,
    tmpRoot: string,
    machineId?: string | null
  ): AppSettings {
    const ref = workspaceRef(path.trim(), machineId)
    if (!ref.path) return this.settings
    if (
      tmpRoot &&
      (ref.path.startsWith(tmpRoot) || ref.path.startsWith('/private' + tmpRoot))
    ) {
      return this.settings
    }
    if (isLocalMachine(ref.machineId) && !existsSync(ref.path)) return this.settings
    const next = [
      ref,
      ...this.settings.recentWorkspaceDirectories.filter((entry) => !sameWorkspaceRef(entry, ref))
    ].slice(0, 10)
    return this.update({ recentWorkspaceDirectories: next })
  }

  /**
   * Remove a path from recent (and pinned) after ENOENT / user discovery.
   * Safe no-op when the path is not listed.
   */
  forgetWorkspaceDirectory(path: string, machineId?: string | null): AppSettings {
    const normalized = path.trim()
    if (!normalized) return this.settings
    const recent = this.settings.recentWorkspaceDirectories.filter((entry) => {
      if (entry.path !== normalized) return true
      if (machineId == null || machineId === '') return false
      return !sameWorkspaceRef(entry, workspaceRef(normalized, machineId))
    })
    const pinned = this.settings.pinnedWorkspaceDirectories.filter((entry) => entry !== normalized)
    if (
      recent.length === this.settings.recentWorkspaceDirectories.length &&
      pinned.length === this.settings.pinnedWorkspaceDirectories.length
    ) {
      return this.settings
    }
    return this.update({
      recentWorkspaceDirectories: recent,
      pinnedWorkspaceDirectories: pinned
    })
  }

  /**
   * Older builds stuffed the tile into settings.json as a data URL.
   * Lift that PNG into userData and drop the payload.
   */
  private migrateCustomSurfacePatternFile(): boolean {
    const url = this.settings.customSurfacePatternUrl
    const dest = surfacePatternFilePath(app.getPath('userData'))
    let dirty = false
    if (typeof url === 'string' && url.startsWith('data:image/png;base64,')) {
      try {
        const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
        const installed = writeSurfacePatternPng(png, dest)
        if (installed && !isCssTileSize(this.settings.customSurfacePatternSize)) {
          this.settings.customSurfacePatternSize = installed.size
        }
      } catch {
        // Drop the payload even if the write fails — settings.json must stay small.
      }
      this.settings.customSurfacePatternUrl = ''
      dirty = true
    } else if (typeof url === 'string' && (url.startsWith('data:') || url.startsWith('vav-local:'))) {
      this.settings.customSurfacePatternUrl = ''
      dirty = true
    }
    return dirty
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      // Presence flags are derived from SecretStore, never persisted here.
      const {
        apiKeyPresent: _omitApi,
        braveSearchKeyPresent: _omitBrave,
        tinyfishSearchKeyPresent: _omitTiny,
        cloudflareApiTokenPresent: _omitCf,
        supabaseAccessTokenPresent: _omitSb,
        customSurfacePatternUrl: _omitPatternUrl,
        ...rest
      } = this.settings
      void _omitApi
      void _omitBrave
      void _omitTiny
      void _omitCf
      void _omitSb
      void _omitPatternUrl
      writeFileSync(this.file, JSON.stringify(rest, null, 2), 'utf8')
    } catch (err) {
      console.error('[settings] persist failed', err)
    }
  }
}

function normalizeAgentConfig(raw: Partial<AgentConfig> & { id?: string }): AgentConfig {
  const id =
    typeof raw.id === 'string' && raw.id ? raw.id : `agent-${Math.random().toString(36).slice(2, 8)}`
  const builtinDef = DEFAULT_CLI_AGENTS.find((a) => a.id === id)
  const isBuiltin = BUILTIN_AGENT_IDS.includes(id) || raw.builtin === true || !!builtinDef
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : (builtinDef?.name ?? id),
    binaryPath:
      typeof raw.binaryPath === 'string' && raw.binaryPath
        ? raw.binaryPath
        : (builtinDef?.binaryPath ?? id),
    binaryCandidates:
      Array.isArray(raw.binaryCandidates) && raw.binaryCandidates.length > 0
        ? raw.binaryCandidates.filter((a): a is string => typeof a === 'string')
        : builtinDef?.binaryCandidates
          ? [...builtinDef.binaryCandidates]
          : undefined,
    defaultArgs: Array.isArray(raw.defaultArgs)
      ? mergeBuiltinDefaultArgs(
          raw.defaultArgs.filter((a): a is string => typeof a === 'string'),
          builtinDef?.defaultArgs ?? []
        )
      : builtinDef
        ? [...builtinDef.defaultArgs]
        : [],
    envVars:
      raw.envVars && typeof raw.envVars === 'object' && !Array.isArray(raw.envVars)
        ? Object.fromEntries(
            Object.entries(raw.envVars).filter(
              (e): e is [string, string] => typeof e[0] === 'string' && typeof e[1] === 'string'
            )
          )
        : {},
    enabled: raw.enabled !== false,
    providerName: raw.providerName ?? builtinDef?.providerName ?? null,
    builtin: isBuiltin,
    installCommand:
      typeof raw.installCommand === 'string'
        ? raw.installCommand
        : (builtinDef?.installCommand ?? null),
    installDocsUrl:
      typeof raw.installDocsUrl === 'string'
        ? raw.installDocsUrl
        : (builtinDef?.installDocsUrl ?? null)
  }
}

/**
 * Normalize / migrate the CLI agent list.
 *
 * Hot path (`get` / clamp): structural only — no PATH probes.
 * Boot (`discoverInstalled: true`): seed an empty list from installed binaries.
 *
 * settings.json is the source of truth after the first save. We do **not**
 * re-attach catalogue agents the user removed, and we do **not** drop kept
 * rows when a PATH probe fails — that used to make Settings “come back” on
 * every restart.
 * Legacy id `cursor-agent` → `cursor`.
 */
function mergeBuiltinAgents(
  existing: AgentConfig[],
  options?: { discoverInstalled?: boolean; removedIds?: string[] }
): AgentConfig[] {
  const discover = options?.discoverInstalled === true
  const removed = new Set(options?.removedIds ?? [])
  const normalized = existing.map((raw) => normalizeAgentConfig(raw))
  const byId = new Map(normalized.map((a) => [a.id, a]))

  if (byId.has('cursor-agent') && !byId.has('cursor')) {
    const old = byId.get('cursor-agent')!
    byId.set('cursor', normalizeAgentConfig({ ...old, id: 'cursor', builtin: true }))
    byId.delete('cursor-agent')
  } else if (byId.has('cursor-agent')) {
    byId.delete('cursor-agent')
  }

  // Fresh / wiped settings — only place we invent a catalogue from PATH.
  if (byId.size === 0) {
    const seed = (
      discover
        ? DEFAULT_CLI_AGENTS.filter((builtin) => agentBinaryInstalled(builtin))
        : DEFAULT_CLI_AGENTS
    ).filter((builtin) => !removed.has(builtin.id))
    const source = seed.length > 0 ? seed : DEFAULT_CLI_AGENTS
    return source.map((builtin) =>
      normalizeAgentConfig({
        ...builtin,
        envVars: { ...builtin.envVars },
        defaultArgs: [...builtin.defaultArgs],
        binaryCandidates: builtin.binaryCandidates ? [...builtin.binaryCandidates] : undefined,
        enabled: true
      })
    )
  }

  // Preserve **array order** from the user list (reorder is sticky).
  const result: AgentConfig[] = []
  const seen = new Set<string>()
  for (const prev of normalized) {
    if (seen.has(prev.id)) continue
    seen.add(prev.id)
    // Prefer the map entry (post cursor-agent migration).
    const row = byId.get(prev.id) ?? prev
    const builtin = DEFAULT_CLI_AGENTS.find((a) => a.id === row.id)
    if (builtin) {
      result.push(
        normalizeAgentConfig({
          ...builtin,
          ...row,
          id: builtin.id,
          binaryPath: row.binaryPath || builtin.binaryPath,
          binaryCandidates:
            row.binaryCandidates && row.binaryCandidates.length > 0
              ? row.binaryCandidates
              : builtin.binaryCandidates,
          defaultArgs: mergeBuiltinDefaultArgs(row.defaultArgs, builtin.defaultArgs),
          installCommand: builtin.installCommand ?? row.installCommand ?? null,
          installDocsUrl: builtin.installDocsUrl ?? row.installDocsUrl ?? null,
          // Preserve explicit disable (`enabled: false`).
          enabled: row.enabled !== false,
          // Catalogue renames: refresh known old defaults (e.g. Grok → Grok build).
          name:
            row.id === 'grok' && (!row.name || row.name === 'Grok')
              ? builtin.name
              : row.name || builtin.name,
          builtin: true
        })
      )
    } else {
      result.push(normalizeAgentConfig({ ...row, builtin: false }))
    }
  }

  return result
}
