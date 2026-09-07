/**
 * Agent Plugins — skills, MCP servers, and hooks the Files tray manages.
 *
 * VAV owns `~/.vav` (override with `VAV_HOME`). ACP / CLI hosts keep their
 * own trees; the tray reads those files so edits match what the host loads.
 */
import { isAcpCliHost, type CliHostKind } from './cliHost.ts'

export type PluginHostKind = 'vav' | CliHostKind

export type PluginOrigin = 'bundled' | 'user' | 'host'

export type PluginComponentKind = 'skill' | 'mcp' | 'hook'

export const PLUGIN_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse'
] as const

export type PluginHookEvent = (typeof PLUGIN_HOOK_EVENTS)[number]

export interface PluginSkill {
  id: string
  name: string
  description: string
  path: string
  dir: string
  enabled: boolean
  pluginId: string
}

export interface PluginMcpServer {
  id: string
  name: string
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  configPath: string
  enabled: boolean
  pluginId: string
}

export interface PluginHook {
  id: string
  event: string
  matcher?: string
  command: string
  configPath: string
  enabled: boolean
  pluginId: string
}

export interface PluginRecord {
  id: string
  name: string
  description?: string
  version?: string
  enabled: boolean
  readOnly: boolean
  origin: PluginOrigin
  dir?: string
  manifestPath?: string
  skills: PluginSkill[]
  mcpServers: PluginMcpServer[]
  hooks: PluginHook[]
}

export interface PluginSnapshot {
  host: PluginHostKind
  hostLabel: string
  root: string
  writable: boolean
  plugins: PluginRecord[]
}

export interface PluginEnabledMap {
  version: 1
  enabled: Record<string, boolean>
}

export function pluginHostKind(cliHost: string | null | undefined): PluginHostKind {
  if (cliHost && cliHost !== 'vav') return cliHost as CliHostKind
  return 'vav'
}

export function pluginHostIsAcp(host: PluginHostKind): boolean {
  return host !== 'vav' && isAcpCliHost(host)
}

export function emptyPluginSnapshot(host: PluginHostKind = 'vav'): PluginSnapshot {
  return {
    host,
    hostLabel: host === 'vav' ? 'VAV' : host,
    root: '',
    writable: false,
    plugins: []
  }
}

export function isPluginSnapshot(value: unknown): value is PluginSnapshot {
  if (!value || typeof value !== 'object') return false
  const snap = value as Partial<PluginSnapshot>
  return typeof snap.host === 'string' && Array.isArray(snap.plugins)
}

/** Daemon `plugins.*` mutations return `{ ok, snapshot }`; desktop IPC unwraps to the snapshot. */
export function unwrapPluginMutation(
  value: unknown
): PluginSnapshot | { ok: false; error: string } {
  if (isPluginSnapshot(value)) return value
  if (value && typeof value === 'object') {
    const row = value as { ok?: unknown; snapshot?: unknown; error?: unknown }
    if (row.ok === false) {
      return { ok: false, error: typeof row.error === 'string' ? row.error : 'unavailable' }
    }
    if (row.ok === true && isPluginSnapshot(row.snapshot)) return row.snapshot
  }
  return { ok: false, error: 'unavailable' }
}

export function emptyPluginEnabledMap(): PluginEnabledMap {
  return { version: 1, enabled: {} }
}

export function parsePluginEnabledMap(raw: unknown): PluginEnabledMap {
  const rec = asRecord(raw)
  const enabled: Record<string, boolean> = {}
  const src = asRecord(rec?.enabled) ?? rec
  if (src) {
    for (const [key, value] of Object.entries(src)) {
      if (!key.trim()) continue
      if (value === false) enabled[key] = false
      else if (value === true) enabled[key] = true
    }
  }
  return { version: 1, enabled }
}

export function isPluginEnabled(map: PluginEnabledMap, id: string, fallback = true): boolean {
  if (Object.prototype.hasOwnProperty.call(map.enabled, id)) return map.enabled[id] === true
  return fallback
}

export function parseSkillFrontmatter(markdown: string): {
  name?: string
  description?: string
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
  const description = match[1]
    .match(/^description:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^['"]|['"]$/g, '')
  return { name, description }
}

export function parseMcpServersFile(
  raw: unknown,
  configPath: string,
  pluginId: string
): PluginMcpServer[] {
  const rec = asRecord(raw)
  const list =
    asArray(raw) ??
    asArray(rec?.mcpServers) ??
    asArray(rec?.servers) ??
    objectToNamedList(rec?.mcpServers ?? rec?.servers ?? rec)
  const out: PluginMcpServer[] = []
  for (const item of list) {
    const row = asRecord(item)
    if (!row) continue
    const name = asString(row.name) || asString(row.id)
    if (!name) continue
    const envRec = asRecord(row.env)
    const env: Record<string, string> = {}
    if (envRec) {
      for (const [key, value] of Object.entries(envRec)) {
        if (typeof value === 'string') env[key] = value
      }
    }
    const envList = asArray(row.env)
    if (envList) {
      for (const entry of envList) {
        const pair = asRecord(entry)
        const key = asString(pair?.name)
        const value = asString(pair?.value)
        if (key && value != null) env[key] = value
      }
    }
    const args = (asArray(row.args) ?? [])
      .map((part) => (typeof part === 'string' ? part : null))
      .filter((part): part is string => part != null)
    out.push({
      id: `${pluginId}:mcp:${name}`,
      name,
      command: asString(row.command) ?? undefined,
      args: args.length ? args : undefined,
      url: asString(row.url) ?? asString(row.href) ?? undefined,
      env: Object.keys(env).length ? env : undefined,
      configPath,
      enabled: row.enabled !== false,
      pluginId
    })
  }
  return out
}

export function parseHooksFile(
  raw: unknown,
  configPath: string,
  pluginId: string
): PluginHook[] {
  const rec = asRecord(raw)
  const hooksNode = rec?.hooks ?? rec
  const out: PluginHook[] = []
  let index = 0

  const push = (event: string, matcher: string | undefined, command: string): void => {
    if (!command.trim()) return
    index += 1
    out.push({
      id: `${pluginId}:hook:${index}`,
      event,
      matcher,
      command: command.trim(),
      configPath,
      enabled: true,
      pluginId
    })
  }

  if (asArray(hooksNode)) {
    for (const item of asArray(hooksNode) ?? []) {
      const row = asRecord(item)
      if (!row) continue
      const command = asString(row.command)
      if (!command) continue
      push(asString(row.event) || asString(row.name) || 'UserPromptSubmit', asString(row.matcher) ?? undefined, command)
    }
    return out
  }

  const events = asRecord(hooksNode)
  if (!events) return out
  for (const [event, value] of Object.entries(events)) {
    for (const group of asArray(value) ?? [value]) {
      const row = asRecord(group)
      if (!row) continue
      const matcher = asString(row.matcher) ?? undefined
      const inner = asArray(row.hooks) ?? (asString(row.command) ? [row] : [])
      for (const hook of inner) {
        const spec = asRecord(hook)
        const command = asString(spec?.command)
        if (command) push(event, matcher, command)
      }
    }
  }
  return out
}

export function hookEventMatches(event: string, wanted: PluginHookEvent): boolean {
  return event.trim().toLowerCase() === wanted.toLowerCase()
}

export function hookMatcherMatches(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === '*') return true
  const needle = matcher.trim().toLowerCase()
  const name = toolName.trim().toLowerCase()
  if (needle === name) return true
  if (needle.includes('|')) {
    return needle.split('|').some((part) => part.trim() === name)
  }
  try {
    return new RegExp(matcher, 'i').test(toolName)
  } catch {
    return name.includes(needle)
  }
}

export function mcpServersToFile(servers: PluginMcpServer[]): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {}
  for (const server of servers) {
    mcpServers[server.name] = {
      ...(server.command ? { command: server.command } : {}),
      ...(server.args?.length ? { args: server.args } : {}),
      ...(server.url ? { url: server.url } : {}),
      ...(server.env ? { env: server.env } : {})
    }
  }
  return { mcpServers }
}

export function hooksToFile(hooks: PluginHook[]): Record<string, unknown> {
  const grouped: Record<string, unknown[]> = {}
  for (const hook of hooks) {
    const event = hook.event || 'UserPromptSubmit'
    if (!grouped[event]) grouped[event] = []
    grouped[event].push({
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
      hooks: [{ type: 'command', command: hook.command }]
    })
  }
  return { hooks: grouped }
}

export function sanitizePluginName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64)
}

export function defaultSkillMarkdown(id: string): string {
  return [
    '---',
    `name: ${id}`,
    `description: User skill ${id}. Say when the agent should load this.`,
    '---',
    '',
    `# ${id}`,
    '',
    'Describe the workflow the agent should follow after `load_skill`.',
    ''
  ].join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function objectToNamedList(value: unknown): unknown[] {
  const rec = asRecord(value)
  if (!rec) return []
  return Object.entries(rec).map(([name, spec]) => {
    const row = asRecord(spec) ?? {}
    return { ...row, name: asString(row.name) || name }
  })
}
