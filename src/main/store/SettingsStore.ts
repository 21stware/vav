import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import {
  BUILTIN_AGENT_IDS,
  DEFAULT_CLI_AGENTS,
  DEFAULT_SETTINGS,
  mergeBuiltinDefaultArgs,
  type AgentConfig,
  type AppSettings
} from '@shared/types'
import { coerceShell, platformDefaults, type Platform } from '@shared/platform'

const PLATFORM = process.platform as Platform

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
    // CLI agent host: always merge built-in catalogue (Claude/Codex/Cursor/Grok/Devin/Pi).
    const beforeAgents = JSON.stringify(this.settings.cliAgents ?? [])
    this.settings.cliAgents = mergeBuiltinAgents(
      Array.isArray(this.settings.cliAgents) ? this.settings.cliAgents : []
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
    if (dirty) this.persist()
  }

  get(): AppSettings {
    // Never hand the renderer an empty catalogue (legacy settings.json had []).
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
    s.temperature = Math.min(2, Math.max(0, s.temperature))
    s.maxTokens = Math.min(200_000, Math.max(256, Math.round(s.maxTokens)))
    s.cliAgents = mergeBuiltinAgents(Array.isArray(s.cliAgents) ? s.cliAgents : [])
    if (s.defaultAgentId !== null && s.defaultAgentId !== undefined) {
      const ids = new Set(s.cliAgents.map((a) => a.id))
      if (!ids.has(s.defaultAgentId)) s.defaultAgentId = s.cliAgents[0]?.id ?? null
    }
    if (!Array.isArray(s.recentWorkspaceDirectories)) s.recentWorkspaceDirectories = []
    s.recentWorkspaceDirectories = s.recentWorkspaceDirectories
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
      .slice(0, 10)
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
    const next = [
      normalized,
      ...this.settings.recentWorkspaceDirectories.filter((entry) => entry !== normalized)
    ].slice(0, 10)
    return this.update({ recentWorkspaceDirectories: next })
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
 * Built-ins always present (order fixed). User path/args/enabled kept.
 * Legacy id `cursor-agent` → `cursor`. Custom agents append after.
 */
function mergeBuiltinAgents(existing: AgentConfig[]): AgentConfig[] {
  const normalized = existing.map((raw) => normalizeAgentConfig(raw))
  const byId = new Map(normalized.map((a) => [a.id, a]))

  if (byId.has('cursor-agent') && !byId.has('cursor')) {
    const old = byId.get('cursor-agent')!
    byId.set('cursor', normalizeAgentConfig({ ...old, id: 'cursor', builtin: true }))
    byId.delete('cursor-agent')
  } else if (byId.has('cursor-agent')) {
    byId.delete('cursor-agent')
  }

  const result: AgentConfig[] = []
  for (const builtin of DEFAULT_CLI_AGENTS) {
    const prev = byId.get(builtin.id)
    if (prev) {
      result.push(
        normalizeAgentConfig({
          ...builtin,
          ...prev,
          id: builtin.id,
          binaryPath: prev.binaryPath || builtin.binaryPath,
          binaryCandidates:
            prev.binaryCandidates && prev.binaryCandidates.length > 0
              ? prev.binaryCandidates
              : builtin.binaryCandidates,
          defaultArgs: mergeBuiltinDefaultArgs(prev.defaultArgs, builtin.defaultArgs),
          // Always refresh catalogue install scripts / docs for builtins
          // (e.g. npm → official curl installers).
          installCommand: builtin.installCommand ?? prev.installCommand ?? null,
          installDocsUrl: builtin.installDocsUrl ?? prev.installDocsUrl ?? null,
          enabled: prev.enabled !== false,
          name: prev.name || builtin.name,
          builtin: true
        })
      )
      byId.delete(builtin.id)
    } else {
      result.push(
        normalizeAgentConfig({
          ...builtin,
          envVars: { ...builtin.envVars },
          defaultArgs: [...builtin.defaultArgs],
          binaryCandidates: builtin.binaryCandidates ? [...builtin.binaryCandidates] : undefined
        })
      )
    }
  }
  for (const custom of byId.values()) {
    if (BUILTIN_AGENT_IDS.includes(custom.id)) continue
    result.push(normalizeAgentConfig({ ...custom, builtin: false }))
  }
  return result
}
