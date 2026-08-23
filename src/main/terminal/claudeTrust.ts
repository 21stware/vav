/**
 * Pre-accept Claude Code's workspace trust dialog for a cwd.
 *
 * Claude Code stores trust in ~/.claude.json under:
 *   projects["/abs/path"].hasTrustDialogAccepted = true
 *
 * `--dangerously-skip-permissions` does NOT skip this dialog (Claude issue
 * #28506). vav owns the working directories it creates (Temporary Workspace
 * under /tmp/vav/… or user-picked paths), so pre-trusting is appropriate
 * when spawning Claude as a hosted agent.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { realpathSync } from 'node:fs'

function claudeConfigPath(): string {
  return join(homedir(), '.claude.json')
}

/** Path forms Claude may use as project keys. */
function pathKeys(cwd: string): string[] {
  const keys = new Set<string>()
  const add = (p: string): void => {
    const n = p.trim()
    if (!n || n === '~') return
    keys.add(n)
    // macOS often exposes /var → /private/var
    if (n.startsWith('/var/')) keys.add(`/private${n}`)
    if (n.startsWith('/private/var/')) keys.add(n.replace(/^\/private/, ''))
    if (n.startsWith('/tmp/')) keys.add(`/private${n}`)
    if (n.startsWith('/private/tmp/')) keys.add(n.replace(/^\/private/, ''))
  }
  add(cwd)
  try {
    add(realpathSync(cwd))
  } catch {
    // cwd may not exist yet
  }
  return [...keys]
}

/** cwds already known trusted this process — skip re-reading ~/.claude.json. */
const trustedMemo = new Set<string>()

function readConfig(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {}
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Mark `cwd` (and realpath aliases) as trusted so Claude Code skips the
 * "Yes, I trust this folder" startup dialog.
 */
export function ensureClaudeWorkspaceTrusted(cwd: string): void {
  const abs = cwd?.trim()
  if (!abs || abs === '~') return
  if (trustedMemo.has(abs)) return

  const configPath = claudeConfigPath()
  const keys = pathKeys(abs)
  if (keys.length === 0) return

  try {
    const config = readConfig(configPath)
    const projects =
      config.projects && typeof config.projects === 'object' && !Array.isArray(config.projects)
        ? ({ ...(config.projects as Record<string, unknown>) } as Record<string, unknown>)
        : {}

    let changed = false
    for (const key of keys) {
      const prev =
        projects[key] && typeof projects[key] === 'object' && !Array.isArray(projects[key])
          ? ({ ...(projects[key] as Record<string, unknown>) } as Record<string, unknown>)
          : {}
      if (prev.hasTrustDialogAccepted === true) continue
      projects[key] = {
        ...prev,
        hasTrustDialogAccepted: true
      }
      changed = true
    }
    if (!changed) {
      trustedMemo.add(abs)
      return
    }

    config.projects = projects
    mkdirSync(dirname(configPath), { recursive: true })
    const tmp = `${configPath}.vav-tmp`
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    renameSync(tmp, configPath)
    trustedMemo.add(abs)
  } catch (err) {
    console.warn('[claude-trust] failed to pre-trust workspace', abs, err)
  }
}

export function clearClaudeTrustMemo(): void {
  trustedMemo.clear()
}

/** True when the executable looks like Claude Code. */
export function isClaudeCodeBinary(command: string): boolean {
  const base = command.trim().split(/[/\\]/).pop()?.toLowerCase() ?? ''
  return base === 'claude' || base === 'claude.exe'
}
