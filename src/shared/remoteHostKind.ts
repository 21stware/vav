/**
 * Which remote plane each endpoint speaks.
 *
 * Daemon (workspace host) and control UI (session plane) are separate:
 * same pairing secret, different `hello.role`. Copying a host transcript
 * onto the controller and running a local agent leaves the controlled
 * desktop UI dark — that is the coupling this table forbids.
 */

export type RemoteEndpointRole = 'phone' | 'desktop-client' | 'desktop-host' | 'headless-daemon'

export type RemoteHostPlane = 'desktop' | 'headless'

export type RemoteEndpointConfig = {
  role: RemoteEndpointRole
  /** Session list / send / thread / live turn / configure. */
  controlPlane: boolean
  /** fs / spawn / pty on the daemon protocol. */
  workspaceHost: boolean
  /** Run agent turns in this process. */
  localAgent: boolean
  /** Project turns into a local workbench UI. */
  driveLocalUi: boolean
  /** API keys / CLI login live here. */
  holdsSecrets: boolean
}

const CONFIGS: Record<RemoteEndpointRole, RemoteEndpointConfig> = {
  phone: {
    role: 'phone',
    controlPlane: true,
    workspaceHost: false,
    localAgent: false,
    driveLocalUi: true,
    holdsSecrets: false
  },
  'desktop-client': {
    role: 'desktop-client',
    controlPlane: true,
    workspaceHost: true,
    localAgent: false,
    driveLocalUi: true,
    holdsSecrets: false
  },
  'desktop-host': {
    role: 'desktop-host',
    controlPlane: true,
    workspaceHost: true,
    localAgent: true,
    driveLocalUi: true,
    holdsSecrets: true
  },
  'headless-daemon': {
    role: 'headless-daemon',
    controlPlane: false,
    workspaceHost: true,
    localAgent: false,
    driveLocalUi: false,
    holdsSecrets: false
  }
}

export function remoteEndpointConfig(role: RemoteEndpointRole): RemoteEndpointConfig {
  return CONFIGS[role]
}

/**
 * How a desktop window should talk to a paired machine.
 *
 * Desktop hosts expose the control plane on the same listen port (phone
 * hello). Headless `vavd` does not — the client must run the agent itself
 * and only use the daemon for disk / PTY.
 */
export function desktopClientAgainst(host: RemoteHostPlane): RemoteEndpointConfig {
  if (host === 'headless') {
    return {
      role: 'desktop-client',
      controlPlane: false,
      workspaceHost: true,
      localAgent: true,
      driveLocalUi: true,
      holdsSecrets: true
    }
  }
  return remoteEndpointConfig('desktop-client')
}

/** True when this process must not start a turn for `machineId`. */
export function hostOwnsTurns(controlPlane: boolean | undefined, isLocal: boolean): boolean {
  if (isLocal) return true
  return controlPlane === true
}

/**
 * Id the host store knows. Adopted remotes keep the host id unless it
 * collided locally — then `duplicateSourceId` is the host's original.
 */
export function hostSessionId(localId: string, duplicateSourceId?: string | null): string {
  const source = duplicateSourceId?.trim()
  return source || localId
}
