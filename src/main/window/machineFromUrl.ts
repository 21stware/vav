import { LOCAL_MACHINE_ID, normalizeMachineId } from '../../shared/workspaceHost.ts'

/** `?machine=` on a renderer URL, or this process. */
export function machineIdFromRendererUrl(url: string | null | undefined): string {
  try {
    if (!url) return LOCAL_MACHINE_ID
    return normalizeMachineId(new URL(url).searchParams.get('machine'))
  } catch {
    return LOCAL_MACHINE_ID
  }
}
