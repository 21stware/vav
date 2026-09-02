import { LOCAL_MACHINE_ID, normalizeMachineId } from '@shared/workspaceHost'

function searchParams(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search)
  } catch {
    return new URLSearchParams()
  }
}

/** True when this renderer is a companion session window (`view=session`). */
export function isCompanionSessionShell(): boolean {
  return searchParams().get('view') === 'session'
}

/** Main app shell — local or a paired-daemon window (`view` is empty). */
export function isMainSessionShell(): boolean {
  return !searchParams().get('view')
}

/** Machine this main shell is bound to. Remote windows load `?machine=<id>`. */
export function readWindowMachineId(): string {
  return normalizeMachineId(searchParams().get('machine'))
}

export function isLocalMainShell(): boolean {
  return isMainSessionShell() && readWindowMachineId() === LOCAL_MACHINE_ID
}
