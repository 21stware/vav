/**
 * Read plugin packages / loose skills / MCP / hooks from a host's real dirs.
 * No Electron — tests pass a temp home.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { displayNameForCliHost } from '../../shared/cliHost.ts'
import {
  isPluginEnabled,
  parseHooksFile,
  parseMcpServersFile,
  parsePluginEnabledMap,
  parseSkillFrontmatter,
  type PluginEnabledMap,
  type PluginHook,
  type PluginHostKind,
  type PluginMcpServer,
  type PluginRecord,
  type PluginSkill,
  type PluginSnapshot
} from '../../shared/plugins.ts'
import { pluginRootsForHost, vavStateFiles } from './pluginPaths.ts'

const SKIP_DIR = new Set(['node_modules', '.git', 'cache'])

export function readJsonFile(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

export function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function listDirs(path: string): string[] {
  try {
    return readdirSync(path)
      .filter((name) => !name.startsWith('.') && !SKIP_DIR.has(name))
      .map((name) => join(path, name))
      .filter(isDir)
  } catch {
    return []
  }
}

function findManifest(dir: string): { path: string; kind: 'agent' | 'cursor' | 'claude' | 'vav' } | null {
  const candidates: Array<{ rel: string; kind: 'agent' | 'cursor' | 'claude' | 'vav' }> = [
    { rel: 'plugin.json', kind: 'agent' },
    { rel: join('.vav-plugin', 'plugin.json'), kind: 'vav' },
    { rel: join('.cursor-plugin', 'plugin.json'), kind: 'cursor' },
    { rel: join('.claude-plugin', 'plugin.json'), kind: 'claude' }
  ]
  for (const item of candidates) {
    const path = join(dir, item.rel)
    if (isFile(path)) return { path, kind: item.kind }
  }
  return null
}

function skillFromDir(dir: string, pluginId: string, enabled: boolean): PluginSkill | null {
  const skillMd = join(dir, 'SKILL.md')
  if (!isFile(skillMd)) return null
  const body = readTextFile(skillMd) ?? ''
  const meta = parseSkillFrontmatter(body)
  const id = basename(dir)
  return {
    id,
    name: meta.name || id,
    description: (meta.description || firstMarkdownSentence(body) || id).slice(0, 240),
    path: skillMd,
    dir,
    enabled,
    pluginId
  }
}

function firstMarkdownSentence(markdown: string): string {
  const line = markdown
    .replace(/^---[\s\S]*?---/, '')
    .split('\n')
    .map((row) => row.replace(/^#+\s*/, '').trim())
    .find((row) => row && !row.startsWith('```'))
  return line ?? ''
}

function collectSkills(pluginDir: string, pluginId: string, enabled: boolean, manifest: Record<string, unknown> | null): PluginSkill[] {
  const skills: PluginSkill[] = []
  const seen = new Set<string>()
  const add = (skill: PluginSkill | null): void => {
    if (!skill || seen.has(skill.dir)) return
    seen.add(skill.dir)
    skills.push(skill)
  }

  const declared = manifest?.skills
  const extraDirs: string[] = []
  if (typeof declared === 'string') extraDirs.push(join(pluginDir, declared))
  else if (Array.isArray(declared)) {
    for (const item of declared) {
      if (typeof item === 'string') extraDirs.push(join(pluginDir, item))
    }
  }
  extraDirs.push(join(pluginDir, 'skills'))

  for (const root of extraDirs) {
    if (isFile(join(root, 'SKILL.md'))) add(skillFromDir(root, pluginId, enabled))
    else {
      for (const child of listDirs(root)) add(skillFromDir(child, pluginId, enabled))
    }
  }
  if (skills.length === 0) add(skillFromDir(pluginDir, pluginId, enabled))
  return skills
}

function collectMcp(pluginDir: string, pluginId: string, enabled: boolean, manifest: Record<string, unknown> | null): PluginMcpServer[] {
  const files = [
    typeof manifest?.mcpServers === 'string' ? join(pluginDir, manifest.mcpServers) : '',
    join(pluginDir, 'mcp.json'),
    join(pluginDir, '.mcp.json')
  ].filter(Boolean)
  if (manifest?.mcpServers && typeof manifest.mcpServers === 'object') {
    return parseMcpServersFile(manifest.mcpServers, join(pluginDir, 'plugin.json'), pluginId).map((row) => ({
      ...row,
      enabled: enabled && row.enabled
    }))
  }
  for (const file of files) {
    if (!isFile(file)) continue
    return parseMcpServersFile(readJsonFile(file), file, pluginId).map((row) => ({
      ...row,
      enabled: enabled && row.enabled
    }))
  }
  return []
}

function collectHooks(pluginDir: string, pluginId: string, enabled: boolean, manifest: Record<string, unknown> | null): PluginHook[] {
  const files = [
    typeof manifest?.hooks === 'string' ? join(pluginDir, manifest.hooks) : '',
    join(pluginDir, 'hooks', 'hooks.json'),
    join(pluginDir, 'hooks.json')
  ].filter(Boolean)
  if (manifest?.hooks && typeof manifest.hooks === 'object') {
    return parseHooksFile(manifest.hooks, join(pluginDir, 'plugin.json'), pluginId).map((row) => ({
      ...row,
      enabled
    }))
  }
  for (const file of files) {
    if (!isFile(file)) continue
    return parseHooksFile(readJsonFile(file), file, pluginId).map((row) => ({
      ...row,
      enabled
    }))
  }
  return []
}

export function discoverPluginDir(
  dir: string,
  opts: { pluginId: string; enabled: boolean; origin: PluginRecord['origin']; readOnly: boolean }
): PluginRecord | null {
  const manifestHit = findManifest(dir)
  const manifest = manifestHit ? asRecord(readJsonFile(manifestHit.path)) : null
  const name =
    (typeof manifest?.name === 'string' && manifest.name.trim()) ||
    basename(dir)
  const skills = collectSkills(dir, opts.pluginId, opts.enabled, manifest)
  const mcpServers = collectMcp(dir, opts.pluginId, opts.enabled, manifest)
  const hooks = collectHooks(dir, opts.pluginId, opts.enabled, manifest)
  if (!manifestHit && skills.length === 0 && mcpServers.length === 0 && hooks.length === 0) {
    return null
  }
  return {
    id: opts.pluginId,
    name,
    description: typeof manifest?.description === 'string' ? manifest.description : undefined,
    version: typeof manifest?.version === 'string' ? manifest.version : undefined,
    enabled: opts.enabled,
    readOnly: opts.readOnly,
    origin: opts.origin,
    dir,
    manifestPath: manifestHit?.path,
    skills,
    mcpServers,
    hooks
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function walkPluginRoots(scan: string[], seen: Set<string>): string[] {
  const dirs: string[] = []
  for (const root of scan) {
    if (!isDir(root)) continue
    if (findManifest(root) || isFile(join(root, 'SKILL.md'))) {
      dirs.push(root)
      continue
    }
    for (const child of listDirs(root)) {
      if (seen.has(child)) continue
      seen.add(child)
      if (findManifest(child) || isFile(join(child, 'SKILL.md')) || isDir(join(child, 'skills'))) {
        dirs.push(child)
        continue
      }
      // Marketplace cache sometimes nests one extra folder.
      for (const nested of listDirs(child)) {
        if (seen.has(nested)) continue
        seen.add(nested)
        if (findManifest(nested) || isFile(join(nested, 'SKILL.md'))) dirs.push(nested)
      }
    }
  }
  return dirs
}

export function discoverHostPlugins(
  host: PluginHostKind,
  home = process.env.HOME || process.env.USERPROFILE || '',
  extras?: {
    bundled?: PluginRecord | null
    enabled?: PluginEnabledMap
  }
): PluginSnapshot {
  const { root, scan } = pluginRootsForHost(host, home || undefined)
  const enabledMap = extras?.enabled ?? emptyEnabledForHost(host, home)
  const plugins: PluginRecord[] = []
  if (host === 'vav' && extras?.bundled) plugins.push(extras.bundled)

  const seen = new Set<string>()
  if (host === 'vav') {
    const files = vavStateFiles(home)
    const looseSkills: PluginSkill[] = []
    for (const dir of listDirs(files.skillsDir)) {
      const skill = skillFromDir(dir, 'vav:user-skills', true)
      if (skill) looseSkills.push({ ...skill, enabled: isPluginEnabled(enabledMap, `skill:${skill.id}`, true) })
    }
    if (looseSkills.length || existsSync(files.skillsDir)) {
      plugins.push({
        id: 'vav:user-skills',
        name: 'User skills',
        description: files.skillsDir,
        enabled: true,
        readOnly: false,
        origin: 'user',
        dir: files.skillsDir,
        skills: looseSkills,
        mcpServers: [],
        hooks: []
      })
    }
    const globalMcp = isFile(files.mcp)
      ? parseMcpServersFile(readJsonFile(files.mcp), files.mcp, 'vav:global-mcp')
      : []
    const globalHooks = isFile(files.hooks)
      ? parseHooksFile(readJsonFile(files.hooks), files.hooks, 'vav:global-hooks')
      : []
    plugins.push({
      id: 'vav:global-mcp',
      name: 'MCP servers',
      description: files.mcp,
      enabled: true,
      readOnly: false,
      origin: 'user',
      dir: files.home,
      manifestPath: isFile(files.mcp) ? files.mcp : undefined,
      skills: [],
      mcpServers: globalMcp,
      hooks: []
    })
    plugins.push({
      id: 'vav:global-hooks',
      name: 'Hooks',
      description: files.hooks,
      enabled: true,
      readOnly: false,
      origin: 'user',
      dir: files.home,
      manifestPath: isFile(files.hooks) ? files.hooks : undefined,
      skills: [],
      mcpServers: [],
      hooks: globalHooks
    })
  }

  for (const dir of walkPluginRoots(scan, seen)) {
    const id = `${host}:plugin:${basename(dir)}`
    const record = discoverPluginDir(dir, {
      pluginId: id,
      enabled: isPluginEnabled(enabledMap, id, true),
      origin: host === 'vav' ? 'user' : 'host',
      readOnly: host !== 'vav'
    })
    if (record) plugins.push(record)
  }

  if (host === 'claude') {
    mergeClaudeSettings(root, plugins)
  }
  if (host === 'cursor') {
    mergeSidecarConfig(join(root, '..', 'mcp.json'), 'cursor:mcp', 'MCP servers', plugins)
  }

  return {
    host,
    hostLabel: host === 'vav' ? 'VAV' : displayNameForCliHost(host),
    root,
    writable: host === 'vav',
    plugins
  }
}

function emptyEnabledForHost(host: PluginHostKind, home: string): PluginEnabledMap {
  if (host === 'vav') {
    const file = vavStateFiles(home).enabled
    return parsePluginEnabledMap(isFile(file) ? readJsonFile(file) : null)
  }
  if (host === 'claude') {
    const settings = join(pluginRootsForHost(host, home).root, 'settings.json')
    const rec = asRecord(readJsonFile(settings))
    return parsePluginEnabledMap(rec?.enabledPlugins ?? rec?.enabled)
  }
  return parsePluginEnabledMap(null)
}

function mergeClaudeSettings(root: string, plugins: PluginRecord[]): void {
  const settings = join(root, 'settings.json')
  const claudeJson = join(root, '..', '.claude.json')
  const settingsRec = asRecord(readJsonFile(settings))
  const claudeRec = asRecord(readJsonFile(isFile(join(root, '.claude.json')) ? join(root, '.claude.json') : claudeJson))
  const mcp = parseMcpServersFile(
    settingsRec?.mcpServers ?? claudeRec?.mcpServers,
    isFile(settings) ? settings : claudeJson,
    'claude:settings-mcp'
  )
  const hooks = parseHooksFile(settingsRec?.hooks, settings, 'claude:settings-hooks')
  if (mcp.length) {
    plugins.push({
      id: 'claude:settings-mcp',
      name: 'MCP servers',
      enabled: true,
      readOnly: true,
      origin: 'host',
      manifestPath: settings,
      skills: [],
      mcpServers: mcp,
      hooks: []
    })
  }
  if (hooks.length) {
    plugins.push({
      id: 'claude:settings-hooks',
      name: 'Hooks',
      enabled: true,
      readOnly: true,
      origin: 'host',
      manifestPath: settings,
      skills: [],
      mcpServers: [],
      hooks
    })
  }
}

function mergeSidecarConfig(
  path: string,
  id: string,
  name: string,
  plugins: PluginRecord[]
): void {
  if (!isFile(path)) return
  const mcp = parseMcpServersFile(readJsonFile(path), path, id)
  if (!mcp.length) return
  plugins.push({
    id,
    name,
    enabled: true,
    readOnly: true,
    origin: 'host',
    manifestPath: path,
    skills: [],
    mcpServers: mcp,
    hooks: []
  })
}
