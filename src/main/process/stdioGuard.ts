/**
 * Dev runners / IDE task hosts often close the stdio pipe while Electron is
 * still alive. Unhandled `write EPIPE` from console.log/error then surfaces as
 * a fatal "Uncaught Exception" dialog.
 */

export function isIgnorableStreamError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') return true
  const msg = String((err as Error | undefined)?.message ?? err ?? '')
  return /EPIPE|ERR_STREAM_DESTROYED/i.test(msg)
}

export function ignoreEpipe(stream: NodeJS.WriteStream | null | undefined): void {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (isIgnorableStreamError(err)) return
    // Re-emit anything else so real stream failures still surface.
    if (stream.listenerCount('error') <= 1) {
      // no other handlers — avoid throwing from the error event itself
    }
  })
}

export function installProcessErrorGuards(): void {
  ignoreEpipe(process.stdout)
  ignoreEpipe(process.stderr)
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    if (isIgnorableStreamError(err)) return
    try {
      console.error('[uncaughtException]', err)
    } catch {
      // stdout may already be dead
    }
  })
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    if (isIgnorableStreamError(err)) return
    try {
      console.error('[unhandledRejection]', err)
    } catch {
      // stdout may already be dead
    }
  })
}
