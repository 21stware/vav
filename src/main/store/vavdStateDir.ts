import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default headless vavd state (`--state`, identity, timers). */
export function defaultVavdStateDir(home = homedir()): string {
  return join(home, '.vavd')
}
