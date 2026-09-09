/**
 * When the desktop is a UI for a loopback vav-server, incoming pairing
 * (Connect line, phone QR tunnel) must target that daemon — not the
 * in-process Electron hub.
 */
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'

export type VavServerShellTarget = {
  pairing: string
  port: number
  secret: string
}

export function isLoopbackHost(host?: string): boolean {
  const value = host?.trim().toLowerCase() ?? ''
  return value === '127.0.0.1' || value === '::1' || value === 'localhost' || value === ''
}

/** Persisted pair that only ever pointed at this computer's loopback vav-server. */
export function isLoopbackPairedHost(row: {
  host?: string
  addresses?: string[]
}): boolean {
  if (!isLoopbackHost(row.host)) return false
  return (row.addresses ?? []).every((address) => isLoopbackHost(address))
}

/** Loopback vav-server pairing the desktop can advertise as "this computer". */
export function loopbackVavServerShell(pairing: string | null | undefined): VavServerShellTarget | null {
  if (!pairing) return null
  const parsed = parseDaemonPairing(pairing)
  if (!parsed?.secret || !parsed.port || parsed.port <= 0) return null
  if (!isLoopbackHost(parsed.host)) return null
  for (const address of parsed.addresses ?? []) {
    if (!isLoopbackHost(address)) return null
  }
  return { pairing, port: parsed.port, secret: parsed.secret }
}
