import { isLocalMachine } from '../../shared/workspaceHost.ts'
import type { HostRegistry, WorkspaceHost } from './WorkspaceHost.ts'

/** Spawned loopback vav-server — default local service, hidden from the switcher. */
export function localShellHostOf(registry: HostRegistry): WorkspaceHost | null {
  for (const info of registry.list()) {
    if (!info.localShell) continue
    const host = registry.get(info.id)
    if (host) return host
  }
  return null
}

/**
 * Files / PTY / git for a conversation. Local chats use the spawned vav-server
 * host when it is mounted so desktop and Chrome share one grant plane.
 */
export function workspaceHostForConversation(
  registry: HostRegistry,
  machineId: string | null | undefined
): WorkspaceHost {
  if (isLocalMachine(machineId)) {
    return localShellHostOf(registry) ?? registry.local()
  }
  return registry.hostFor(machineId)
}

/** Native node-pty / existsSync — false once local I/O goes through vav-server. */
export function conversationUsesLocalNode(
  registry: HostRegistry,
  machineId: string | null | undefined
): boolean {
  return isLocalMachine(machineId) && !localShellHostOf(registry)
}

/**
 * Wait until the spawned loopback vav-server is paired and its phone-role
 * control plane is ready. New Session / agent probes call this so they
 * do not mint an in-process row while pair() is still in flight.
 */
export async function waitForMountedLocalShell(
  registry: HostRegistry,
  waitControl: (id: string) => Promise<boolean>,
  pairing?: Promise<unknown> | null
): Promise<string | null> {
  if (pairing) {
    try {
      await pairing
    } catch {
      /* pair failed — fall through */
    }
  }
  const pending = registry.list().find((info) => info.localShell)
  if (!pending) return null
  await waitControl(pending.id)
  return pending.id
}
