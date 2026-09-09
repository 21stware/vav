import { homedir } from 'node:os'
import { ensureDefaultProfile } from '@main/daemon/serverProfiles.ts'

/**
 * Default headless vav-server state (`--state`, identity, timers): the `default`
 * profile under `~/.vav/servers/default`. Folds a legacy `~/.vav-server` / `~/.vavd`
 * into it on first use so desktop timers and CLI servers share one runtime.
 */
export function defaultVavServerStateDir(home = homedir()): string {
  return ensureDefaultProfile(home)
}
