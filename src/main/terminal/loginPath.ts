import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { bundledBinDir } from '../bundledBin'

/**
 * GUI apps (Electron / launchd) inherit a stripped PATH. Ask the login shell
 * once so CLI agents like `claude` / `codex` resolve the same way as Terminal.app.
 * Bundled helper bins (e.g. officecli) are prepended so they win over a stale
 * system install when present.
 */
let cachedLoginPath: string | null = null

function isExecutable(file: string): boolean {
  try {
    if (!existsSync(file)) return false
    accessSync(file, constants.X_OK)
    return true
  } catch {
    // Symlinks / odd permissions: still accept if the path exists.
    return existsSync(file)
  }
}

export function loginPath(): string {
  if (cachedLoginPath) return cachedLoginPath
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  try {
    const out = execFileSync(shell, ['-ilc', 'printenv PATH'], {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        HOME: homedir(),
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        SHELL: shell,
        TERM: 'dumb',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin'
      }
    })
      .trim()
      .split('\n')
      .at(-1)
    cachedLoginPath = (out ?? '').trim() || process.env.PATH || '/usr/bin:/bin'
  } catch {
    cachedLoginPath = process.env.PATH || '/usr/bin:/bin'
  }
  const home = homedir()
  // Common install prefixes GUI PATH often misses.
  const extras = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.local', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.grok', 'bin'),
    join(home, '.cursor', 'bin'),
    join(home, '.nvm', 'current', 'bin'),
    join(home, '.fnm', 'current', 'bin'),
    join(home, 'Library', 'pnpm'),
    join(home, '.yarn', 'bin'),
    join(home, '.bun', 'bin'),
    '/opt/homebrew/sbin',
    '/usr/local/sbin'
  ]
  const parts = [
    ...cachedLoginPath.split(delimiter),
    ...(process.env.PATH ?? '').split(delimiter),
    ...extras
  ]
    .map((p) => p.trim())
    .filter(Boolean)
  // Dedupe while preserving order; prepend bundled bin last so it leads.
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const p of parts) {
    if (seen.has(p)) continue
    seen.add(p)
    ordered.push(p)
  }
  const bundled = bundledBinDir()
  if (bundled && !seen.has(bundled)) {
    ordered.unshift(bundled)
  } else if (bundled) {
    const i = ordered.indexOf(bundled)
    if (i > 0) {
      ordered.splice(i, 1)
      ordered.unshift(bundled)
    }
  }
  cachedLoginPath = ordered.join(delimiter)
  return cachedLoginPath
}

/** Absolute path to an executable on login PATH, or null if missing. */
export function resolveOnLoginPath(command: string): string | null {
  if (!command) return null
  if (command.includes('/') || command.includes('\\')) {
    return isExecutable(command) ? command : null
  }
  const pathVar = loginPath()
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
      : ['']
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(
        dir,
        command + (ext && !command.toLowerCase().endsWith(ext.toLowerCase()) ? ext : '')
      )
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

/** Prefer first candidate that resolves. */
export function resolveFirstOnLoginPath(candidates: string[]): string | null {
  for (const c of candidates) {
    const hit = resolveOnLoginPath(c.trim())
    if (hit) return hit
  }
  return null
}

/**
 * Ask the login shell `command -v` — catches aliases/wrappers that a pure PATH
 * walk can miss (fnm shims, asdf, etc.).
 */
export function whichViaLoginShell(command: string): string | null {
  if (!command) return null
  if (command.includes('/') || command.includes('\\')) {
    return isExecutable(command) ? command : null
  }
  // Only allow simple executable names into the shell command.
  if (!/^[A-Za-z0-9._+-]+$/.test(command)) return resolveOnLoginPath(command)
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  try {
    // Let the login shell use *its* PATH (not only ours) so nvm/fnm hooks work.
    const out = execFileSync(shell, ['-ilc', `command -v ${command} || true`], {
      encoding: 'utf8',
      timeout: 8000,
      env: {
        HOME: homedir(),
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        SHELL: shell,
        TERM: 'dumb',
        PATH: loginPath()
      }
    })
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1)
    if (!out || out.includes('not found') || out.startsWith('alias ')) return null
    // command -v can print a path with spaces rarely; accept if exists.
    if (isExecutable(out)) return out
  } catch {
    // not found
  }
  return null
}

/** Positive resolve results are sticky; negative miss briefly so install→recheck works. */
const RESOLVE_OK_TTL_MS = 30 * 60_000
const RESOLVE_MISS_TTL_MS = 8_000
const resolveResultCache = new Map<string, { path: string | null; at: number }>()

function resolveCacheKey(candidates: string[]): string {
  return candidates.map((c) => c.trim()).filter(Boolean).join('\0')
}

/**
 * Resolve the first available agent binary on the login PATH.
 * Results are cached so agent switching does not re-spawn a login shell every time.
 * Pass `force: true` after install / explicit recheck.
 */
export function resolveAgentExecutable(
  candidates: string[],
  options?: { force?: boolean }
): string | null {
  const list = candidates.map((c) => c.trim()).filter(Boolean)
  if (list.length === 0) return null
  const key = resolveCacheKey(list)
  const now = Date.now()
  if (!options?.force) {
    const hit = resolveResultCache.get(key)
    if (hit) {
      const ttl = hit.path ? RESOLVE_OK_TTL_MS : RESOLVE_MISS_TTL_MS
      if (now - hit.at < ttl) return hit.path
    }
  } else {
    clearLoginPathCache()
  }

  const pathHit = resolveFirstOnLoginPath(list)
  if (pathHit) {
    resolveResultCache.set(key, { path: pathHit, at: now })
    return pathHit
  }
  // Login PATH was already loaded above. Spawning `zsh -ilc 'command -v …'`
  // for every miss freezes the Electron main process (seen when Settings /
  // quick-chat hammered settings.get / model preload). Only pay that cost on
  // an explicit force recheck (post-install).
  if (options?.force) {
    for (const c of list) {
      const hit = whichViaLoginShell(c)
      if (hit) {
        resolveResultCache.set(key, { path: hit, at: now })
        return hit
      }
    }
  }
  resolveResultCache.set(key, { path: null, at: now })
  return null
}

/** Drop PATH + binary resolve caches (tests / after user installs a CLI mid-session). */
export function clearLoginPathCache(): void {
  cachedLoginPath = null
  resolveResultCache.clear()
}
