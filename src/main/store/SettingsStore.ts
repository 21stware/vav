import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  BUILTIN_AGENT_IDS,
  COLOR_TINTS,
  DEFAULT_CLI_AGENTS,
  DEFAULT_SETTINGS,
  DISPLAY_CURRENCIES,
  mergeBuiltinDefaultArgs,
  type AgentConfig,
  type AppSettings,
  type ColorTint,
  type DisplayCurrency
} from '@shared/types'
import { coerceShell, platformDefaults, type Platform } from '@shared/platform'
import { sanitizeKeyBindings } from '@shared/keyBindings'
import { resolveFirstOnLoginPath } from '../terminal/loginPath'

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
    const beforeRecent = this.settings.recentWorkspaceDirectories.join('\0')
    const beforePinned = this.settings.pinnedWorkspaceDirectories.join('\0')
    this.clampToAllowedRanges()
    if (
      this.settings.recentWorkspaceDirectories.join('\0') !== beforeRecent ||
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
    if (this.settings.defaultModel === 'deepseek-chat') {
      this.settings.defaultModel = 'deepseek-v4-pro'
      dirty = true
    }
    if (this.settings.customModels.includes('deepseek-chat')) {
      this.settings.customModels = this.settings.customModels.map((id) =>
        id === 'deepseek-chat' ? 'deepseek-v4-pro' : id
      )
      dirty = true
    }
    // One-time PATH reconcile (install detect). Must NOT run on every get() —
    // probing used to spawn login shells and freeze the main process.
    const beforeAgents = JSON.stringify(this.settings.cliAgents ?? [])
    this.settings.cliAgents = mergeBuiltinAgents(
      Array.isArray(this.settings.cliAgents) ? this.settings.cliAgents : [],
      { discoverInstalled: true }
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
      Array.isArray(this.settings.cliAgents) ? this.settings.cliAgents : []
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
    const providers = new Set(['auto', 'duckduckgo', 'searxng', 'brave'])
    if (!providers.has(s.webSearchProvider)) s.webSearchProvider = 'auto'
    s.fontSize = Math.min(24, Math.max(10, s.fontSize))
    if (s.sendKey !== 'enter' && s.sendKey !== 'mod-enter') s.sendKey = 'enter'
    s.keyBindings = sanitizeKeyBindings(s.keyBindings)
    s.temperature = Math.min(2, Math.max(0, s.temperature))
    s.maxTokens = Math.min(200_000, Math.max(256, Math.round(s.maxTokens)))
    s.cliAgents = mergeBuiltinAgents(Array.isArray(s.cliAgents) ? s.cliAgents : [])
    if (typeof s.skipCliAgentPickerWhenSingle !== 'boolean') {
      s.skipCliAgentPickerWhenSingle = false
    }
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
    // null / "vav" = built-in VAV; otherwise must be a configured CLI agent id.
    if (s.defaultAgentId === undefined) s.defaultAgentId = null
    if (s.defaultAgentId === 'vav') s.defaultAgentId = null
    if (s.defaultAgentId !== null) {
      const ids = new Set(s.cliAgents.map((a) => a.id))
      if (!ids.has(s.defaultAgentId)) s.defaultAgentId = null
    }
    if (!Array.isArray(s.recentWorkspaceDirectories)) s.recentWorkspaceDirectories = []
    // Drop paths that no longer exist so the switcher never lists dead dirs.
    s.recentWorkspaceDirectories = s.recentWorkspaceDirectories
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
      .filter((path) => existsSync(path))
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
        if (cleaned.length >= 6) break
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
      s.sidebarGroupingMode !== 'none' && s.sidebarGroupingMode !== 'workspace'
    ) {
      // Drop legacy `source` grouping (sidebar-conversation-list.rpml).
      s.sidebarGroupingMode = 'none'
    }
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
   */
  rememberWorkspaceDirectory(path: string, tmpRoot: string): AppSettings {
    const normalized = path.trim()
    if (!normalized) return this.settings
    if (normalized.startsWith(tmpRoot) || normalized.startsWith('/private' + tmpRoot)) {
      return this.settings
    }
    if (!existsSync(normalized)) return this.settings
    const next = [
      normalized,
      ...this.settings.recentWorkspaceDirectories.filter((entry) => entry !== normalized)
    ].slice(0, 10)
    return this.update({ recentWorkspaceDirectories: next })
  }

  /**
   * Remove a path from recent (and pinned) after ENOENT / user discovery.
   * Safe no-op when the path is not listed.
   */
  forgetWorkspaceDirectory(path: string): AppSettings {
    const normalized = path.trim()
    if (!normalized) return this.settings
    const recent = this.settings.recentWorkspaceDirectories.filter((entry) => entry !== normalized)
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

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      // Presence flags are derived from SecretStore, never persisted here.
      const {
        apiKeyPresent: _omitApi,
        braveSearchKeyPresent: _omitBrave,
        ...rest
      } = this.settings
      void _omitApi
      void _omitBrave
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
  options?: { discoverInstalled?: boolean }
): AgentConfig[] {
  const discover = options?.discoverInstalled === true
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
    const seed = discover
      ? DEFAULT_CLI_AGENTS.filter((builtin) => agentBinaryInstalled(builtin))
      : DEFAULT_CLI_AGENTS
    return seed.map((builtin) =>
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
