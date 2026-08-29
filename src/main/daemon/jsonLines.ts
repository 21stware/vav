import { createHash, timingSafeEqual } from 'node:crypto'
import type { Socket } from 'node:net'
import { drainJsonLines, REMOTE_MAX_LINE_BYTES } from '../../shared/remoteControl.ts'
import { DAEMON_MAX_LINE_BYTES, encodeDaemonLine } from '../../shared/daemonProtocol.ts'

export function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

export function writeLine(socket: Socket, message: Record<string, unknown>): void {
  if (socket.destroyed) return
  socket.write(encodeDaemonLine(message))
}

export type LineSocketListener = (value: unknown | null) => void

/**
 * UTF-8 JSON-line reader. Calls `onFrame` for each parsed line (`null` = bad JSON).
 * Drops the socket when the buffer exceeds the daemon frame cap.
 */
export function attachLineReader(
  socket: Socket,
  onFrame: LineSocketListener,
  opts?: { leftover?: string; maxBytes?: number }
): void {
  const max = opts?.maxBytes ?? Math.max(DAEMON_MAX_LINE_BYTES, REMOTE_MAX_LINE_BYTES)
  let buffer = opts?.leftover ?? ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    if (buffer.length > max) {
      socket.destroy()
      return
    }
    const { values, rest } = drainJsonLines(buffer)
    buffer = rest
    for (const value of values) onFrame(value)
  })
}
