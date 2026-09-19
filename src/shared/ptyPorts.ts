/**
 * Listen ports discovered on a PTY process tree, and how this computer
 * maps them onto loopback.
 *
 * Local hosts already bind here — status is `local`. A paired remote host
 * gets a same-port TCP proxy; collision stays `conflict` (no silent remap).
 */

export type PtyPortForwardStatus = 'local' | 'forwarding' | 'conflict' | 'error'

export type PtyPortForward = {
  remotePort: number
  /** Bound local port. 0 when the row is not listening here. */
  localPort: number
  status: PtyPortForwardStatus
}

export function isListenPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

export function normalizeListenPorts(ports: readonly number[]): number[] {
  const out: number[] = []
  for (const port of ports) {
    if (!isListenPort(port) || out.includes(port)) continue
    out.push(port)
  }
  out.sort((a, b) => a - b)
  return out
}

export function listenPortsEqual(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every((port, i) => port === right[i])
}

export function portForwardsEqual(
  a: readonly PtyPortForward[] | undefined,
  b: readonly PtyPortForward[] | undefined
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every((row, i) => {
    const other = right[i]!
    return (
      row.remotePort === other.remotePort &&
      row.localPort === other.localPort &&
      row.status === other.status
    )
  })
}

export function formatPortMark(port: number): string {
  return `:${port}`
}

export function loopbackHttpUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function portForwardKey(hostId: string, remotePort: number): string {
  return `${hostId}:${remotePort}`
}

/** Target a proxy may connect to on the host — loopback only (no SSRF pivot). */
export function isLoopbackProxyTarget(host: string | undefined): boolean {
  const value = host?.trim().toLowerCase() ?? ''
  return value === '' || value === '127.0.0.1' || value === '::1' || value === 'localhost'
}
