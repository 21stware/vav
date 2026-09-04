/**
 * When the desktop is a UI for a loopback vavd, incoming pairing
 * (Connect line, phone QR tunnel) must target that daemon — not the
 * in-process Electron hub.
 */
import { parseDaemonPairing } from '../../shared/daemonProtocol.ts'

export type VavdShellTarget = {
  pairing: string
  port: number
  secret: string
}

function isLoopbackHost(host?: string): boolean {
  const value = host?.trim().toLowerCase() ?? ''
  return value === '127.0.0.1' || value === '::1' || value === 'localhost' || value === ''
}

/** Loopback vavd pairing the desktop can advertise as "this computer". */
export function loopbackVavdShell(pairing: string | null | undefined): VavdShellTarget | null {
  if (!pairing) return null
  const parsed = parseDaemonPairing(pairing)
  if (!parsed?.secret || !parsed.port || parsed.port <= 0) return null
  if (!isLoopbackHost(parsed.host)) return null
  for (const address of parsed.addresses ?? []) {
    if (!isLoopbackHost(address)) return null
  }
  return { pairing, port: parsed.port, secret: parsed.secret }
}
