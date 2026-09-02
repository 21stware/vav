import { isLocalMachine, type WorkspaceHostInfo } from '../../shared/workspaceHost.ts'

export type RemoteHostFacts = {
  providersOf: (id: string) => WorkspaceHostInfo['providers']
  homeOf: (id: string) => string
  tmpOf: (id: string) => string
  defaultPathOf: (id: string) => string | null | undefined
}

/** Overlay daemon-reported home/tmp/providers onto the registry snapshot. */
export function decorateHosts(
  hosts: WorkspaceHostInfo[],
  remote: RemoteHostFacts
): WorkspaceHostInfo[] {
  return hosts.map((host) => {
    if (isLocalMachine(host.id)) return host
    const providers = remote.providersOf(host.id)
    const home = remote.homeOf(host.id) || host.home
    const tmp = remote.tmpOf(host.id) || host.tmp
    const defaultPath = remote.defaultPathOf(host.id) ?? undefined
    return { ...host, home, tmp, defaultPath, providers }
  })
}
