import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { displayNameForCliHost } from '../../shared/cliHost.ts'
import {
  defaultSkillMarkdown,
  emptyPluginEnabledMap,
  hooksToFile,
  mcpServersToFile,
  parseHooksFile,
  parseMcpServersFile,
  parsePluginEnabledMap,
  pluginHostKind,
  sanitizePluginName,
  type PluginEnabledMap,
  type PluginHook,
  type PluginHostKind,
  type PluginMcpServer,
  type PluginSkill,
  type PluginSnapshot
} from '../../shared/plugins.ts'
import { discoverHostPlugins, discoverPluginDir, readJsonFile, readTextFile } from './discover.ts'
import { pluginRootsForHost, vavStateFiles } from './pluginPaths.ts'

export type PluginUserSkill = {
  id: string
  name: string
  description: string
  license: string
  source: string
  tags: string[]
  dir: string
}

export type PluginMutation =
  | { ok: true; snapshot: PluginSnapshot }
  | { ok: false; error: string }

export class PluginService {
  private readonly home: string
  private listeners = new Set<() => void>()
  private bundled: import('../../shared/plugins.ts').PluginRecord | null = null

  constructor(home = homedir()) {
    this.home = home
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  setBundledSkills(
    entries: Array<{ id: string; name: string; description: string; dir: string }>,
    root: string | null
  ): void {
    if (!root || entries.length === 0) {
      this.bundled = {
        id: 'vav:bundled',
        name: 'Bundled',
        description: 'Shipped with VAV. Read-only.',
        enabled: true,
        readOnly: true,
        origin: 'bundled',
        dir: root ?? undefined,
        skills: [],
        mcpServers: [],
        hooks: []
      }
      return
    }
    this.bundled = {
      id: 'vav:bundled',
      name: 'Bundled',
      description: 'Shipped with VAV. Read-only.',
      enabled: true,
      readOnly: true,
      origin: 'bundled',
      dir: root,
      skills: entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        path: join(root, entry.dir, 'SKILL.md'),
        dir: join(root, entry.dir),
        enabled: true,
        pluginId: 'vav:bundled'
      })),
      mcpServers: [],
      hooks: []
    }
  }

  snapshot(host: PluginHostKind | string | null | undefined): PluginSnapshot {
    const kind = pluginHostKind(typeof host === 'string' ? host : host ?? null)
    return discoverHostPlugins(kind, this.home, {
      bundled: kind === 'vav' ? this.bundled : null,
      enabled: this.enabledMap(kind)
    })
  }

  enabledSkillEntries(): PluginUserSkill[] {
    const snap = this.snapshot('vav')
    const out: PluginUserSkill[] = []
    for (const plugin of snap.plugins) {
      if (!plugin.enabled || plugin.origin === 'bundled') continue
      for (const skill of plugin.skills) {
        if (!skill.enabled) continue
        out.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          license: 'user',
          source: 'user',
          tags: ['plugin'],
          dir: skill.dir
        })
      }
    }
    return out
  }

  enabledMcpServers(): PluginMcpServer[] {
    return this.snapshot('vav')
      .plugins.filter((plugin) => plugin.enabled)
      .flatMap((plugin) => plugin.mcpServers.filter((server) => server.enabled && server.command))
  }

  enabledHooks(): PluginHook[] {
    return this.snapshot('vav')
      .plugins.filter((plugin) => plugin.enabled)
      .flatMap((plugin) => plugin.hooks.filter((hook) => hook.enabled))
  }

  enabledSkills(): PluginSkill[] {
    return this.snapshot('vav')
      .plugins.filter((plugin) => plugin.enabled && plugin.origin !== 'bundled')
      .flatMap((plugin) => plugin.skills.filter((skill) => skill.enabled))
  }

  setEnabled(host: PluginHostKind, pluginId: string, enabled: boolean): PluginMutation {
    if (host !== 'vav') {
      return { ok: false, error: 'Enable/disable is only stored for VAV plugins' }
    }
    if (pluginId === 'vav:bundled') return { ok: false, error: 'Bundled skills cannot be disabled here' }
    const files = vavStateFiles(this.home)
    mkdirSync(files.home, { recursive: true })
    const map = this.enabledMap('vav')
    map.enabled[pluginId] = enabled
    writeJson(files.enabled, map)
    this.notify()
    return { ok: true, snapshot: this.snapshot('vav') }
  }

  create(
    kind: 'skill' | 'mcp' | 'hook' | 'plugin',
    name: string
  ): PluginMutation {
    const id = sanitizePluginName(name)
    if (!id) return { ok: false, error: 'Name is required' }
    const files = vavStateFiles(this.home)
    mkdirSync(files.home, { recursive: true })
    try {
      if (kind === 'skill') {
        const dir = join(files.skillsDir, id)
        mkdirSync(dir, { recursive: true })
        const skillMd = join(dir, 'SKILL.md')
        if (!readTextFile(skillMd)) writeFileSync(skillMd, defaultSkillMarkdown(id), 'utf8')
      } else if (kind === 'plugin') {
        const dir = join(files.pluginsDir, id)
        mkdirSync(join(dir, 'skills', id), { recursive: true })
        writeJson(join(dir, 'plugin.json'), {
          name: id,
          description: `VAV plugin ${id}`,
          version: '0.0.1'
        })
        writeFileSync(join(dir, 'skills', id, 'SKILL.md'), defaultSkillMarkdown(id), 'utf8')
      } else if (kind === 'mcp') {
        const current = parseMcpServersFile(readJsonFile(files.mcp), files.mcp, 'vav:global-mcp')
        if (current.some((server) => server.name === id)) {
          return { ok: false, error: `MCP server "${id}" already exists` }
        }
        current.push({
          id: `vav:global-mcp:mcp:${id}`,
          name: id,
          command: 'npx',
          args: ['-y', id],
          configPath: files.mcp,
          enabled: true,
          pluginId: 'vav:global-mcp'
        })
        writeJson(files.mcp, mcpServersToFile(current))
      } else {
        const current = parseHooksFile(readJsonFile(files.hooks), files.hooks, 'vav:global-hooks')
        current.push({
          id: `vav:global-hooks:hook:${current.length + 1}`,
          event: 'UserPromptSubmit',
          command: `echo ${id}`,
          configPath: files.hooks,
          enabled: true,
          pluginId: 'vav:global-hooks'
        })
        writeJson(files.hooks, hooksToFile(current))
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    this.notify()
    return { ok: true, snapshot: this.snapshot('vav') }
  }

  writeConfig(path: string, content: string): PluginMutation {
    const allowed = this.allowedWrite(path)
    if (!allowed) return { ok: false, error: 'Can only write VAV plugin files' }
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf8')
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
    this.notify()
    return { ok: true, snapshot: this.snapshot('vav') }
  }

  private allowedWrite(path: string): boolean {
    const root = vavStateFiles(this.home).home
    const norm = path.replace(/\\/g, '/')
    const base = root.replace(/\\/g, '/')
    return norm === base || norm.startsWith(`${base}/`)
  }

  private enabledMap(host: PluginHostKind): PluginEnabledMap {
    if (host !== 'vav') return emptyPluginEnabledMap()
    const file = vavStateFiles(this.home).enabled
    return parsePluginEnabledMap(readJsonFile(file))
  }
}

export function hostLabel(host: PluginHostKind): string {
  return host === 'vav' ? 'VAV' : displayNameForCliHost(host)
}

export function pluginRootLabel(host: PluginHostKind, home = homedir()): string {
  return pluginRootsForHost(host, home).root
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function peekPlugin(dir: string, pluginId: string): ReturnType<typeof discoverPluginDir> {
  return discoverPluginDir(dir, {
    pluginId,
    enabled: true,
    origin: 'user',
    readOnly: false
  })
}
