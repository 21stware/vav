import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CliHostKind } from '../../shared/cliHost'

export interface HostSessionLookup {
  id: string
  title: string | null
  updatedAt: number
}

export interface HostSessionStoreOptions {
  home?: string
}

export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/[^A-Za-z0-9]/g, '-')
}

export function encodeGrokSessionDir(cwd: string): string {
  return encodeURIComponent(cwd)
}

export function readHostSessionTitle(
  agentId: CliHostKind,
  sessionId: string,
  cwd: string,
  options?: HostSessionStoreOptions
): string | null {
  const home = options?.home ?? homedir()
  const id = sessionId.trim()
  if (!id) return null
  try {
    if (agentId === 'grok') return readGrokTitle(home, cwd, id)
    if (agentId === 'claude') return readClaudeTitle(home, cwd, id)
    if (agentId === 'codex') return readCodexTitle(home, id)
    if (agentId === 'cursor') return readCursorTitle(home, id)
    if (agentId === 'opencode') return readOpencodeTitle(home, id)
  } catch {
    return null
  }
  return null
}

/** True when the native session has a real user turn (not just an empty spawn). */
export function hostSessionHasConversation(
  agentId: CliHostKind,
  sessionId: string,
  cwd: string,
  options?: HostSessionStoreOptions
): boolean {
  const home = options?.home ?? homedir()
  const id = sessionId.trim()
  if (!id) return false
  try {
    if (agentId === 'grok') return grokHasConversation(home, cwd, id)
    if (agentId === 'claude') return claudeHasConversation(home, cwd, id)
    if (agentId === 'codex') return readCodexTitle(home, id) != null
    if (agentId === 'cursor') return cursorHasConversation(home, id)
    if (agentId === 'opencode') return readOpencodeTitle(home, id) != null
  } catch {
    return false
  }
  return false
}

/** True when the host has already written this session to disk. */
export function hostSessionExists(
  agentId: CliHostKind,
  sessionId: string,
  cwd: string,
  options?: HostSessionStoreOptions
): boolean {
  const home = options?.home ?? homedir()
  const id = sessionId.trim()
  if (!id) return false
  try {
    if (agentId === 'grok') {
      const dir = join(home, '.grok', 'sessions', encodeGrokSessionDir(cwd), id)
      return existsSync(dir) || existsSync(join(dir, 'summary.json'))
    }
    if (agentId === 'claude') {
      return existsSync(
        join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd), `${id}.jsonl`)
      )
    }
    if (agentId === 'codex') return readCodexTitle(home, id) != null || fileStampForCodex(home, id)
    if (agentId === 'cursor') {
      // Swarm TUI resume uses `~/.cursor/chats`, not ACP session folders.
      return findCursorChatMeta(home, id) != null
    }
    if (agentId === 'opencode') return readOpencodeTitle(home, id) != null
  } catch {
    return false
  }
  return false
}

function fileStampForCodex(home: string, sessionId: string): boolean {
  const index = join(home, '.codex', 'session_index.jsonl')
  if (!existsSync(index)) return false
  try {
    const text = readFileSync(index, 'utf8')
    return text.includes(sessionId)
  } catch {
    return false
  }
}

export function discoverHostSession(
  agentId: CliHostKind,
  cwd: string,
  opts: {
    afterMs: number
    excludeIds: Iterable<string>
    home?: string
  }
): HostSessionLookup | null {
  const listed = listHostSessions(agentId, cwd, {
    afterMs: opts.afterMs,
    excludeIds: opts.excludeIds,
    home: opts.home
  })
  return listed[0] ?? null
}

/** Every native session this host has written for `cwd`, newest first. */
export function listHostSessions(
  agentId: CliHostKind,
  cwd: string,
  opts?: {
    afterMs?: number
    excludeIds?: Iterable<string>
    home?: string
  }
): HostSessionLookup[] {
  const home = opts?.home ?? homedir()
  const exclude = new Set([...(opts?.excludeIds ?? [])].filter(Boolean))
  const afterMs = opts?.afterMs ?? 0
  try {
    if (agentId === 'grok') return listGrok(home, cwd, afterMs, exclude)
    if (agentId === 'claude') return listClaude(home, cwd, afterMs, exclude)
    if (agentId === 'codex') return listCodex(home, cwd, afterMs, exclude)
    if (agentId === 'cursor') return listCursor(home, cwd, afterMs, exclude)
    if (agentId === 'opencode') return listOpencode(home, cwd, afterMs, exclude)
  } catch {
    return []
  }
  return []
}

function grokHasConversation(home: string, cwd: string, sessionId: string): boolean {
  if (readGrokTitle(home, cwd, sessionId)) return true
  const file = join(
    home,
    '.grok',
    'sessions',
    encodeGrokSessionDir(cwd),
    sessionId,
    'chat_history.jsonl'
  )
  return jsonlHas(
    file,
    (row) => asString(row.type) === 'user' && row.synthetic_reason == null
  )
}

function claudeHasConversation(home: string, cwd: string, sessionId: string): boolean {
  if (readClaudeTitle(home, cwd, sessionId)) return true
  const file = join(
    home,
    '.claude',
    'projects',
    encodeClaudeProjectDir(cwd),
    `${sessionId}.jsonl`
  )
  return jsonlHas(file, (row) => {
    const type = asString(row.type)
    return type === 'user' || type === 'assistant' || type === 'ai-title'
  })
}

function cursorHasConversation(home: string, sessionId: string): boolean {
  const chat = findCursorChatMeta(home, sessionId)
  if (chat) {
    if (chat.hasConversation === true) return true
    if (cleanTitle(asString(chat.title))) return true
  }
  return readCursorTitle(home, sessionId) != null
}

function jsonlHas(file: string, match: (row: Record<string, unknown>) => boolean): boolean {
  if (!existsSync(file)) return false
  const text = readFileSync(file, 'utf8')
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    try {
      const row = asRecord(JSON.parse(raw))
      if (row && match(row)) return true
    } catch {
      /* skip truncated line */
    }
  }
  return false
}

function readGrokTitle(home: string, cwd: string, sessionId: string): string | null {
  const file = join(home, '.grok', 'sessions', encodeGrokSessionDir(cwd), sessionId, 'summary.json')
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  return cleanTitle(asString(raw.generated_title) || asString(raw.title))
}

function readClaudeTitle(home: string, cwd: string, sessionId: string): string | null {
  const file = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd), `${sessionId}.jsonl`)
  if (!existsSync(file)) return null
  return lastJsonlField(file, (row) =>
    asString(row.type) === 'ai-title' ? asString(row.aiTitle) || asString(row.title) : null
  )
}

function readCodexTitle(home: string, sessionId: string): string | null {
  const index = join(home, '.codex', 'session_index.jsonl')
  if (!existsSync(index)) return null
  return lastJsonlField(index, (row) => {
    const id = asString(row.id) || asString(row.session_id)
    if (id !== sessionId) return null
    return asString(row.thread_name) || asString(row.title)
  })
}

function readCursorTitle(home: string, sessionId: string): string | null {
  const chat = findCursorChatMeta(home, sessionId)
  if (chat) return cleanTitle(asString(chat.title))
  const file = join(home, '.cursor', 'acp-sessions', sessionId, 'meta.json')
  if (!existsSync(file)) return null
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  return cleanTitle(asString(raw.title))
}

function findCursorChatMeta(home: string, sessionId: string): Record<string, unknown> | null {
  const root = join(home, '.cursor', 'chats')
  if (!existsSync(root)) return null
  let projects: string[] = []
  try {
    projects = readdirSync(root)
  } catch {
    return null
  }
  for (const project of projects) {
    const file = join(root, project, sessionId, 'meta.json')
    if (!existsSync(file)) continue
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

function listGrok(
  home: string,
  cwd: string,
  afterMs: number,
  exclude: Set<string>
): HostSessionLookup[] {
  const dir = join(home, '.grok', 'sessions', encodeGrokSessionDir(cwd))
  if (!existsSync(dir)) return []
  const out: HostSessionLookup[] = []
  for (const name of readdirSync(dir)) {
    if (exclude.has(name)) continue
    const summary = join(dir, name, 'summary.json')
    const stamp = newestStamp(join(dir, name), summary)
    if (stamp < afterMs) continue
    const title = existsSync(summary) ? readGrokTitle(home, cwd, name) : null
    out.push({ id: name, title, updatedAt: stamp })
  }
  return sortNewest(out)
}

function listClaude(
  home: string,
  cwd: string,
  afterMs: number,
  exclude: Set<string>
): HostSessionLookup[] {
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(cwd))
  if (!existsSync(dir)) return []
  const out: HostSessionLookup[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const id = name.slice(0, -'.jsonl'.length)
    if (!id || exclude.has(id)) continue
    const file = join(dir, name)
    const stamp = fileStamp(file)
    if (stamp < afterMs) continue
    out.push({ id, title: readClaudeTitle(home, cwd, id), updatedAt: stamp })
  }
  return sortNewest(out)
}

function listCodex(
  home: string,
  cwd: string,
  afterMs: number,
  exclude: Set<string>
): HostSessionLookup[] {
  const root = join(home, '.codex', 'sessions')
  if (!existsSync(root)) return []
  const wanted = normalizeCwd(cwd)
  const byId = new Map<string, HostSessionLookup>()
  walkFiles(root, (file) => {
    if (!file.endsWith('.jsonl')) return
    const stamp = fileStamp(file)
    if (stamp < afterMs) return
    const meta = firstJsonlRecord(file)
    const payload = asRecord(meta?.payload) ?? meta
    if (!payload) return
    const id =
      asString(payload.session_id) ||
      asString(payload.id) ||
      asString(meta?.id)
    const sessionCwd = asString(payload.cwd)
    if (!id || exclude.has(id)) return
    if (sessionCwd && normalizeCwd(sessionCwd) !== wanted) return
    if (!sessionCwd && !id) return
    const prev = byId.get(id)
    if (prev && prev.updatedAt >= stamp) return
    byId.set(id, { id, title: readCodexTitle(home, id), updatedAt: stamp })
  })
  return sortNewest([...byId.values()])
}

function listCursor(
  home: string,
  cwd: string,
  afterMs: number,
  exclude: Set<string>
): HostSessionLookup[] {
  const wanted = normalizeCwd(cwd)
  const byId = new Map<string, HostSessionLookup>()
  const chatsRoot = join(home, '.cursor', 'chats')
  if (existsSync(chatsRoot)) {
    let projects: string[] = []
    try {
      projects = readdirSync(chatsRoot)
    } catch {
      projects = []
    }
    for (const project of projects) {
      const projectDir = join(chatsRoot, project)
      let names: string[] = []
      try {
        names = readdirSync(projectDir)
      } catch {
        continue
      }
      for (const name of names) {
        if (exclude.has(name)) continue
        const metaPath = join(projectDir, name, 'meta.json')
        if (!existsSync(metaPath)) continue
        let raw: Record<string, unknown>
        try {
          raw = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
        } catch {
          continue
        }
        const cwdValue = asString(raw.cwd)
        if (cwdValue && normalizeCwd(cwdValue) !== wanted) continue
        const updated = num(raw.updatedAtMs) ?? num(raw.createdAtMs) ?? fileStamp(metaPath)
        if (updated < afterMs) continue
        byId.set(name, {
          id: name,
          title: cleanTitle(asString(raw.title)),
          updatedAt: updated
        })
      }
    }
  }

  const acpRoot = join(home, '.cursor', 'acp-sessions')
  if (byId.size === 0 && existsSync(acpRoot)) {
    for (const name of readdirSync(acpRoot)) {
      if (exclude.has(name) || byId.has(name)) continue
      const metaPath = join(acpRoot, name, 'meta.json')
      if (!existsSync(metaPath)) continue
      const stamp = fileStamp(metaPath)
      if (stamp < afterMs) continue
      let cwdValue: string | null = null
      let title: string | null = null
      try {
        const raw = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
        cwdValue = asString(raw.cwd)
        title = cleanTitle(asString(raw.title))
      } catch {
        continue
      }
      if (cwdValue && normalizeCwd(cwdValue) !== wanted) continue
      byId.set(name, { id: name, title, updatedAt: stamp })
    }
  }
  return sortNewest([...byId.values()])
}

function readOpencodeTitle(home: string, sessionId: string): string | null {
  const rows = queryOpencode(
    home,
    'SELECT title, slug FROM session WHERE id = ? LIMIT 1',
    [sessionId]
  )
  const row = rows[0]
  if (!row) return null
  return cleanOpencodeTitle(asString(row.title), asString(row.slug))
}

function listOpencode(
  home: string,
  cwd: string,
  afterMs: number,
  exclude: Set<string>
): HostSessionLookup[] {
  const wanted = normalizeCwd(cwd)
  const rows = queryOpencode(
    home,
    `SELECT id, title, slug, directory, time_created, time_updated
     FROM session
     WHERE parent_id IS NULL
       AND (time_archived IS NULL OR time_archived = 0)`,
    []
  )
  const out: HostSessionLookup[] = []
  for (const row of rows) {
    const id = asString(row.id)
    if (!id || exclude.has(id)) continue
    const dir = asString(row.directory)
    if (!dir || normalizeCwd(dir) !== wanted) continue
    const created = num(row.time_created)
    const updated = num(row.time_updated)
    const stamp = Math.max(created ?? 0, updated ?? 0)
    if (stamp < afterMs) continue
    out.push({
      id,
      title: cleanOpencodeTitle(asString(row.title), asString(row.slug)),
      updatedAt: stamp
    })
  }
  return sortNewest(out)
}

function sortNewest(rows: HostSessionLookup[]): HostSessionLookup[] {
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

function cleanOpencodeTitle(title: string | null, slug: string | null): string | null {
  const cleaned = cleanTitle(title)
  if (!cleaned) return null
  if (slug && cleaned === slug) return null
  return cleaned
}

function opencodeDbPaths(home: string): string[] {
  const paths: string[] = []
  if (home === homedir()) {
    const xdg = process.env.XDG_DATA_HOME?.trim()
    if (xdg) paths.push(join(xdg, 'opencode', 'opencode.db'))
  }
  paths.push(join(home, '.local', 'share', 'opencode', 'opencode.db'))
  paths.push(join(home, '.opencode', 'opencode.db'))
  return [...new Set(paths)].filter((p) => existsSync(p))
}

function queryOpencode(home: string, sql: string, params: unknown[]): Record<string, unknown>[] {
  const DatabaseSync = loadDatabaseSync()
  if (!DatabaseSync) return []
  const out: Record<string, unknown>[] = []
  for (const dbPath of opencodeDbPaths(home)) {
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const rows = db.prepare(sql).all(...params)
        if (Array.isArray(rows)) out.push(...(rows as Record<string, unknown>[]))
      } finally {
        db.close()
      }
    } catch {
      /* locked / unexpected schema */
    }
  }
  return out
}

type SqliteDatabase = {
  prepare: (sql: string) => { all: (...params: unknown[]) => unknown }
  close: () => void
}

function loadDatabaseSync(): (new (path: string, opts?: { readOnly?: boolean }) => SqliteDatabase) | null {
  try {
    const req = createRequire(import.meta.url)
    const mod = req('node:sqlite') as {
      DatabaseSync?: new (path: string, opts?: { readOnly?: boolean }) => SqliteDatabase
    }
    return mod.DatabaseSync ?? null
  } catch {
    return null
  }
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function newestStamp(...paths: string[]): number {
  let best = 0
  for (const path of paths) {
    const stamp = fileStamp(path)
    if (stamp > best) best = stamp
  }
  return best
}

function fileStamp(path: string): number {
  try {
    const st = statSync(path)
    return Math.max(st.mtimeMs, st.birthtimeMs || 0)
  } catch {
    return 0
  }
}

function lastJsonlField(
  file: string,
  pick: (row: Record<string, unknown>) => string | null
): string | null {
  const text = readTail(file, 256 * 1024)
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line) continue
    try {
      const row = asRecord(JSON.parse(line))
      if (!row) continue
      const title = cleanTitle(pick(row))
      if (title) return title
    } catch {
      /* skip truncated first line */
    }
  }
  return null
}

function firstJsonlRecord(file: string): Record<string, unknown> | null {
  const text = readFileSync(file, 'utf8')
  const line = text.split('\n').find((row) => row.trim())
  if (!line) return null
  try {
    return asRecord(JSON.parse(line))
  } catch {
    return null
  }
}

function readTail(file: string, maxBytes: number): string {
  const buf = readFileSync(file)
  if (buf.length <= maxBytes) return buf.toString('utf8')
  return buf.subarray(buf.length - maxBytes).toString('utf8')
}

function walkFiles(root: string, visit: (file: string) => void): void {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const path = join(dir, name)
      let isDir = false
      try {
        isDir = statSync(path).isDirectory()
      } catch {
        continue
      }
      if (isDir) stack.push(path)
      else visit(path)
    }
  }
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '') || cwd
}

function cleanTitle(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
