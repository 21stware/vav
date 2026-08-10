/**
 * Environment for agent StickyShell / one-shot commands.
 * GUI Electron PATH is stripped; merge login PATH + bundled bin so tools like
 * `officecli` resolve the same way as in Terminal.app.
 */
import { loginPath } from './loginPath'

export function agentShellEnv(extra?: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  env.PATH = loginPath()
  env.TERM = extra?.TERM ?? 'dumb'
  env.PAGER = extra?.PAGER ?? 'cat'
  env.GIT_PAGER = extra?.GIT_PAGER ?? 'cat'
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete env[k]
      else if (k !== 'PATH') env[k] = v
    }
  }
  return env
}
