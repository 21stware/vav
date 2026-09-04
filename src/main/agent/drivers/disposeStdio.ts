/**
 * Graceful stdin-EOF, then SIGTERM, then SIGKILL so wedged CLI agents
 * cannot linger as zombies. Callers must still mark themselves disposed.
 */

export type DisposableStdio = {
  child: {
    killed: boolean
    once(event: 'exit', listener: () => void): unknown
  }
  closeStdin(): void
  kill(signal?: NodeJS.Signals): void
}

export const STDIO_DISPOSE_GRACE_MS = 2_000

export function disposeStdioProcess(
  proc: DisposableStdio,
  opts?: { graceMs?: number }
): { cancel(): void } {
  const graceMs = opts?.graceMs ?? STDIO_DISPOSE_GRACE_MS
  let termTimer: ReturnType<typeof setTimeout> | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let finished = false

  const cancel = (): void => {
    if (finished) return
    finished = true
    if (termTimer) clearTimeout(termTimer)
    if (killTimer) clearTimeout(killTimer)
  }

  try {
    proc.child.once('exit', cancel)
  } catch {
    /* fake / already gone */
  }

  proc.closeStdin()
  if (proc.child.killed) {
    cancel()
    return { cancel }
  }

  termTimer = setTimeout(() => {
    try {
      proc.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    if (finished) return
    killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, graceMs)
  }, graceMs)

  return { cancel }
}
