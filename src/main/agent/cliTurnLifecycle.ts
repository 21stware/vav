/**
 * Policy for CLI-host turn lifecycle: process death, in-flight spawn,
 * and ephemeral workdirs that macOS may have cleaned out from under us.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { isEphemeralWorkspaceKey } from '../../shared/accounts.ts'

/** How a `process-exited` event should affect the live CLI turn. */
export type ProcessExitDisposition = 'ignore' | 'defer' | 'fail' | 'cancel'

/**
 * A live turn that is not in retry-backoff must seal when the child dies.
 * `skipNextExit` is only for idle replacements — using it while a turn is
 * running leaves the UI streaming with no process.
 */
export function processExitDisposition(opts: {
  skipNextExit: boolean
  hasTurn: boolean
  settling: boolean
  cancelled: boolean
}): ProcessExitDisposition {
  if (opts.hasTurn && !opts.settling) {
    return opts.cancelled ? 'cancel' : 'fail'
  }
  if (opts.skipNextExit) return 'ignore'
  if (opts.hasTurn && opts.settling) return 'defer'
  return 'ignore'
}

/**
 * Drivers that `dispose()` suppress `process-exited`. Arming a skip for that
 * swallowed event leaves the flag set for the *next* child, which then dies
 * silently and the turn hangs.
 */
export function shouldArmIgnoreNextExit(exitWillBeEmitted: boolean): boolean {
  return exitWillBeEmitted
}

/** Stop before the host reported `turn-started` cannot interrupt ACP handshake. */
export function shouldDisposeHungBootstrap(opts: {
  hasTurn: boolean
  sawTurnStarted: boolean
}): boolean {
  return opts.hasTurn && !opts.sawTurnStarted
}

export function bumpSpawnGeneration(map: Map<string, number>, id: string): number {
  const next = (map.get(id) ?? 0) + 1
  map.set(id, next)
  return next
}

export function isCurrentSpawnGeneration(
  map: Map<string, number>,
  id: string,
  started: number
): boolean {
  return (map.get(id) ?? 0) === started
}

/**
 * Recreate a minted TEMP DIR (`…/vav/<8 hex>/Workspace`) if the OS cleaned it.
 * Real project paths that vanished are left alone so spawn fails loudly.
 */
export function recreateEphemeralCliCwd(
  cwd: string,
  io: {
    exists(path: string): boolean
    mkdir(path: string): void
  } = {
    exists: existsSync,
    mkdir: (path) => mkdirSync(path, { recursive: true })
  }
): { cwd: string; recreated: boolean } {
  if (!cwd || io.exists(cwd)) return { cwd, recreated: false }
  if (!isEphemeralWorkspaceKey(cwd)) return { cwd, recreated: false }
  io.mkdir(cwd)
  return { cwd, recreated: true }
}

/**
 * Cursor TUI flags. `AgentConfig.defaultArgs` is `--force --trust`; those
 * belong on the interactive CLI, not `cursor-agent acp`.
 */
const CURSOR_ACP_DROP_ARGS = new Set(['--force', '--trust', '--yolo'])

export function filterAcpExtraArgs(kind: string, extra: readonly string[]): string[] {
  if (kind !== 'cursor') return [...extra]
  return extra.filter((token) => !CURSOR_ACP_DROP_ARGS.has(token))
}
