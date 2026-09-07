/** CLI argv for connector login. Kept free of node-pty so unit tests stay cheap. */

import { type ConnectorId, connectorCliName } from '@shared/connector'

export function connectorLoginBin(id: ConnectorId): string {
  return connectorCliName(id)
}

export function connectorLoginArgv(id: ConnectorId): string[] {
  if (id === 'github') return ['auth', 'login', '-h', 'github.com', '-p', 'https', '-w']
  return ['login']
}

/** Packages `npx --yes` can run when the dedicated CLI is not on PATH. `gh` has none. */
export function connectorLoginNpxPackage(id: ConnectorId): string | null {
  if (id === 'github') return null
  return connectorCliName(id)
}
