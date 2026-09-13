import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'

export type ComputerPermissionOutcome = 'granted' | 'pending' | 'unavailable'

/**
 * Guided request for the two macOS grants computer use needs — Accessibility
 * and Screen Recording.
 *
 * It first raises the real system prompts (never a bare error toast), then, if
 * anything is still missing, shows one dialog that names the outstanding grants
 * and — on confirm — opens Settings → Computer use, where each row deep-links
 * into the matching System Settings pane and reflects live status. Returns
 * `granted` only when both are live.
 */
export async function ensureComputerPermissions(): Promise<ComputerPermissionOutcome> {
  const status = await window.vav.computer.status().catch(() => null)
  if (!status) return 'unavailable'

  // Fire the native prompts for whatever is missing. These are no-ops once a
  // grant is live and, on macOS, only surface a prompt while 'not-determined'.
  if (status.accessibility !== 'granted') {
    await window.vav.computer.requestAccessibility().catch(() => false)
  }
  if (status.screenRecording !== 'granted') {
    await window.vav.computer.requestScreenRecording().catch(() => status.screenRecording)
  }

  // Re-read: granting in System Settings may need a return trip, but the
  // in-session prompt can flip 'not-determined' → 'granted' immediately.
  const next = await window.vav.computer.status().catch(() => status)
  if (next.accessibility === 'granted' && next.screenRecording === 'granted') {
    return 'granted'
  }

  const missing: string[] = []
  if (next.accessibility !== 'granted') missing.push(tt('appearance.accessibilityPermission'))
  if (next.screenRecording !== 'granted') missing.push(tt('appearance.screenshotPermission'))

  const store = useSessionStore.getState()
  store.showDialog({
    title: tt('computerUse.permissionTitle'),
    body: tt('computerUse.permissionBody', { permissions: missing.join(' · ') }),
    confirmLabel: tt('computerUse.permissionOpenSettings'),
    cancelLabel: tt('common.cancel'),
    onConfirm: () => useSessionStore.getState().openSettings('appearance', 'computer-use')
  })
  return 'pending'
}
