/**
 * Background CLI install runs.
 *
 * The installer is deliberately self-contained: no PTY, no tray chip, no
 * companion window. It streams a headless child process and surfaces one
 * sanitized log line so Settings can show progress inline.
 */

export type AgentInstallRunStatus = 'running' | 'success' | 'error' | 'cancelled'

export interface AgentInstallRun {
  agentId: string
  name: string
  status: AgentInstallRunStatus
  /** Latest sanitized output line (single line, already truncated). */
  line: string
  startedAt: number
  endedAt: number | null
  exitCode: number | null
}

export const INSTALL_LOG_MAX_CHARS = 160

/** Hard stop so a wedged installer cannot run forever in the background. */
export const INSTALL_TIMEOUT_MS = 10 * 60_000

// CSI / OSC / single-char escapes emitted by curl, npm, and install scripts.
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex -- terminal escapes are control chars by definition
  /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]|\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g

// eslint-disable-next-line no-control-regex -- backspace / bell / carriage noise
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, '')
}

/**
 * Fold a raw stdout/stderr chunk into the single line shown in Settings.
 *
 * Progress bars overwrite themselves with `\r`, so the last segment of the
 * chunk is what a terminal would be showing. Returns `previous` when the chunk
 * carries no printable text (keeps the UI from flickering to empty).
 */
export function installLogLine(previous: string, chunk: string): string {
  const parts = stripAnsi(chunk).split(/[\r\n]+/)
  for (let i = parts.length - 1; i >= 0; i--) {
    const line = parts[i]?.replace(/\s+/g, ' ').trim() ?? ''
    if (!line) continue
    return line.length > INSTALL_LOG_MAX_CHARS
      ? `${line.slice(0, INSTALL_LOG_MAX_CHARS - 1)}…`
      : line
  }
  return previous
}

/** Env vars that turn a fresh child process into a hostile shell for installers. */
const DROPPED_ENV_KEYS = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'npm_execpath', 'npm_lifecycle_event']

/**
 * Strip every prompt an install script might raise: no TTY on stdin, plus the
 * conventional "assume yes / no colour / no pager" flags. Anything that still
 * insists on a confirmation reads EOF and aborts instead of hanging forever.
 */
export function nonInteractiveInstallEnv(
  base: NodeJS.ProcessEnv,
  overrides: { path: string; home: string; shell: string }
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value == null) continue
    if (DROPPED_ENV_KEYS.includes(key)) continue
    env[key] = value
  }
  return {
    ...env,
    PATH: overrides.path,
    HOME: overrides.home,
    SHELL: overrides.shell,
    TERM: 'dumb',
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    CLICOLOR: '0',
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    DEBIAN_FRONTEND: 'noninteractive',
    NONINTERACTIVE: '1',
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1',
    HOMEBREW_NO_ENV_HINTS: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'true',
    SSH_ASKPASS: 'true',
    PIP_NO_INPUT: '1',
    PYTHONUNBUFFERED: '1',
    npm_config_yes: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_progress: 'false',
    npm_config_update_notifier: 'false',
    NPM_CONFIG_YES: 'true',
    VAV_HEADLESS_INSTALL: '1'
  }
}

export function isAgentInstallRunActive(run: AgentInstallRun | null | undefined): boolean {
  return run?.status === 'running'
}
