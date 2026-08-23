import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CURSOR_ACCESS_SERVICE = 'cursor-access-token'
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')
}

export function claudeKeychainUser(): string {
  return process.env.USER || process.env.USERNAME || 'user'
}

export function claudeKeychainService(configDir = claudeConfigDir()): string {
  const suffix = createHash('sha256').update(configDir).digest('hex').slice(0, 8)
  return `${CLAUDE_KEYCHAIN_SERVICE}-${suffix}`
}

export function claudeCredentialsPath(configDir = claudeConfigDir()): string {
  return join(configDir, '.credentials.json')
}

export function grokHome(): string {
  return process.env.GROK_HOME?.trim() || join(homedir(), '.grok')
}

export function grokAuthPath(): string {
  return join(grokHome(), 'auth.json')
}

export function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
}

export function codexAuthPath(): string {
  return join(codexHome(), 'auth.json')
}

export function opencodeDataDir(): string {
  return process.env.XDG_DATA_HOME?.trim()
    ? join(process.env.XDG_DATA_HOME.trim(), 'opencode')
    : join(homedir(), '.local', 'share', 'opencode')
}

export function opencodeAuthPath(): string {
  return join(opencodeDataDir(), 'auth.json')
}

export function piAuthPath(): string {
  return join(homedir(), '.pi', 'agent', 'auth.json')
}
