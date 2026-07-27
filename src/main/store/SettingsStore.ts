import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types'
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
    if (this.settings.defaultModel === 'deepseek-chat') {
      this.settings.defaultModel = 'deepseek-v4-pro'
      this.persist()
    }
    if (this.settings.customModels.includes('deepseek-chat')) {
      this.settings.customModels = this.settings.customModels.map((id) =>
        id === 'deepseek-chat' ? 'deepseek-v4-pro' : id
      )
      this.persist()
    }
  }

  get(): AppSettings {
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
    s.fontSize = Math.min(24, Math.max(10, s.fontSize))
    s.temperature = Math.min(2, Math.max(0, s.temperature))
    s.maxTokens = Math.min(200_000, Math.max(256, Math.round(s.maxTokens)))
    if (!Array.isArray(s.recentWorkspaceDirectories)) s.recentWorkspaceDirectories = []
    s.recentWorkspaceDirectories = s.recentWorkspaceDirectories
      .filter((path): path is string => typeof path === 'string' && path.length > 0)
      .slice(0, 10)
    if (
      s.sidebarGroupingMode !== 'none' &&
      s.sidebarGroupingMode !== 'workspace' &&
      s.sidebarGroupingMode !== 'source'
    ) {
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
      // apiKeyPresent is derived from the secret store, never persisted here.
      const { apiKeyPresent: _omit, ...rest } = this.settings
      void _omit
      writeFileSync(this.file, JSON.stringify(rest, null, 2), 'utf8')
    } catch (err) {
      console.error('[settings] persist failed', err)
    }
  }
}
