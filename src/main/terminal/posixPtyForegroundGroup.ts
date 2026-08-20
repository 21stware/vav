import { execFileSync } from 'node:child_process'

const PROCESS_TABLE_QUERY_TIMEOUT_MS = 125
const PROCESS_TABLE_MAX_BYTES = 64 * 1024

export type PosixPtyForegroundGroupDeps = {
  platform?: NodeJS.Platform
  currentPid?: number
  readProcessTable?: () => string
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

type ProcessRow = {
  pid: number
  tpgid: number
  tty: string
}

/** `ps` prints `ttys003` / `pts/3`; node-pty reports `/dev/ttys003` / `/dev/pts/3`. */
export function normalizeTty(value: string): string {
  return value.replace(/^\/dev\//, '')
}

function hasUsableTty(tty: string): boolean {
  return tty !== '?' && tty !== '??' && tty !== '-'
}

function runPs(pid: number): string {
  return execFileSync('ps', ['-p', String(pid), '-o', 'pid=,tpgid=,tty='], {
    encoding: 'utf8',
    timeout: PROCESS_TABLE_QUERY_TIMEOUT_MS,
    maxBuffer: PROCESS_TABLE_MAX_BYTES
  })
}

/**
 * Two single-pid `ps` calls rather than `-p a,b`: macOS only takes the fast
 * KERN_PROC_PID path for one pid. A list walks the whole table and can stall
 * a resize long enough that we skip the group signal entirely.
 */
function readForegroundGroupTable(rootPid: number, currentPid: number): string {
  return `${runPs(rootPid)}\n${runPs(currentPid)}`
}

export function parseProcessRows(output: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(-?\d+)\s+(\S+)/.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    if (pid > 0) {
      rows.push({ pid, tpgid: Number(match[2]), tty: match[3] })
    }
  }
  return rows
}

/**
 * Foreground process group of one PTY — the process the kernel would signal
 * on a real window-size change.
 *
 * The PTY root is often `login(1)` or a job-control shell that has already
 * `setpgid`'d away. Grok / OpenCode then sit in a third group. `tpgid` is the
 * only id that matches a kernel resize.
 */
export function getPosixPtyForegroundGroup(
  output: string,
  rootPid: number,
  ptsName: string,
  currentPid = process.pid
): number | null {
  const rows = parseProcessRows(output)
  const root = rows.find((row) => row.pid === rootPid)
  if (!root || !hasUsableTty(root.tty)) return null
  if (normalizeTty(root.tty) !== normalizeTty(ptsName)) return null
  // A dev daemon can inherit its launch TTY. Never group-signal then.
  if (rows.some((row) => row.pid === currentPid && row.tty === root.tty)) return null
  return root.tpgid > 1 ? root.tpgid : null
}

/**
 * SIGWINCH the tty's foreground group. Falls back to `fallback` when the
 * group cannot be established safely (Windows, missing pts, recycled pid).
 */
export function signalPosixPtyForegroundGroup(
  rootPid: number,
  ptsName: string | undefined,
  signal: NodeJS.Signals,
  fallback: () => void,
  deps: PosixPtyForegroundGroupDeps = {}
): void {
  if ((deps.platform ?? process.platform) === 'win32' || !ptsName) {
    fallback()
    return
  }
  const currentPid = deps.currentPid ?? process.pid
  const kill = deps.kill ?? ((pid, sig) => process.kill(pid, sig))
  let pgid: number | null
  try {
    const table = (deps.readProcessTable ?? (() => readForegroundGroupTable(rootPid, currentPid)))()
    pgid = getPosixPtyForegroundGroup(table, rootPid, ptsName, currentPid)
  } catch {
    pgid = null
  }
  if (pgid === null) {
    fallback()
    return
  }
  try {
    kill(-pgid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ESRCH') {
      fallback()
    }
  }
}

/** node-pty unix terminals expose the slave path; Windows has no equivalent. */
export function readPtsName(proc: unknown): string | undefined {
  const value = (proc as { ptsName?: unknown } | null | undefined)?.ptsName
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
